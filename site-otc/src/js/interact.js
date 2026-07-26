// ============================================================
// O MOUSE É O TEMPO — scrub invisível dos vídeos.
//
// Sem botão, sem barra, sem dica: o movimento horizontal do mouse
// acelera, freia e REVERTE o vídeo de fundo visível (e o blob 3D
// entra no mesmo relógio). Parado, tudo volta ao loop normal.
// A sensação: é o usuário que move o mundo.
// ============================================================

let warp = 0; // -2.2 (retrocedendo) .. 0 (loop normal) .. +2.2 (acelerado)

export function getWarp() {
  return warp;
}

export function initInteract({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  let rawV = 0;
  let lastX = null;
  let lastT = 0;

  window.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (lastX !== null) {
      const dt = Math.max(8, now - lastT);
      // px/ms → sinal do movimento horizontal
      rawV = (e.clientX - lastX) / dt;
    }
    lastX = e.clientX;
    lastT = now;
  });

  // vídeos que respondem ao tempo (desktop): mundos + palco quadrado
  const videos = [
    ...document.querySelectorAll('.world--desk, .world--caustics, .world--vortex, .world--cta, .stage-video--desk'),
  ];
  const vstate = new Map(); // video -> { t, manual }

  const visibleOpacity = (el) => {
    const inline = parseFloat(el.style.opacity);
    if (!Number.isNaN(inline)) return inline;
    return parseFloat(getComputedStyle(el).opacity) || 0;
  };

  let prev = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;

    // decaimento do gesto + mola suave até o alvo (baseados em tempo real,
    // pra se comportar igual em 30, 60 ou 120fps)
    rawV *= Math.exp(-7 * dt);
    const target = Math.max(-2.2, Math.min(2.2, rawV * 2.6));
    warp += (target - warp) * (1 - Math.exp(-5.5 * dt));

    const active = Math.abs(warp) > 0.06;

    // escolhe o vídeo mais visível para dirigir manualmente
    let star = null;
    let best = 0.05;
    videos.forEach((v) => {
      const o = visibleOpacity(v);
      if (o > best && v.readyState >= 2 && v.duration) {
        best = o;
        star = v;
      }
    });

    videos.forEach((v) => {
      const st = vstate.get(v);
      if (v === star && active) {
        if (!st || !st.manual) {
          v.pause();
          vstate.set(v, { t: v.currentTime, manual: true });
        }
        const s = vstate.get(v);
        s.t += dt * (1 + warp);
        const d = v.duration;
        s.t = ((s.t % d) + d) % d; // loop nos dois sentidos
        v.currentTime = s.t;
      } else if (st && st.manual) {
        // devolve ao loop nativo de onde parou
        st.manual = false;
        v.play().catch(() => {});
      }
    });
  }

  requestAnimationFrame(frame);
}
