// ============================================================
// VARIANTE C — "O MONÓLITO" (cinema de luxo)
// Filme de marca: composições monumentais centradas, chiaroscuro,
// serif protagonista, toda mídia emergindo da escuridão (feather).
// Tudo global (i18n, preloader, cursor, form, gráfico, smooth
// scroll, scrub de vídeo pelo mouse) vem do variant-core.
// ============================================================

import { bootVariant } from '../js/variant-core.js';
import './monolito.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { svg as animeSvg, utils as animeUtils } from 'animejs';
import { springValue } from 'motion';

gsap.registerPlugin(ScrollTrigger);

// ---------- Strings próprias da variante (prefixo mo.) ----------
const dict = {
  pt: {
    'mo.cap1': 'liquidez em forma pura · 1:1 · loop',
    'mo.s2k': 'o custo do livro aberto',
    'mo.d1n': 'R$ 5.000.000',
    'mo.d1r': 'no mercado aberto.',
    'mo.d2a': 'viraram',
    'mo.d2n': 'R$ 4.966.000.',
    'mo.s3k': 'o que a mesa garante',
    'mo.s7k': 'quem opera assim',
  },
  en: {
    'mo.cap1': 'liquidity in pure form · 1:1 · loop',
    'mo.s2k': 'the cost of the open book',
    'mo.d1n': 'R$ 5,000,000',
    'mo.d1r': 'on the open market.',
    'mo.d2a': 'became',
    'mo.d2n': 'R$ 4,966,000.',
    'mo.s3k': 'what the desk guarantees',
    'mo.s7k': 'who trades this way',
  },
};

const clamp01 = gsap.utils.clamp(0, 1);
const seg = (p, a, b) => clamp01((p - a) / (b - a));

// ============================================================
// PREÇO QUE TRAVA — mecânica local (regra 6)
// spans de dígito; os não-travados embaralham a ~11fps num ticker
// ligado só com a cena por perto; o progresso do pin dirige a trava.
// ============================================================
let priceChars = [];
let lockedCount = -1;
let priceProgress = 0;

function buildPrice() {
  const el = document.getElementById('moPrice');
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
  lockedCount = -1;
}

function applyLock() {
  const digits = priceChars.filter((s) => !s.classList.contains('is-sep'));
  const locked = Math.floor(priceProgress * (digits.length + 1));
  if (locked === lockedCount) return;
  lockedCount = locked;
  digits.forEach((s, i) => {
    if (i < locked) {
      s.textContent = s.dataset.final;
      s.classList.add('is-locked');
    } else {
      s.classList.remove('is-locked');
    }
  });
}

function scramblePrice() {
  const digits = priceChars.filter((s) => !s.classList.contains('is-sep'));
  for (let i = Math.max(0, lockedCount); i < digits.length; i++) {
    digits[i].textContent = String(Math.floor(Math.random() * 10));
  }
}

// ============================================================
// DRAMA TIPOGRÁFICO (tela 2) — os dígitos caem com física e
// recompõem. Dirigido imperativamente pelo progresso do pin,
// então sobrevive à troca de idioma no meio da cena.
// ============================================================
let fig1Chars = [];
let fig2Chars = [];
let dramaProgress = 0;

function splitFig(id, params) {
  const el = document.getElementById(id);
  if (!el) return [];
  const text = el.textContent;
  el.innerHTML = '';
  const chars = [];
  [...text].forEach((c) => {
    const s = document.createElement('span');
    s.className = 'mo-fchar';
    s.textContent = c;
    params(s);
    el.appendChild(s);
    chars.push(s);
  });
  return chars;
}

function splitFigs() {
  // queda: para baixo, giro amplo, ordem aleatória
  fig1Chars = splitFig('moFig1', (s) => {
    s._dy = 140 + Math.random() * 300;
    s._dx = (Math.random() - 0.5) * 60;
    s._rot = (Math.random() - 0.5) * 220;
    s._st = Math.random();
  });
  // recomposição: chegam de cima, espalhados
  fig2Chars = splitFig('moFig2', (s) => {
    s._dy = -(80 + Math.random() * 220);
    s._dx = (Math.random() - 0.5) * 240;
    s._rot = (Math.random() - 0.5) * 160;
    s._st = Math.random();
  });
}

