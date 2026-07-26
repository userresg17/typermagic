import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { startNoise, stopNoise, setNoiseIntensity } from './noise.js';

gsap.registerPlugin(ScrollTrigger);

// ============================================================
// A OPERAÇÃO INVISÍVEL — orquestração das 9 cenas.
// O scroll é a linha do tempo; a história acontece em off.
// ============================================================

let blobApi = { setProgress() {} };

// ---------- Intro (depois do preloader) ----------
export function runIntro({ reduced }) {
  if (reduced) return;

  gsap.fromTo(
    '.s0-pre',
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 1, ease: 'power2.out', delay: 0.1 }
  );
  gsap.fromTo(
    '.s0-title .line-inner',
    { yPercent: 115, y: 0 },
    { yPercent: 0, duration: 1.2, ease: 'power4.out', stagger: 0.14, delay: 0.35 }
  );
  gsap.fromTo(
    '.s0-sub',
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 1, ease: 'power2.out', delay: 0.85 }
  );
  gsap.fromTo(
    ['.hud', '.journey', '.s0-cta'],
    { opacity: 0 },
    { opacity: 1, duration: 1, ease: 'power2.out', delay: 1, stagger: 0.1 }
  );
}

// ---------- Mundos em crossfade (a essência da referência) ----------
// rampa: 0 → sobe (a..b) → 1 → desce (c..d) → 0
function ramp(p, a, b, c, d) {
  if (p < a) return 0;
  if (p < b) return (p - a) / (b - a);
  if (p < c) return 1;
  if (p < d) return 1 - (p - c) / (d - c);
  return 0;
}

// Faixas em "espaço de cenas": 9 cenas = 9 fatias iguais de 0..1,
// independente de quanto scroll cada pin consome de verdade.
const WORLD_MAP = [
  { key: 'particles', peak: 0.5, a: -1, b: 0, c: 0.167, d: 0.25 },
  { key: 'caustics', peak: 0.35, a: 0.3, b: 0.375, c: 0.53, d: 0.61 },
  { key: 'vortex', peak: 0.3, a: 0.64, b: 0.72, c: 0.83, d: 0.875 },
  { key: 'cta', peak: 0.35, a: 0.86, b: 0.93, c: 1.01, d: 1.02 },
];

// ---------- Normalização do progresso ----------
// Converte a fração de scroll bruta em progresso narrativo uniforme:
// cada cena vale exatamente 1/9, com pins e alturas reais medidos no refresh.
let bounds = [];

function computeBounds() {
  const max = ScrollTrigger.maxScroll(window);
  if (!max) return;
  const box = (el) =>
    el.parentElement.classList.contains('pin-spacer') ? el.parentElement : el;
  bounds = [...document.querySelectorAll('.scene')].map(
    (el) => box(el).offsetTop / max
  );
  const dossier = document.querySelector('.dossier');
  bounds.push(dossier ? dossier.offsetTop / max : 1);
}

function normProgress(p) {
  const n = bounds.length - 1;
  if (n < 1) return p;
  if (p >= bounds[n]) return 1;
  let i = 0;
  while (i < n - 1 && p >= bounds[i + 1]) i++;
  const span = bounds[i + 1] - bounds[i] || 1;
  const local = Math.max(0, Math.min(1, (p - bounds[i]) / span));
  return (i + local) / n;
}

let worldEls = null;

function updateWorlds(p) {
  if (!worldEls) {
    worldEls = WORLD_MAP.map((w) => ({
      ...w,
      els: [...document.querySelectorAll(`[data-world="${w.key}"]`)],
    }));
  }
  worldEls.forEach((w) => {
    const o = ramp(p, w.a, w.b, w.c, w.d) * w.peak;
    w.els.forEach((el) => {
      el.style.opacity = o.toFixed(3);
    });
  });
}

// ---------- Preço que trava dígito por dígito ----------
let priceChars = [];

