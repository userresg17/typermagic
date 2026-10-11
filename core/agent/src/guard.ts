// core/agent/guard.ts — guardas de segurança do agente (Fase 5), configuradas por env:
//   TYPER_ALLOWED_APPS         apps que o desktop pode controlar (vazio = nenhum)
//   TYPER_CHECKOUT_ALLOW_HOSTS hosts onde pagar/finalizar compra é permitido (vazio = nenhum)
//   TYPER_MAX_PER_TX / TYPER_MAX_PER_DAY  tetos em BRL inteiros (0 = pagamento bloqueado)
//   TYPER_STOP_FILE            arquivo-flag: existir = aborta o loop imediatamente
// Tudo default-deny. O ledger diário fica em ~/.typer/spend.json (nunca o cartão, só valores).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function stopFile(): string {
  const v = process.env.TYPER_STOP_FILE ?? join(homedir(), ".typer", "STOP");
  return v.startsWith("~") ? join(homedir(), v.slice(1)) : v;
}

/** kill switch: /parar (AbortSignal) ou arquivo-flag. */
export function isStopRequested(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || existsSync(stopFile());
}

export function allowedApps(): string[] {
  return list(process.env.TYPER_ALLOWED_APPS);
}

export function appAllowed(name: string): boolean {
  const n = name.trim().toLowerCase();
  return allowedApps().some((a) => a.toLowerCase() === n);
}

export function checkoutHostAllowed(url: string): { ok: boolean; host: string } {
  let host = "";
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return { ok: false, host };
  }
  const allow = list(process.env.TYPER_CHECKOUT_ALLOW_HOSTS).map((h) => h.toLowerCase());
  const ok = allow.some((h) => host === h || host.endsWith("." + h));
  return { ok, host };
}

/** "R$ 1.234,56" | "1234.56" | "1,234.56" → 1234.56 (ou null se não há número). */
export function parseAmountBRL(s: string | number | undefined): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  if (!s) return null;
  const m = String(s).replace(/\s/g, "").match(/(\d[\d.,]*)/);
  if (!m) return null;
  let t = m[1]!;
  // decide separador decimal: o ÚLTIMO separador é o decimal se tiver 1-2 dígitos depois
  const lastSep = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (lastSep >= 0 && t.length - lastSep - 1 <= 2) {
    t = t.slice(0, lastSep).replace(/[.,]/g, "") + "." + t.slice(lastSep + 1);
  } else {
    t = t.replace(/[.,]/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ledgerPath(): string {
  return process.env.TYPER_SPEND_LEDGER ?? join(homedir(), ".typer", "spend.json");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function spentToday(): number {
  try {
    const l = JSON.parse(readFileSync(ledgerPath(), "utf8")) as { day: string; total: number };
    return l.day === today() ? l.total : 0;
  } catch {
    return 0;
  }
}

export function recordSpend(amount: number): void {
  const p = ledgerPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ day: today(), total: spentToday() + amount }), { mode: 0o600 });
}

/** Veredito do limite de gasto. amount null = valor não identificado → nega (default-deny). */
export function checkSpend(amount: number | null): { ok: boolean; reason: string } {
  const perTx = Number(process.env.TYPER_MAX_PER_TX ?? 0);
  const perDay = Number(process.env.TYPER_MAX_PER_DAY ?? 0);
  if (perTx <= 0) return { ok: false, reason: "pagamentos bloqueados (TYPER_MAX_PER_TX=0)" };
  if (amount === null) return { ok: false, reason: "não identifiquei o VALOR da transação — pagamento negado por segurança" };
  if (amount > perTx) return { ok: false, reason: `R$ ${amount.toFixed(2)} acima do teto por transação (R$ ${perTx})` };
  const day = spentToday();
  if (perDay > 0 && day + amount > perDay) {
    return { ok: false, reason: `R$ ${amount.toFixed(2)} estouraria o teto diário (gasto hoje R$ ${day.toFixed(2)} / teto R$ ${perDay})` };
  }
  return { ok: true, reason: `dentro dos tetos (tx ≤ R$ ${perTx}${perDay > 0 ? `, dia ≤ R$ ${perDay}` : ""})` };
}