function setFall(p) {
  const S = 0.45;
  fig1Chars.forEach((c) => {
    const cp = clamp01(p * (1 + S) - c._st * S);
    const e = cp * cp * cp; // easeInCubic: acelera como queda
    c.style.transform = `translate3d(${(e * c._dx).toFixed(1)}px, ${(e * c._dy).toFixed(1)}px, 0) rotate(${(e * c._rot).toFixed(2)}deg)`;
    c.style.opacity = (1 - cp).toFixed(3);
  });
}

function setRise(p) {
  const S = 0.5;
  fig2Chars.forEach((c) => {
    const cp = clamp01(p * (1 + S) - c._st * S);
    const e = 1 - Math.pow(1 - cp, 3); // easeOutCubic: assenta no lugar
    const r = 1 - e;
    c.style.transform = `translate3d(${(r * c._dx).toFixed(1)}px, ${(r * c._dy).toFixed(1)}px, 0) rotate(${(r * c._rot).toFixed(2)}deg)`;
    c.style.opacity = cp.toFixed(3);
  });
}

function applyDrama(p) {
  dramaProgress = p;
  setFall(seg(p, 0.3, 0.47));
  setRise(seg(p, 0.5, 0.68));
}

// ============================================================
// VÍDEOS — carrega ao se aproximar, toca só na viewport (regra 3)
// visibility:hidden avisa o scrub do core que o vídeo saiu de cena.
// ============================================================
function manageVideo(video, triggerEl) {
  if (!video) return;
  ScrollTrigger.create({
    trigger: triggerEl,
    start: 'top 180%',
    once: true,
    onEnter: () => {
      if (video.preload === 'none') {
        video.preload = 'auto';
        try { video.load(); } catch { /* já carregando */ }
      }
    },
  });
  ScrollTrigger.create({
    trigger: triggerEl,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      if (self.isActive) {
        video.style.visibility = '';
        if (video.paused && video.dataset.scrub !== '1') video.play().catch(() => {});
      } else {
        video.style.visibility = 'hidden';
        if (!video.paused) video.pause();
      }
    },
  });
}

// ---------- Contador mínimo '01 — 09' (rodapé central) ----------
function initCounter() {
  const num = document.getElementById('moSceneNum');
  if (!num) return;

  gsap.utils.toArray('[data-scene]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 45%',
      onToggle: (self) => {
        if (self.isActive) num.textContent = sec.dataset.scene;
      },
    });
  });

  // o dossiê fecha a contagem em 09 sem alterar o HTML verbatim
  ScrollTrigger.create({
    trigger: '.dossier',
    start: 'top 55%',
    end: 'bottom bottom',
    onToggle: (self) => {
      if (self.isActive) num.textContent = '09';
    },
  });
}

