// core/crypto/canonical.ts
// Forma canônica de um objeto para assinatura REPRODUTÍVEL: JSON com chaves
// ordenadas em todos os níveis. Duas máquinas que assinam o mesmo objeto produzem
// os mesmos bytes — é o que torna a assinatura de skill/trajetória verificável.

/** Ordena recursivamente as chaves; arrays preservam ordem. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/** Serializa em JSON canônico (chaves ordenadas, sem espaços). */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
