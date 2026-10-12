// core/meetings/google.ts — Google Drive só-leitura (escopo drive.readonly) p/ puxar as
// anotações do "Tomar notas com o Gemini" (Google Docs). OAuth2 de app "Desktop" com
// redirect em loopback (127.0.0.1:porta aleatória): o usuário autoriza UMA vez no navegador,
// o refresh_token fica em ~/.typer/google-token.json (600) e nunca entra no repo.
// Zero dependência: fetch nativo + http do Node p/ receber o código.

import { createServer } from "node:http";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { RawMeeting } from "./types.js";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";

export type FetchFn = typeof fetch;

interface ClientSecret {
  client_id: string;
  client_secret: string;
}
interface StoredToken {
  refresh_token: string;
  access_token?: string;
  /** epoch ms */
  expires_at?: number;
  scope?: string;
}

/** lê o JSON baixado do Google Cloud Console (OAuth client "Desktop app") */
export async function loadClientFile(path: string): Promise<ClientSecret> {
  const j = JSON.parse(await readFile(path, "utf8")) as { installed?: ClientSecret; web?: ClientSecret } & Partial<ClientSecret>;
  const c = j.installed ?? j.web ?? (j.client_id ? (j as ClientSecret) : undefined);
  if (!c?.client_id || !c.client_secret) throw new Error(`arquivo de client OAuth inválido: ${path} (esperado o JSON do tipo "Desktop app")`);
  return { client_id: c.client_id, client_secret: c.client_secret };
}

export class GoogleAuth {
  private token: StoredToken | null = null;
  constructor(
    private readonly client: ClientSecret,
    private readonly tokenFile: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<boolean> {
    try {
      this.token = JSON.parse(await readFile(this.tokenFile, "utf8")) as StoredToken;
      return Boolean(this.token.refresh_token);
    } catch {
      return false;
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.tokenFile, JSON.stringify(this.token, null, 2), { mode: 0o600 });
    await chmod(this.tokenFile, 0o600).catch(() => {});
  }

  authUrl(redirectUri: string, state: string): string {
    const q = new URLSearchParams({
      client_id: this.client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      prompt: "consent", // garante refresh_token mesmo se já autorizou antes
      state,
    });
    return `${AUTH_URL}?${q}`;
  }

  private async tokenRequest(params: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.client.client_id, client_secret: this.client.client_secret, ...params }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof j.access_token !== "string") {
      const err = `${j.error ?? res.status}${j.error_description ? `: ${j.error_description}` : ""}`;
      throw new Error(`Google OAuth falhou (${err})`);
    }
    return j as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
  }

  async exchangeCode(code: string, redirectUri: string): Promise<void> {
    const t = await this.tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
    if (!t.refresh_token) throw new Error("Google não devolveu refresh_token — revogue o acesso do app em myaccount.google.com/permissions e autorize de novo");
    this.token = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: this.now() + t.expires_in * 1000, ...(t.scope ? { scope: t.scope } : {}) };
    await this.save();
  }

  /** access token válido (renova com o refresh_token quando faltar < 60 s) */
  async accessToken(): Promise<string> {
    if (!this.token) await this.load();
    if (!this.token?.refresh_token) throw new Error("Google Drive não autorizado — rode: typermagic reunioes google-auth");
    if (this.token.access_token && (this.token.expires_at ?? 0) - this.now() > 60_000) return this.token.access_token;
    const t = await this.tokenRequest({ refresh_token: this.token.refresh_token, grant_type: "refresh_token" });
    this.token = { ...this.token, access_token: t.access_token, expires_at: this.now() + t.expires_in * 1000 };
    await this.save();
    return t.access_token;
  }
}

/** Fluxo interativo: sobe um servidor em 127.0.0.1:porta-livre, imprime a URL (ou abre),
 *  espera o redirect com ?code=, troca pelo token e salva. Timeout 5 min. */
