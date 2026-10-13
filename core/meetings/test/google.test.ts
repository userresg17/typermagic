import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoogleAuth,
  DriveClient,
  loadClientFile,
  cleanGeminiTitle,
  driveFileToRaw,
} from "../src/google.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "typer-google-"));
});

const json = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("GoogleAuth", () => {
  it("lê o client JSON do tipo Desktop app", async () => {
    const f = join(dir, "client.json");
    await writeFile(
      f,
      JSON.stringify({
        installed: {
          client_id: "id",
          client_secret: "sec",
          redirect_uris: ["http://localhost"],
        },
      }),
    );
    expect(await loadClientFile(f)).toEqual({
      client_id: "id",
      client_secret: "sec",
    });
    await writeFile(f, "{}");
    await expect(loadClientFile(f)).rejects.toThrow(/inválido/);
  });

  it("sem token salvo, pede autorização", async () => {
    const auth = new GoogleAuth(
      { client_id: "id", client_secret: "sec" },
      join(dir, "tok.json"),
    );
    await expect(auth.accessToken()).rejects.toThrow(/google-auth/);
  });

  it("troca o code, salva com 600 e renova quando expira", async () => {
    let now = 1_000_000;
    const bodies: string[] = [];
    const fakeFetch = (async (
      _u: string | URL | Request,
      init?: RequestInit,
    ) => {
      bodies.push(String(init?.body));
      if (String(init?.body).includes("grant_type=authorization_code"))
        return json({
          access_token: "A1",
          expires_in: 3600,
          refresh_token: "R",
        });
      return json({ access_token: "A2", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const tokFile = join(dir, "tok.json");
    const auth = new GoogleAuth(
      { client_id: "id", client_secret: "sec" },
      tokFile,
      fakeFetch,
      () => now,
    );
    await auth.exchangeCode("CODE", "http://127.0.0.1:1");
    // Windows usa ACLs e não representa as permissões POSIX 0600 no modo do arquivo.
    if (process.platform !== "win32") {
      expect((await stat(tokFile)).mode & 0o777).toBe(0o600);
    }
    expect(JSON.parse(await readFile(tokFile, "utf8")).refresh_token).toBe("R");
    expect(await auth.accessToken()).toBe("A1"); // ainda válido
    now += 3600 * 1000; // expirou
    expect(await auth.accessToken()).toBe("A2");
    expect(bodies[1]).toContain("grant_type=refresh_token");
    // um GoogleAuth novo lê o arquivo salvo
    const again = new GoogleAuth(
      { client_id: "id", client_secret: "sec" },
      tokFile,
      fakeFetch,
      () => now,
    );
    expect(await again.load()).toBe(true);
  });

  it("URL de autorização pede offline + consent + escopo readonly", () => {
    const auth = new GoogleAuth(
      { client_id: "id", client_secret: "sec" },
      join(dir, "t.json"),
    );
    const u = new URL(auth.authUrl("http://127.0.0.1:5", "st"));
    expect(u.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.readonly",
    );
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("DriveClient", () => {
  it("monta a query dos docs do Gemini, pagina e exporta texto", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (
      u: string | URL | Request,
      init?: RequestInit,
    ) => {
      const s = String(u);
      urls.push(s);
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer TOK",
      );
      if (s.includes("/files?")) {
        const p = new URL(s).searchParams;
        if (!p.get("pageToken"))
          return json({
            files: [
              {
                id: "f1",
                name: "Kickoff - 11/10/2026 - Notes by Gemini",
                createdTime: "2026-10-11T10:00:00Z",
                modifiedTime: "2026-10-11T11:00:00Z",
              },
            ],
            nextPageToken: "p2",
          });
        return json({
          files: [
            {
              id: "f2",
              name: "Vendas - Anotações do Gemini",
              createdTime: "2026-10-12T10:00:00Z",
              modifiedTime: "2026-10-12T11:00:00Z",
            },
          ],
        });
      }
      if (s.includes("/files/f1/export"))
        return new Response("Attendees: Alice, Bob\nNotes...", { status: 200 });
      return json({}, 404);
    }) as unknown as typeof fetch;
    const drive = new DriveClient(
      { accessToken: async () => "TOK" },
      fakeFetch,
    );
    const files = await drive.listNotes({
      nameMatch: ["Gemini"],
      since: "2026-10-01T00:00:00Z",
    });
    expect(files.map((f) => f.id)).toEqual(["f1", "f2"]);
    const q = new URL(urls[0]!).searchParams.get("q")!;
    expect(q).toContain("mimeType = 'application/vnd.google-apps.document'");
    expect(q).toContain("name contains 'Gemini'");
    expect(q).toContain("modifiedTime > '2026-10-01T00:00:00Z'");
    expect(await drive.exportText("f1")).toContain("Attendees");
  });
});

describe("título e RawMeeting do Drive", () => {
  it("limpa o sufixo do Gemini e a data", () => {
    expect(cleanGeminiTitle("Kickoff - 11/10/2026 - Notes by Gemini")).toBe(
      "Kickoff",
    );
    expect(cleanGeminiTitle("Vendas – Anotações do Gemini")).toBe("Vendas");
    expect(cleanGeminiTitle("Sem sufixo")).toBe("Sem sufixo");
  });
  it("driveFileToRaw usa createdTime e chave meet:<id>", () => {
    const r = driveFileToRaw(
      {
        id: "f1",
        name: "Kickoff - Notes by Gemini",
        createdTime: "2026-10-11T10:00:00Z",
        modifiedTime: "x",
      },
      "txt",
    );
    expect(r).toMatchObject({
      sourceKey: "meet:f1",
      platform: "meet",
      date: "2026-10-11T10:00:00Z",
      title: "Kickoff",
      text: "txt",
    });
  });
});
