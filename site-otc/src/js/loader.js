// ============================================================
// CARREGAMENTO INTELIGENTE
// 1) Preloader com progresso REAL: a tela de load só libera quando
//    fontes + palco + mundo 1 estão prontos de verdade.
// 2) Prefetch por proximidade: os mundos das próximas cenas baixam
//    em background ANTES do usuário chegar — nunca recarrega nada.
// ============================================================

export const isMobile = () =>
  window.matchMedia('(max-width: 720px), (pointer: coarse)').matches;

function videoReady(v, timeout = 9000) {
  return new Promise((resolve) => {
    if (!v) return resolve();
    if (v.readyState >= 3) return resolve();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeout); // rede lenta não prende o site
    v.addEventListener('canplaythrough', done, { once: true });
    v.addEventListener('error', done, { once: true });
    v.preload = 'auto';
    try { v.load(); } catch { /* já carregando */ }
  });
}

function imgReady(src) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = i.onerror = () => resolve();
    i.src = src;
  });
}

// Palco certo por dispositivo: o vídeo que não se aplica nem decodifica.
export function initStageMedia() {
  const mob = isMobile();
  const off = document.querySelector(mob ? '.stage-video--desk' : '.stage-video--mob');
  if (off) {
    off.removeAttribute('autoplay');
    off.preload = 'none';
    off.pause();
  }
}

// Assets críticos do primeiro quadro — o preloader espera por isto.
// Páginas de variante marcam os seus com data-preload="critical".
export function preloadCritical(onProgress) {
  const mob = isMobile();
  const marked = [...document.querySelectorAll('video[data-preload="critical"]')];
  const tasks = [
    document.fonts ? document.fonts.ready.then(() => {}) : Promise.resolve(),
    imgReady('assets/img/poster-blob.jpg'),
    ...(marked.length
      ? marked.map((v) => videoReady(v))
      : [
          videoReady(document.querySelector(mob ? '.stage-video--mob' : '.stage-video--desk')),
          videoReady(document.querySelector(mob ? '.world--particles.world--mob' : '.world--particles.world--desk')),
        ]),
  ];
  let done = 0;
  return Promise.all(
    tasks.map((p) =>
      p.then(() => {
        done += 1;
        onProgress?.(done / tasks.length);
      })
    )
  );
}

// Mundos futuros baixam quando a jornada se aproxima deles.
const PREFETCH = [
  { key: 'caustics', at: 0.16 }, // baixa durante a cena do ruído
  { key: 'vortex', at: 0.5 },    // baixa durante a cena do preço
  { key: 'cta', at: 0.72 },      // baixa durante a liquidação
];
const fetched = new Set();

export function prefetchByProgress(p) {
  for (const f of PREFETCH) {
    if (p >= f.at && !fetched.has(f.key)) {
      fetched.add(f.key);
      document.querySelectorAll(`[data-world="${f.key}"]`).forEach((v) => {
        v.preload = 'auto';
        try { v.load(); } catch { /* sem src ainda (asset pendente) */ }
      });
    }
  }
}
