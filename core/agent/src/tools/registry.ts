// core/agent/tools/registry.ts
// O registry guarda as 50 ferramentas (AGENT_TOOLS.md §4). O agente recebe o CORE
// sempre no prompt e descobre o resto sob demanda via search — em vez de carregar
// as 50 de uma vez (infla o prompt e a chance de escolher errado).

import type { Tool } from "./types.js";

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  core(): Tool[]; // sempre no prompt do agente
  search(query: string): Tool[]; // descoberta das lazy por contexto
  all(): Tool[];
}

function terms(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`ferramenta duplicada: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  core(): Tool[] {
    return [...this.tools.values()].filter((t) => t.tier === "core");
  }

  all(): Tool[] {
    return [...this.tools.values()];
  }

  /** Casa a query contra nome/família/descrição/params; devolve os melhores
   *  matches (lazy primeiro, já que o core sempre está no prompt). */
  search(query: string): Tool[] {
    const qs = terms(query);
    if (qs.length === 0) return [];
    const scored: Array<{ tool: Tool; score: number }> = [];
    for (const tool of this.tools.values()) {
      const hay = terms(
        `${tool.name} ${tool.family} ${tool.description} ${tool.params
          .map((p) => `${p.name} ${p.description}`)
          .join(" ")}`,
      );
      const set = new Set(hay);
      let score = 0;
      for (const q of qs) {
        if (set.has(q)) score += 2;
        else if (hay.some((h) => h.includes(q) || q.includes(h))) score += 1;
      }
      if (tool.name.toLowerCase().includes(query.toLowerCase())) score += 3;
      if (score > 0) scored.push({ tool, score });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // empate: lazy antes (o core já está visível), depois alfabético
      if (a.tool.tier !== b.tool.tier) return a.tool.tier === "lazy" ? -1 : 1;
      return a.tool.name.localeCompare(b.tool.name);
    });
    return scored.map((s) => s.tool);
  }
}