function buildPrice() {
  const el = document.getElementById('price');
  if (!el) return;
  const text = el.textContent;
  el.innerHTML = '';
  priceChars = [];
  [...text].forEach((c) => {
    const s = document.createElement('span');
    s.className = 'ch' + (/\d/.test(c) ? '' : ' is-sep is-locked');
    s.textContent = c;
    s.dataset.final = c;
    el.appendChild(s);
    priceChars.push(s);
  });
}

function setPriceLock(progress) {
  const digits = priceChars.filter((s) => !s.classList.contains('is-sep'));
  const locked = Math.floor(progress * (digits.length + 1));
  digits.forEach((s, i) => {
    if (i < locked) {
      s.textContent = s.dataset.final;
      s.classList.add('is-locked');
    } else {
      s.classList.remove('is-locked');
      s.textContent = String(Math.floor(Math.random() * 10));
    }
  });
}

// ---------- Cenas ----------
export function initScenes({ reduced, blob }) {
  blobApi = blob || blobApi;

  const stage = document.getElementById('stage');
  const setStageVar = (k, v) => stage.style.setProperty(k, v);

  if (reduced) {
    // Sem movimento: tudo visível, sem pins.
    gsap.set(
      [
        '.s0-pre', '.s0-sub', '.s0-cta', '.scene-1 .big', '.s2-a', '.s2-b', '.s3-t', '.s4-label',
        '.s4-t', '.s4-sub', '.s5-t', '.s5-sub', '.s6-t', '.s6-sub',
        '.receipt', '.s7-t', '.s8-btn', '.s8-sub', '.hud', '.journey',
      ],
      { opacity: 1 }
    );
    gsap.set('.door-line', { scaleX: 1 });
    gsap.set('.exec-line', { scaleX: 1 });
    buildPrice();
    setPriceLock(1);
    setStageVar('--bs', '0.7');
    return;
  }

  // ----- Jornada global: dirige mundos, blob 3D, régua e fallback CSS -----
  ScrollTrigger.addEventListener('refresh', computeBounds);

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    scrub: true,
    onUpdate: (self) => {
      const raw = ScrollTrigger.maxScroll(window)
        ? self.scroll() / ScrollTrigger.maxScroll(window)
        : 0;
      const p = normProgress(raw); // progresso narrativo (1/9 por cena)
      blobApi.setProgress(p);
      updateWorlds(p);
      document.getElementById('journeyBar').style.transform = `scaleY(${p})`;
      const marker = document.getElementById('journeyMarker');
      if (marker) marker.style.top = `${(p * 100).toFixed(2)}%`;
      const num = document.getElementById('journeyNum');
      if (num) num.textContent = String(Math.min(8, Math.floor(p * 9)) + 1).padStart(2, '0');
      // fallback CSS acompanha em versão simplificada (grade de nonos)
      const s =
        p < 0.11 ? 0.42 :
        p < 0.33 ? gsap.utils.mapRange(0.11, 0.33, 0.42, 1.05, p) :
        p < 0.44 ? 1.05 :
        p < 0.67 ? gsap.utils.mapRange(0.44, 0.67, 1.05, 0.55, p) :
        p < 0.89 ? 0.8 : 0.55;
      setStageVar('--bs', s.toFixed(3));
      setStageVar('--bop', p > 0.556 && p < 0.667 ? '0.25' : '1');
      // curva do palco mobile: protagonista na abertura, coadjuvante no meio
      const mvo =
        p < 0.08 ? 0.85 :
        p < 0.2 ? gsap.utils.mapRange(0.08, 0.2, 0.85, 0.2, p) :
        p < 0.83 ? 0.2 :
        gsap.utils.mapRange(0.83, 1, 0.2, 0.45, p);
      setStageVar('--mvo', mvo.toFixed(3));
    },
  });

  // ----- CENA 0: o título sai de cena com blur -----
  gsap.to('.s0-title', {
    yPercent: -26,
    opacity: 0,
    filter: 'blur(10px)',
    ease: 'none',
    scrollTrigger: { trigger: '.scene-0', start: 'center center', end: 'bottom top', scrub: true },
  });
  gsap.to(['.s0-pre', '.s0-sub', '.s0-cta'], {
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.scene-0', start: 'center center', end: '75% top', scrub: true },
  });

  // ----- Preço que trava (estado compartilhado com o pin da cena 4) -----
  buildPrice();
  let lastPriceProgress = 0;
  document.addEventListener('langchange', () => {
    buildPrice();
    setPriceLock(lastPriceProgress);
  });

  // ----- Cenas pinadas: coreografia separada por dispositivo -----
  // Mobile NÃO é desktop encolhido: pins mais curtos (scroll de polegar),
  // beats mais rápidos, mesmas batidas da história.
  const mm = gsap.matchMedia();

  mm.add(
    {
      isDesktop: '(min-width: 721px) and (pointer: fine)',
      isMobile: '(max-width: 720px), (pointer: coarse)',
    },
    (ctx) => {
      const { isMobile } = ctx.conditions;
      const cfg = isMobile
        ? { s1: '+=110%', s2: '+=100%', s4: '+=150%', s5: '+=90%', scrub: 0.35 }
        : { s1: '+=160%', s2: '+=140%', s4: '+=200%', s5: '+=120%', scrub: 0.55 };

      // ----- CENA 1: ruído do mercado (pinada) -----
      const s1 = gsap.timeline({
        scrollTrigger: {
          trigger: '.scene-1',
          start: 'top top',
          end: cfg.s1,
          pin: true,
          scrub: cfg.scrub,
          onEnter: startNoise,
          onEnterBack: startNoise,
          onLeave: stopNoise,
          onLeaveBack: stopNoise,
          onUpdate: (self) => setNoiseIntensity(1 - self.progress * 0.92),
        },
      });
      s1.fromTo('.s1-a', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.18 }, 0.05)
        .fromTo('.s1-b', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.18 }, 0.3)
        .fromTo('.s1-c', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.2 }, 0.55)
        .to('.scene-1 .scene-copy', { opacity: 0, filter: 'blur(8px)', duration: 0.18 }, 0.85);

      // ----- CENA 2: a porta (pinada) -----
      const s2 = gsap.timeline({
        scrollTrigger: {
          trigger: '.scene-2',
          start: 'top top',
          end: cfg.s2,
          pin: true,
          scrub: cfg.scrub,
        },
      });
      s2.fromTo('.s2-a', { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0.04)
        .fromTo('.door-line', { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power2.inOut' }, 0.12)
        .to('.s2-a', { opacity: 0, duration: 0.1 }, 0.42)
        .to('.door-line', { opacity: 0, boxShadow: '0 0 90px rgba(167,139,250,1)', duration: 0.18 }, 0.5)
        .fromTo('.s2-b', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.16 }, 0.62)
        .to('.s2-b', { opacity: 0, duration: 0.12 }, 0.9);

      // ----- CENA 4: o preço trava (pinada) -----
      const s4 = gsap.timeline({
        scrollTrigger: {
          trigger: '.scene-4',
          start: 'top top',
          end: cfg.s4,
          pin: true,
          scrub: cfg.scrub,
          onUpdate: (self) => {
            lastPriceProgress = gsap.utils.clamp(
              0, 1,
              gsap.utils.mapRange(0.15, 0.75, 0, 1, self.progress)
            );
            setPriceLock(lastPriceProgress);
          },
        },
      });
      s4.fromTo('.s4-label', { opacity: 0 }, { opacity: 1, duration: 0.08 }, 0.02)
        .fromTo('.price', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.12 }, 0.06)
        .fromTo('.s4-t', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.12 }, 0.72)
        .fromTo('.s4-sub', { opacity: 0 }, { opacity: 1, duration: 0.1 }, 0.82);

      // ----- CENA 5: a execução (pinada, rápida e seca) -----
      const s5 = gsap.timeline({
        scrollTrigger: {
          trigger: '.scene-5',
          start: 'top top',
          end: cfg.s5,
          pin: true,
          scrub: isMobile ? 0.3 : 0.4,
        },
      });
      s5.fromTo('.exec-line', { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power3.in' }, 0.05)
        .to('.exec-flash', { opacity: 0.9, duration: 0.03 }, 0.36)
        .to('.exec-flash', { opacity: 0, duration: 0.12 }, 0.4)
        .to('.exec-line', { opacity: 0, duration: 0.1 }, 0.4)
        .fromTo('.s5-t', { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.18 }, 0.45)
        .fromTo('.s5-sub', { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0.6);

      return () => [s1, s2, s4, s5].forEach((tl) => tl.scrollTrigger?.kill());
    }
  );

  // ----- CENA 3: a mesa — palavras derivam em profundidades -----
  document.querySelectorAll('.scene-3 [data-depth], .scene-6 [data-depth], .scene-4 [data-depth], .scene-7 [data-depth]').forEach((el) => {
    const depth = parseFloat(el.dataset.depth);
    gsap.fromTo(
      el,
      { yPercent: depth * 2.4 },
      {
        yPercent: -depth * 2.4,
        ease: 'none',
        scrollTrigger: { trigger: el.closest('.scene'), start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  });

  gsap.fromTo(
    '.drift-word',
    { opacity: 0 },
    {
      opacity: 0.9,
      stagger: 0.12,
      duration: 0.5,
      scrollTrigger: { trigger: '.scene-3', start: 'top 60%', end: 'center center', scrub: true },
    }
  );
  gsap.fromTo(
    '.s3-t',
    { opacity: 0, y: 24 },
    {
      opacity: 1,
      y: 0,
      scrollTrigger: { trigger: '.scene-3', start: '30% 60%', end: 'center 45%', scrub: true },
    }
  );

  // ----- CENA 6: a liquidação — amanhecer -----
  gsap.fromTo(
    '#dawn',
    { opacity: 0 },
    {
      opacity: 1,
      ease: 'none',
      scrollTrigger: { trigger: '.scene-6', start: 'top 80%', end: 'center center', scrub: true },
    }
  );
  gsap.to('#dawn', {
    opacity: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.scene-7', start: 'top 60%', end: 'center center', scrub: true },
  });
  gsap.fromTo(
    '.s6-t',
    { opacity: 0, y: 34 },
    { opacity: 1, y: 0, scrollTrigger: { trigger: '.scene-6', start: 'top 55%', end: 'center 55%', scrub: true } }
  );
  gsap.fromTo(
    '.s6-sub',
    { opacity: 0, y: 20 },
    { opacity: 1, y: 0, scrollTrigger: { trigger: '.scene-6', start: '20% 55%', end: 'center 45%', scrub: true } }
  );
  gsap.fromTo(
    '.receipt',
    { opacity: 0 },
    {
      opacity: 1,
      stagger: 0.1,
      scrollTrigger: { trigger: '.scene-6', start: '25% 60%', end: '65% 45%', scrub: true },
    }
  );

  // ----- CENA 7: fantasmas cruzam a tela -----
  document.querySelectorAll('.ghost').forEach((g, i) => {
    gsap.fromTo(
      g,
      { xPercent: i % 2 ? 18 : -18 },
      {
        xPercent: i % 2 ? -18 : 18,
        ease: 'none',
        scrollTrigger: { trigger: '.scene-7', start: 'top bottom', end: 'bottom top', scrub: true },
      }
    );
  });
  gsap.fromTo(
    '.s7-t',
    { opacity: 0, y: 26 },
    { opacity: 1, y: 0, scrollTrigger: { trigger: '.scene-7', start: 'top 50%', end: 'center 45%', scrub: true } }
  );

  // ----- CENA 8: o fim -----
  gsap.fromTo(
    '.s8-t .line-inner',
    { yPercent: 115, y: 0 },
    {
      yPercent: 0,
      duration: 1.05,
      ease: 'power4.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.scene-8', start: 'top 65%', once: true },
    }
  );
  gsap.fromTo(
    ['.s8-btn', '.s8-sub'],
    { opacity: 0, y: 22 },
    {
      opacity: 1,
      y: 0,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.scene-8', start: 'top 55%', once: true },
    }
  );
}
