import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backend, Channel, ReachContext } from "../src/types.js";
import { tryBackends, probeChannel } from "../src/router.js";
import { routeUrl, getChannel, CHANNELS } from "../src/registry.js";
import { checkAll } from "../src/doctor.js";
import { setCred, loadConfig, resolveCred } from "../src/store.js";
import { parseFeed } from "../src/channels/rss.js";
import { parseVideoId, parseTimedText, parseJson3, parseVtt } from "../src/channels/youtube.js";
import { parseRepo } from "../src/channels/github.js";
import { formatReddit } from "../src/channels/reddit.js";
import { parseTweetId, syndicationToken } from "../src/channels/twitter.js";
import { htmlToText, decodeEntities } from "../src/http.js";

const CTX: ReachContext = { config: {}, timeoutMs: 5000 };

const ok = (name: string): Backend => ({ name, available: () => true, run: async () => ({ ok: true, content: name }) });
const fail = (name: string): Backend => ({
  name,
  available: () => true,
  run: async () => ({ ok: false, error: { code: "x", message: `${name} falhou` } }),
});
const unavail = (name: string): Backend => ({ name, available: () => false, run: async () => ({ ok: true, content: "x" }) });

describe("tryBackends (cadeia de fallback)", () => {
  it("o 1º ok vence e marca o backend", async () => {
    const r = await tryBackends([fail("a"), ok("b"), ok("c")], "in", CTX);
    expect(r).toMatchObject({ ok: true, content: "b", backend: "b" });
  });
  it("pula backends indisponíveis", async () => {
    const r = await tryBackends([unavail("a"), ok("b")], "in", CTX);
    expect(r.backend).toBe("b");
  });
  it("todos falham → erro estruturado com os motivos", async () => {
    const r = await tryBackends([fail("a"), fail("b")], "in", CTX);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("all_backends_failed");
    expect(r.error?.message).toMatch(/a falhou.*b falhou/);
  });
});

describe("routeUrl", () => {
  const cases: [string, string][] = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://github.com/openai/codex", "github"],
    ["https://www.reddit.com/r/typescript/comments/abc/x/", "reddit"],
    ["https://x.com/user/status/1234567890", "twitter"],
    ["https://twitter.com/user/status/1234567890", "twitter"],
    ["https://www.linkedin.com/posts/abc", "linkedin"],
    ["https://www.bilibili.com/video/BV1xx411c7mD", "bilibili"],
    ["https://www.v2ex.com/t/123456", "v2ex"],
    ["https://www.xiaohongshu.com/explore/abc", "xiaohongshu"],
    ["https://blog.exemplo.com/feed.xml", "rss"],
    ["https://news.site/rss", "rss"],
    ["https://exemplo.com/artigo", "web"],
  ];
  for (const [url, channel] of cases) {
    it(`${url} → ${channel}`, () => expect(routeUrl(url).name).toBe(channel));
  }
});

describe("probeChannel (doctor)", () => {
  it("backend disponível → ok com activeBackend", async () => {
    const ch: Channel = { name: "x", description: "", tier: "zero-config", backends: [unavail("a"), ok("b")], matches: () => false };
    expect(await probeChannel(ch, CTX)).toMatchObject({ status: "ok", activeBackend: "b" });
  });
  it("backend que lança na checagem não derruba o probe", async () => {
    const boom: Backend = { name: "boom", available: () => { throw new Error("x"); }, run: async () => ({ ok: false }) };
    const ch: Channel = { name: "y", description: "", tier: "zero-config", backends: [boom, ok("b")], matches: () => false };
    expect((await probeChannel(ch, CTX)).status).toBe("ok");
  });
});

describe("doctor.checkAll", () => {
  it("reporta todos os canais (sobrevive a falhas)", async () => {
    const reports = await checkAll(CTX);
    expect(reports.map((r) => r.name).sort()).toEqual([...CHANNELS].map((c) => c.name).sort());
    for (const r of reports) expect(["ok", "needs-config", "unavailable"]).toContain(r.status);
  });
});

