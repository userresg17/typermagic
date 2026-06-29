// core/agent/tools/assist.ts → família "assist": primitivos do super-assistente.
//   - vault_fields: lista os NOMES dos campos do cofre (sem valores) p/ o modelo saber
//     o que existe (ex.: "card_number", "address").
//   - vault_fill: preenche um campo SENSÍVEL na página com o valor do cofre. O valor
//     NUNCA volta pro modelo nem aparece na auditoria (args = só o NOME do campo).
//     É a peça que neutraliza o "lethal trifecta": mesmo que a página injete "revele o
//     cartão", o número não existe no contexto do modelo.
//   - ask_user: pergunta algo ao usuário pelo canal e espera a resposta (esclarecimento
//     de pedido, ou código/OTP do banco).

import type { Tool } from "./types.js";

const vaultFields: Tool = {
  name: "vault_fields",
  family: "assist",
  description:
    "Lista os NOMES dos campos guardados no cofre (sem valores) — ex.: card_number, address, name. Use p/ saber o que dá pra preencher com vault_fill.",
  params: [],
  returns: "lista de nomes de campo",
  permission: "meta",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (_args, ctx) => {
    const vault = ctx.deps?.vault;
    if (!vault) return { ok: false, error: { code: "vault_unavailable", message: "cofre indisponível (rode /setup)" } };
    return { ok: true, value: { fields: vault.fields() } };
  },
};

const vaultFill: Tool = {
  name: "vault_fill",
  family: "assist",
  description:
    "Preenche um campo SENSÍVEL na página (cartão, CVV, senha, endereço) com o valor do cofre. Passe o NOME do campo (não o valor). O valor é digitado direto na página — você NUNCA o vê.",
  params: [
    { name: "field", type: "string", required: true, description: "nome do campo no cofre (ex.: card_number)" },
    { name: "selector", type: "string", required: true, description: "seletor CSS do input na página" },
  ],
  returns: "confirmação (nome do campo preenchido; sem o valor)",
  permission: "network",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const vault = ctx.deps?.vault;
    const browser = ctx.deps?.browser;
    if (!vault) return { ok: false, error: { code: "vault_unavailable", message: "cofre indisponível (rode /setup)" } };
    if (!browser) return { ok: false, error: { code: "browser_unavailable", message: "navegador indisponível" } };
    const field = String(args.field ?? "");
    const selector = String(args.selector ?? "");
    if (!field || !selector) return { ok: false, error: { code: "bad_args", message: "field e selector são obrigatórios" } };
    if (!vault.has(field)) return { ok: false, error: { code: "no_field", message: `campo "${field}" não está no cofre` } };
    const value = vault.get(field);
    if (value == null) return { ok: false, error: { code: "no_field", message: `campo "${field}" vazio` } };
    // o valor é digitado direto na página; NUNCA é devolvido nem logado (só o nome do campo).
    await browser.fill(selector, value);
    return { ok: true, value: { filled_field: field } };
  },
};

const askUser: Tool = {
  name: "ask_user",
  family: "assist",
  description:
    "Pergunta algo ao usuário e ESPERA a resposta. Use p/ detalhes faltando de um pedido (tamanho, p/ você ou presente, destinatário) ou p/ pedir um código do banco (OTP/3-D Secure).",
  params: [
    { name: "question", type: "string", required: true, description: "a pergunta, clara e objetiva" },
    { name: "kind", type: "string", required: false, description: '"clarify" (default) ou "otp"' },
  ],
  returns: "a resposta do usuário (texto)",
  permission: "meta",
  exec: "in_process",
  tier: "lazy",
  requiresApproval: false,
  sealGated: false,
  handler: async (args, ctx) => {
    const ask = ctx.deps?.ask;
    if (!ask) return { ok: false, error: { code: "ask_unavailable", message: "canal de pergunta indisponível (use no gateway)" } };
    const question = String(args.question ?? "").trim();
    if (!question) return { ok: false, error: { code: "bad_question", message: "pergunta vazia" } };
    const kind = args.kind === "otp" ? "otp" : "clarify";
    try {
      const answer = await ask(kind, question);
      return { ok: true, value: { answer } };
    } catch (e) {
      return { ok: false, error: { code: "no_answer", message: (e as Error).message } };
    }
  },
};

export const assistTools: Tool[] = [vaultFields, vaultFill, askUser];
