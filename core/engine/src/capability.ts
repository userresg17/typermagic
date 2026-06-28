// core/engine/capability.ts
// Broker de capacidade — a espinha de segurança virada para fora do editor. Cada
// ferramenta carrega `permission` (o que faz) e `exec` (onde roda); o grant da
// superfície diz o que ela tem direito de usar. O broker casa os dois ANTES do
// dispatch e nega por padrão. Na fundação, cli/tui/editor recebem grant cheio
// (paridade com hoje), mas o gargalo já existe: ligar gateway/scheduler com menor
// privilégio depois não muda o contrato das superfícies — só o corpo desta função.

import type { Permission, ExecContext } from "@typer/agent";
import type { CapabilityGrant, SurfaceId } from "./types.js";

/** Grant cheio: terminal local e editor confiáveis (paridade com a CLI atual). */
export const FULL_GRANT: CapabilityGrant = {
  permissions: ["read", "write", "exec", "network", "meta"],
  exec: ["in_process", "subprocess", "microvm"],
};

/** Grant somente-leitura: o piso para qualquer superfície não confiável. */
export const READONLY_GRANT: CapabilityGrant = {
  permissions: ["read", "meta"],
  exec: ["in_process"],
};

/** Concessão padrão por superfície. Default-deny para o que chega de fora. */
export function defaultGrantFor(surface: SurfaceId): CapabilityGrant {
  if (surface === "cli" || surface === "tui" || surface === "editor") {
    return FULL_GRANT;
  }
  if (surface === "scheduler") {
    // autonomia local: edita e roda subprocesso, mas sem microVM nem rede livre;
    // ação de efeito externo passa pelo selo (seal-router) como a pedida na mão.
    return { permissions: ["read", "write", "exec"], exec: ["in_process", "subprocess"] };
  }
  // gateway:* — mensagem de remetente desconhecido: o piso, escalar pede aprovação.
  return READONLY_GRANT;
}

export interface BrokerVerdict {
  allowed: boolean;
  reason?: string;
}

/** O portão: a ferramenta passa só se permissão E contexto de exec estão no grant,
 *  respeitando allow/deny explícitos. Default-deny em qualquer dúvida. */
export function brokerAllows(
  tool: { name: string; permission: Permission; exec: ExecContext },
  grant: CapabilityGrant,
): BrokerVerdict {
  if (grant.tools?.deny?.includes(tool.name)) {
    return { allowed: false, reason: `ferramenta "${tool.name}" está na deny-list da superfície` };
  }
  if (grant.tools?.allow && !grant.tools.allow.includes(tool.name)) {
    return { allowed: false, reason: `ferramenta "${tool.name}" fora da allow-list da superfície` };
  }
  if (!grant.permissions.includes(tool.permission)) {
    return { allowed: false, reason: `permissão "${tool.permission}" não concedida à superfície` };
  }
  if (!grant.exec.includes(tool.exec)) {
    return { allowed: false, reason: `contexto de execução "${tool.exec}" não concedido à superfície` };
  }
  return { allowed: true };
}