// ============================================================
// CENAS
// ============================================================
function initScenes({ reduced }) {
  buildPrice();

  if (reduced) {
    // tudo visível e legível, sem pins, sem vídeo rodando
    priceProgress = 1;
    applyLock();
    document.addEventListener('langchange', () => {
      buildPrice();
      applyLock();
    });
    const hero = document.querySelector('.mo-eclipse-video');
    if (hero) {
      hero.removeAttribute('autoplay');
      hero.pause();
    }
    gsap.set(
      [
        '.mo-progress', '.mo-kicker', '.mo-cap', '.mo-eclipse', '.mo-s1-sub', '.mo-s1-cta',
        '.mo-act', '.mo-note', '.mo-band', '.mo-word', '.mo-s3-t',
        '.mo-s4-label', '.mo-price', '.mo-s4-t', '.mo-s4-sub', '.mo-shard',
        '.mo-exec', '.mo-exec-sub', '.mo-s6-t', '.mo-s6-sub', '.mo-receipt',
        '.mo-c-sub', '.s8-form', '.mo-sig',
      ],
      { autoAlpha: 1 }
    );
    initCounter();
    return;
  }

  splitFigs();
  document.addEventListener('langchange', () => {
    buildPrice();
    applyLock();
    splitFigs();
    applyDrama(dramaProgress);
  });

  // ---------- reveals obrigatórios (as variantes não herdam do core) ----------
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 88%',
    once: true,
    onEnter: (els) =>
      gsap.fromTo(
        els,
        { opacity: 0, y: 36 },
        { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, overwrite: true }
      ),
  });
  gsap.utils.toArray('.inst-title').forEach((t) =>
    gsap.fromTo(
      t.querySelectorAll('.line-inner'),
      { yPercent: 115 },
      {
        yPercent: 0,
        duration: 1,
        ease: 'power4.out',
        stagger: 0.1,
        scrollTrigger: { trigger: t, start: 'top 82%', once: true },
      }
    )
  );

  // ============================================================
  // TELA 1 — pin +=80%: o eclipse respira, o filme segue
  // ============================================================
  // zoom lentíssimo permanente no vídeo do eclipse
  gsap.to('.mo-eclipse-video', {
    scale: 1.06,
    duration: 12,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
  });

  gsap
    .timeline({
      defaults: { ease: 'power2.out' },
      scrollTrigger: {
        trigger: '.mo-s1',
        start: 'top top',
        end: '+=80%',
        pin: true,
        scrub: 0.6,
        anticipatePin: 1,
      },
    })
    .to('.mo-s1-pre', { autoAlpha: 0, y: -16, duration: 0.5 }, 0)
    .to('.mo-cap', { autoAlpha: 0, duration: 0.4 }, 0.1)
    .to('.mo-s1-sub', { autoAlpha: 0, y: -20, duration: 0.6 }, 0.15)
    .to('.mo-s1-cta', { autoAlpha: 0, y: -14, duration: 0.5 }, 0.2)
    .to('.mo-s1-title', { y: -70, duration: 2, ease: 'none' }, 0)
    .to('.mo-eclipse', { scale: 0.9, autoAlpha: 0.35, duration: 2, ease: 'none' }, 0)
    .to('.mo-s1-title', { autoAlpha: 0, duration: 0.7 }, 1.3);

  // ============================================================
  // TELA 2 — pin +=200%: três atos; o número desmancha e recompõe
  // ============================================================
  const tl2 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.mo-s2',
      start: 'top top',
      end: '+=200%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
      onUpdate: (self) => applyDrama(self.progress),
    },
  });
  tl2
    .fromTo('.mo-s2-k', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 0.2)
    .fromTo('.mo-note', { autoAlpha: 0 }, { autoAlpha: 0.9, duration: 0.4 }, 0.4)
    // ato 1: a ordem no mercado aberto
    .fromTo('.mo-act1', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.5)
    // (leitura 1.3 → 3.0; a queda dos dígitos acontece em 3.0 → 4.7 via onUpdate)
    .to('.mo-act1 .mo-act-rest', { autoAlpha: 0, y: -20, duration: 0.6 }, 4.2)
    .to('.mo-act1', { autoAlpha: 0, duration: 0.3 }, 4.8)
    // ato 2: o que sobrou (recomposição 5.0 → 6.8 via onUpdate)
    .fromTo('.mo-act2', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 5.0)
    .to('.mo-act2', { autoAlpha: 0, y: -26, duration: 0.5 }, 7.7)
    // ato 3: a sentença, sozinha
    .fromTo('.mo-act3', { autoAlpha: 0, scale: 0.97 }, { autoAlpha: 1, scale: 1, duration: 0.8 }, 8.2)
    .to({}, { duration: 1 }, 9);

  // ============================================================
  // TELA 3 — pin +=180%: a banda de luz abre; promessas uma a uma
  // ============================================================
  const words = gsap.utils.toArray('.mo-word');
  const tl3 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.mo-s3',
      start: 'top top',
      end: '+=180%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
    },
  });
  tl3
    .fromTo('.mo-s3-k', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.2)
    // o horizonte nasce: de fresta a 40vh
    .fromTo(
      '.mo-band',
      { autoAlpha: 0, scaleY: 0.01 },
      { autoAlpha: 1, scaleY: 1, duration: 3, ease: 'power2.inOut' },
      0.3
    )
    // deriva lenta dentro da luz
    .fromTo('.mo-band-video', { xPercent: -3, scale: 1.08 }, { xPercent: 3, ease: 'none', duration: 9.4 }, 0.3);
  words.forEach((w, i) => {
    const at = 2.9 + i * 1.65;
    tl3.fromTo(w, { autoAlpha: 0, y: 46 }, { autoAlpha: 1, y: 0, duration: 0.7 }, at);
    if (i < words.length - 1) {
      tl3.to(w, { autoAlpha: 0, y: -40, duration: 0.55, ease: 'power2.in' }, at + 1.15);
    }
  });
  tl3
    .fromTo('.mo-s3-t', { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 8.9)
    .to({}, { duration: 0.4 }, 9.6);

  // ============================================================
  // TELA 4 — pin +=200%: o shard monumental atrás do preço que trava
  // ============================================================
  const tl4 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.mo-s4',
      start: 'top top',
      end: '+=200%',
      pin: true,
      scrub: 0.6,
      anticipatePin: 1,
      onUpdate: (self) => {
        // a trava começa em 16% e completa em 68% do pin
        priceProgress = seg(self.progress, 0.16, 0.68);
        applyLock();
      },
    },
  });
  tl4
    .fromTo('.mo-shard', { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 1.6 }, 0.2)
    .fromTo('.mo-s4-label', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.5)
    .fromTo('.mo-price', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.9)
    // s4.t em serif entra no fim, quando o preço já está inteiro
    .fromTo('.mo-s4-t', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 7.4)
    .fromTo('.mo-s4-sub', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 8.3)
    .to({}, { duration: 1 }, 9);

  // rotação sutil contínua do cristal
  gsap.to('.mo-shard img', { rotation: 360, duration: 140, ease: 'none', repeat: -1 });

  // embaralhamento em ticker próprio (~11fps), só com a cena na área
  let scrambleTimer = 0;
  ScrollTrigger.create({
    trigger: '.mo-s4',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      clearInterval(scrambleTimer);
      scrambleTimer = 0;
      if (self.isActive) scrambleTimer = setInterval(scramblePrice, 90);
    },
  });

  // parallax de mouse ±10px com mola (motion.dev)
  const shardWrap = document.querySelector('.mo-shard-wrap');
  if (shardWrap && window.matchMedia('(pointer: fine)').matches) {
    const sx = springValue(0, { stiffness: 50, damping: 17 });
    const sy = springValue(0, { stiffness: 50, damping: 17 });
    sx.on('change', (v) => shardWrap.style.setProperty('--px', `${v.toFixed(2)}px`));
    sy.on('change', (v) => shardWrap.style.setProperty('--py', `${v.toFixed(2)}px`));
    window.addEventListener(
      'pointermove',
      (e) => {
        sx.set((e.clientX / window.innerWidth - 0.5) * 20);
        sy.set((e.clientY / window.innerHeight - 0.5) * 20);
      },
      { passive: true }
    );
  }

  // ============================================================
  // TELA 5 — pin +=110%: blackout → a linha corta → "Executado."
  // ============================================================
  gsap
    .timeline({
      defaults: { ease: 'power2.out' },
      scrollTrigger: {
        trigger: '.mo-s5',
        start: 'top top',
        end: '+=110%',
        pin: true,
        scrub: 0.5,
        anticipatePin: 1,
      },
    })
    // ~40% do pin em preto absoluto
    .fromTo('.mo-blackout', { autoAlpha: 1 }, { autoAlpha: 1, duration: 4, ease: 'none' }, 0)
    .fromTo('.mo-cut', { scaleX: 0 }, { scaleX: 1, duration: 1.3, ease: 'power3.inOut' }, 4)
    .to('.mo-blackout', { autoAlpha: 0, duration: 1.2 }, 4.4)
    .fromTo(
      '.mo-exec',
      { autoAlpha: 0, scale: 0.96, clipPath: 'inset(48% 0% 48% 0%)' },
      { autoAlpha: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: 2.2 },
      5.2
    )
    .to('.mo-cut', { opacity: 0.22, duration: 1 }, 6.8)
    .fromTo('.mo-exec-sub', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 7.6)
    .to({}, { duration: 2 }, 8);

  // ============================================================
  // TELA 6 — pin +=170%: o sol do vórtice nasce; recibos em arco
  // ============================================================
  const arcPath = document.querySelector('.mo-arc-path');
  let arcDraw = null;
  if (arcPath) {
    const [d] = animeSvg.createDrawable(arcPath);
    animeUtils.set(d, { draw: '0 0' });
    arcDraw = d;
  }
  const receipts = gsap.utils.toArray('.mo-receipt');

  const tl6 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.mo-s6',
      start: 'top top',
      end: '+=170%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
      onUpdate: (self) => {
        if (arcDraw) animeUtils.set(arcDraw, { draw: `0 ${seg(self.progress, 0.3, 0.72).toFixed(4)}` });
      },
    },
  });
  tl6
    .fromTo('.mo-s6-t', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.4)
    // o sol nasce na metade inferior (mask feather p/ cima, opacidade .35)
    .fromTo('.mo-sun', { autoAlpha: 0, yPercent: 30 }, { autoAlpha: 0.35, yPercent: 0, duration: 3, ease: 'power1.out' }, 0.5);
  receipts.forEach((r, i) => {
    tl6.fromTo(r, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 3.4 + i * 1.1);
  });
  tl6
    .fromTo('.mo-s6-sub', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 8.2)
    .to({}, { duration: 1 }, 9);

  // ============================================================
  // INTERLÚDIO — a esfera atravessa devagar (parallax de scroll)
  // ============================================================
  gsap.fromTo(
    '.mo-sphere',
    { yPercent: 22 },
    {
      yPercent: -22,
      ease: 'none',
      scrollTrigger: { trigger: '.mo-interlude', start: 'top bottom', end: 'bottom top', scrub: true },
    }
  );

  // ============================================================
  // TELA 8 — o convite: título máximo + form em hairlines
  // ============================================================
  gsap.fromTo(
    '.mo-c-title .line-inner',
    { yPercent: 115 },
    {
      yPercent: 0,
      duration: 1.1,
      ease: 'power4.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.mo-contact', start: 'top 72%', once: true },
    }
  );
  gsap.fromTo(
    '.mo-c-sub',
    { autoAlpha: 0, y: 14 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.8,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mo-contact', start: 'top 62%', once: true },
    }
  );
  gsap.fromTo(
    '.s8-form',
    { opacity: 0, y: 36 },
    {
      opacity: 1,
      y: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.s8-form', start: 'top 88%', once: true },
    }
  );
  gsap.fromTo(
    '.mo-sig',
    { autoAlpha: 0, y: 24 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 1,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.mo-contact', start: 'top 45%', once: true },
    }
  );

  // ---------- vídeos: pausa fora da viewport + load por proximidade ----------
  manageVideo(document.querySelector('.mo-eclipse-video'), '.mo-s1');
  manageVideo(document.querySelector('.mo-band-video'), '.mo-s3');
  manageVideo(document.querySelector('.mo-sun-video'), '.mo-s6');

  // ---------- contador (depois dos pins, para medir certo) ----------
  initCounter();
}

// ============================================================
// INTRO — o eclipse nasce, o título sobe por linhas
// ============================================================
function runIntro({ reduced }) {
  if (reduced) return;

  gsap
    .timeline({ defaults: { ease: 'power4.out' } })
    .fromTo(
      '.mo-eclipse',
      { autoAlpha: 0, scale: 0.82 },
      { autoAlpha: 1, scale: 1, duration: 1.9, ease: 'power3.out' },
      0
    )
    .fromTo('.mo-s1-pre', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.5)
    .fromTo(
      '.mo-s1-title .line-inner',
      { yPercent: 115 },
      { yPercent: 0, duration: 1.25, stagger: 0.14 },
      0.55
    )
    .fromTo('.mo-s1-sub', { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.95)
    .fromTo('.mo-s1-cta', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 1.1)
    .fromTo('.mo-cap', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7 }, 1.3)
    .fromTo('.mo-progress', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7 }, 1.4);
}

bootVariant({ dict, initScenes, runIntro });