export async function loginInteractive(auth: GoogleAuth, opts: { open?: (url: string) => void; log?: (m: string) => void; timeoutMs?: number } = {}): Promise<void> {
  const state = randomBytes(16).toString("hex");
  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      const err = url.searchParams.get("error");
      const html = (msg: string): void => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:2rem"><h2>${msg}</h2><p>Pode fechar esta aba.</p></body>`);
      };
      if (err || !code || gotState !== state) {
        html("Autorização recusada ou inválida.");
        finish(new Error(`autorização não concluída (${err ?? "code/state inválidos"})`));
        return;
      }
      try {
        await auth.exchangeCode(code, redirect);
        html("✅ Google Drive autorizado para a Central de Reuniões.");
        finish();
      } catch (e) {
        html("Falha ao trocar o código pelo token.");
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });
    let redirect = "";
    let done = false;
    const timer = setTimeout(() => finish(new Error("tempo esgotado esperando a autorização no navegador")), opts.timeoutMs ?? 5 * 60_000);
    const finish = (e?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (e) reject(e);
      else resolve();
    };
    server.on("error", (e) => finish(e));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      redirect = `http://127.0.0.1:${port}`;
      const url = auth.authUrl(redirect, state);
      opts.log?.(`Abra no navegador (se não abrir sozinho):\n${url}`);
      opts.open?.(url);
    });
  });
}

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  mimeType?: string;
}

export class DriveClient {
  constructor(
    private readonly auth: Pick<GoogleAuth, "accessToken">,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private async get(path: string, params: Record<string, string>, asText = false): Promise<unknown> {
    const token = await this.auth.accessToken();
    const res = await this.fetchFn(`${DRIVE}${path}?${new URLSearchParams(params)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Drive ${res.status} em ${path}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return asText ? res.text() : res.json();
  }

  /** Google Docs cujo nome contém um dos termos, modificados depois de `since` (ISO). */
  async listNotes(opts: { nameMatch: string[]; since?: string; pageSize?: number }): Promise<DriveFile[]> {
    const names = opts.nameMatch.map((n) => `name contains '${n.replace(/'/g, "\\'")}'`).join(" or ");
    const q = [`mimeType = 'application/vnd.google-apps.document'`, "trashed = false", `(${names})`, ...(opts.since ? [`modifiedTime > '${opts.since}'`] : [])].join(" and ");
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const j = (await this.get("/files", {
        q,
        orderBy: "modifiedTime",
        pageSize: String(opts.pageSize ?? 50),
        fields: "nextPageToken, files(id, name, createdTime, modifiedTime, mimeType)",
        ...(pageToken ? { pageToken } : {}),
      })) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(j.files ?? []));
      pageToken = j.nextPageToken;
    } while (pageToken);
    return out;
  }

  exportText(fileId: string): Promise<string> {
    return this.get(`/files/${encodeURIComponent(fileId)}/export`, { mimeType: "text/plain" }, true) as Promise<string>;
  }
}

/** "Planejamento Q4 - 11/10/2026 - Notes by Gemini" → "Planejamento Q4" */
export function cleanGeminiTitle(name: string): string {
  return name
    .replace(/\s*[-–—]\s*(notes by gemini|anota[cç][oõ]es (do|pelo|feitas pelo) gemini|notas (do|pelo) gemini|gemini notes?)\s*$/i, "")
    .replace(/\s*[-–—]\s*\d{1,2}\/\d{1,2}\/\d{2,4}(\s*\d{1,2}:\d{2})?\s*$/, "")
    .trim();
}

export function driveFileToRaw(f: DriveFile, text: string): RawMeeting {
  const title = cleanGeminiTitle(f.name) || f.name;
  return {
    sourceKey: `meet:${f.id}`,
    platform: "meet",
    date: f.createdTime,
    title,
    text,
    origin: `Google Drive: "${f.name}" (anotações do Gemini)`,
  };
}
