// app/scheduler/cron.ts
// Avaliador cron de 5 campos (min hora dia-do-mês mês dia-da-semana), puro e
// testável, sem dependência. Suporta *, n, a-b, */n, a-b/n e listas a,b,c. dom/dow
// 0 e 7 = domingo. Não calcula "próximo disparo" — o daemon dá tick a cada minuto e
// pergunta "casa agora?".

export interface CronFields {
  minute: number; // 0-59
  hour: number; // 0-23
  day: number; // 1-31
  month: number; // 1-12
  weekday: number; // 0-6 (0=domingo)
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Math.max(1, parseInt(stepPart, 10)) : 1;
    let lo = min;
    let hi = max;
    if (rangePart && rangePart !== "*") {
      const m = /^(\d+)(?:-(\d+))?$/.exec(rangePart);
      if (!m) continue;
      lo = parseInt(m[1]!, 10);
      hi = m[2] !== undefined ? parseInt(m[2], 10) : lo;
    }
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

/** Verdadeiro se a expressão cron casa com os campos do momento. */
export function cronMatch(expr: string, at: CronFields): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  const minutes = parseField(min, 0, 59);
  const hours = parseField(hour, 0, 23);
  const days = parseField(dom, 1, 31);
  const months = parseField(mon, 1, 12);
  // dia-da-semana: aceita 0 e 7 como domingo
  const weekdays = parseField(dow.replace(/7/g, "0"), 0, 6);

  return (
    minutes.has(at.minute) &&
    hours.has(at.hour) &&
    months.has(at.month) &&
    days.has(at.day) &&
    weekdays.has(at.weekday)
  );
}

/** Extrai os campos cron de uma Date (horário LOCAL). */
export function fieldsOf(date: Date): CronFields {
  return {
    minute: date.getMinutes(),
    hour: date.getHours(),
    day: date.getDate(),
    month: date.getMonth() + 1,
    weekday: date.getDay(),
  };
}
