// core/vault/redact.ts
// Redação p/ exibição segura (ex.: cartão-resumo do HITL no Telegram). O valor PLENO
// só sai pelo vault.get() p/ os preenchedores determinísticos; tudo que vai p/ humano
// ou log passa por aqui. Cartão → só os 4 últimos; CVV/senha/token → mascarado total.

/** Campos cujo valor jamais deve aparecer, nem parcialmente. */
const FULL_SECRET = /(cvv|cvc|password|senha|secret|token|otp|pin)\b/i;
/** Campos de número de cartão (mostra só os 4 últimos dígitos). */
const CARD = /(card[_-]?number|numero[_-]?cartao|cartao|^card$|^pan$)/i;

/** Redige UM campo conforme a sensibilidade do nome. */
export function redact(field: string, value: string): string {
  if (CARD.test(field)) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "••••";
  }
  if (FULL_SECRET.test(field)) return "•••";
  return value;
}

/** Versão redigida de todo o mapa (segura p/ exibir/logar). */
export function redactAll(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = redact(k, v);
  return out;
}

/** É um campo sensível (não pode ser exibido pleno)? */
export function isSensitive(field: string): boolean {
  return CARD.test(field) || FULL_SECRET.test(field);
}