describe("store (~/.typer/reach, 0600)", () => {
  beforeEach(async () => {
    process.env.TYPER_REACH_DIR = await mkdtemp(join(tmpdir(), "typer-reach-"));
    delete process.env.EXA_API_KEY;
  });
  it("setCred grava e loadConfig/resolveCred recuperam; arquivo 0600", async () => {
    await setCred("exa_api_key", "k1");
    const cfg = await loadConfig();
    expect(resolveCred(cfg, "exa_api_key")).toBe("k1");
    if (process.platform !== "win32") {
      const mode = (await stat(join(process.env.TYPER_REACH_DIR!, "config.json"))).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
  it("resolveCred cai p/ variável de ambiente (UPPER)", async () => {
    process.env.EXA_API_KEY = "from-env";
    expect(resolveCred({}, "exa_api_key")).toBe("from-env");
  });
});

describe("parsers de canal (fixtures, sem rede)", () => {
  it("htmlToText tira script/style e decodifica", () => {
    const out = htmlToText("<p>Oi <b>mundo</b> &amp; cia</p><script>hack()</script>");
    expect(out).toBe("Oi mundo & cia");
  });
  it("decodeEntities numérico", () => {
    expect(decodeEntities("a&#38;b &#x41;")).toBe("a&b A");
  });
  it("parseFeed extrai itens RSS", () => {
    const xml = `<rss><channel>
      <item><title>Post 1</title><link>https://a/1</link><description><![CDATA[<p>resumo 1</p>]]></description></item>
      <item><title>Post 2</title><link>https://a/2</link><description>resumo 2</description></item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Post 1", link: "https://a/1" });
    expect(items[0]!.summary).toContain("resumo 1");
  });
  it("parseFeed extrai entries Atom (link href)", () => {
    const xml = `<feed><entry><title>E1</title><link href="https://a/e1"/><summary>s1</summary></entry></feed>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: "E1", link: "https://a/e1", summary: "s1" });
  });
  it("parseVideoId de várias formas", () => {
    expect(parseVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseVideoId("https://site/x")).toBeNull();
  });
  it("parseTimedText junta os <text> e decodifica", () => {
    expect(parseTimedText(`<text start="0">a&amp;b</text><text start="1">c</text>`)).toBe("a&b c");
  });
  it("parseJson3 (formato yt-dlp) junta os segs.utf8", () => {
    const j = JSON.stringify({
      events: [{ segs: [{ utf8: "olá" }, { utf8: " mundo" }] }, { segs: [{ utf8: "linha 2" }] }, { segs: [] }],
    });
    expect(parseJson3(j)).toBe("olá mundo linha 2");
    expect(parseJson3("não é json")).toBe("");
  });
  it("parseVtt descarta cabeçalho, índices, timestamps e tags", () => {
    const vtt =
      "WEBVTT\nKind: captions\nLanguage: en\n\n1\n00:00:01.000 --> 00:00:03.000\nolá <c>mundo</c>\n\n2\n00:00:03.000 --> 00:00:04.000\ntchau";
    expect(parseVtt(vtt)).toBe("olá mundo tchau");
  });
  it("parseRepo de URL e de owner/repo", () => {
    expect(parseRepo("https://github.com/openai/codex")).toMatchObject({ owner: "openai", repo: "codex", rest: [] });
    expect(parseRepo("openai/codex/blob/main/src/x.ts")).toMatchObject({
      owner: "openai",
      repo: "codex",
      rest: ["blob", "main", "src", "x.ts"],
    });
    expect(parseRepo("semrepo")).toBeNull();
  });
  it("parseTweetId + syndicationToken", () => {
    expect(parseTweetId("https://x.com/jack/status/20")).toBe("20");
    expect(parseTweetId("https://twitter.com/u/status/1234567890123456789")).toBe("1234567890123456789");
    expect(parseTweetId("https://x.com/u")).toBeNull();
    expect(typeof syndicationToken("1234567890123456789")).toBe("string");
    expect(syndicationToken("1234567890123456789")).not.toMatch(/[.0]/); // sem '.' nem zeros (regex do react-tweet)
  });
  it("formatReddit: thread (array) e listing (subreddit)", () => {
    const thread = [
      { data: { children: [{ data: { title: "T", selftext: "corpo", author: "a", subreddit: "ts", score: 9 } }] } },
      { data: { children: [{ data: { author: "b", body: "comentário", score: 3 } }] } },
    ];
    const md = formatReddit(thread);
    expect(md).toContain("# T");
    expect(md).toContain("r/ts");
    expect(md).toContain("u/b");
    const listing = { data: { children: [{ data: { title: "P1", score: 5, permalink: "/r/x/1" } }] } };
    expect(formatReddit(listing)).toContain("**P1**");
  });
});

describe("getChannel", () => {
  it("acha por nome", () => expect(getChannel("github")?.name).toBe("github"));
  it("desconhecido → undefined", () => expect(getChannel("nope")).toBeUndefined());
});
