// ============================================================
// VARIANTE A — "A GALERIA" (private bank editorial)
// Assets emoldurados como obras, grid fantasma, pins com scrub.
// Tudo que é global (i18n, preloader, cursor, form, gráfico,
// smooth scroll, scrub de vídeo pelo mouse) vem do variant-core.
// ============================================================

import { bootVariant } from '../js/variant-core.js';
import './galeria.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { animate as animeAnimate, svg as animeSvg, utils as animeUtils } from 'animejs';
import { springValue } from 'motion';

gsap.registerPlugin(ScrollTrigger);

// ---------- Strings próprias da variante (prefixo ga.) ----------
const dict = {
  pt: {
    'ga.caption1': 'execução institucional · 001',
    'ga.caption2': 'a mesa · 24/7',
    'ga.caption3': 'liquidez em movimento · 002',
    'ga.book': 'mercado aberto · ordem de R$ 5.000.000',
    'ga.b1': 'R$ 591.200 × 0,6 BTC',
    'ga.b2': 'R$ 590.600 × 0,9 BTC',
    'ga.b3': 'R$ 589.800 × 1,1 BTC',
    'ga.b4': 'R$ 588.900 × 0,8 BTC',
    'ga.b5': 'R$ 587.700 × 1,3 BTC',
    'ga.b6': 'R$ 586.400 × 1,2 BTC',
    'ga.b7': 'R$ 585.100 × 1,4 BTC',
    'ga.b8': 'R$ 583.600 × 1,2 BTC',
    'ga.d1': '−0,00%',
    'ga.d2': '−0,10%',
    'ga.d3': '−0,24%',
    'ga.d4': '−0,39%',
    'ga.d5': '−0,59%',
    'ga.d6': '−0,81%',
    'ga.d7': '−1,03%',
    'ga.d8': '−1,29%',
    'ga.slip': 'custo do slippage: −R$ 34.000',
    'ga.receipt': 'comprovante de liquidação · T+0',
    'ga.receiptMeta': 'op. nº 000841 · btc → brl',
    'ga.receiptEnd': '— fim do comprovante —',
  },
  en: {
    'ga.caption1': 'institutional execution · 001',
    'ga.caption2': 'the desk · 24/7',
    'ga.caption3': 'liquidity in motion · 002',
    'ga.book': 'open market · R$ 5,000,000 order',
    'ga.b1': 'R$ 591,200 × 0.6 BTC',
    'ga.b2': 'R$ 590,600 × 0.9 BTC',
    'ga.b3': 'R$ 589,800 × 1.1 BTC',
    'ga.b4': 'R$ 588,900 × 0.8 BTC',
    'ga.b5': 'R$ 587,700 × 1.3 BTC',
    'ga.b6': 'R$ 586,400 × 1.2 BTC',
    'ga.b7': 'R$ 585,100 × 1.4 BTC',
    'ga.b8': 'R$ 583,600 × 1.2 BTC',
    'ga.d1': '−0.00%',
    'ga.d2': '−0.10%',
    'ga.d3': '−0.24%',
    'ga.d4': '−0.39%',
    'ga.d5': '−0.59%',
    'ga.d6': '−0.81%',
    'ga.d7': '−1.03%',
    'ga.d8': '−1.29%',
    'ga.slip': 'slippage cost: −R$ 34,000',
    'ga.receipt': 'settlement receipt · T+0',
    'ga.receiptMeta': 'op. no. 000841 · btc → brl',
    'ga.receiptEnd': '— end of receipt —',
  },
};

// ============================================================
// PREÇO QUE TRAVA — mecânica local (regra 6)
// spans de dígito; não-travados embaralham a ~11fps num ticker
// próprio ligado só com a cena por perto; o pin dirige a trava.
// ============================================================
let priceChars = [];
let lockedCount = -1;
let priceProgress = 0;

function buildPrice() {
  const el = document.getElementById('gaPrice');
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
// VÍDEOS — carrega ao se aproximar, toca só na viewport (regra 3)
// visibility:hidden avisa o scrub do core que o vídeo está fora.
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

// ---------- Régua da jornada (o core não a dirige nas variantes) ----------
function initJourney() {
  const bar = document.getElementById('journeyBar');
  const marker = document.getElementById('journeyMarker');
  const num = document.getElementById('journeyNum');

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      if (bar) bar.style.transform = `scaleY(${self.progress.toFixed(4)})`;
      if (marker) marker.style.top = `${(self.progress * 100).toFixed(2)}%`;
    },
  });

  gsap.utils.toArray('[data-scene]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => {
        if (self.isActive && num) num.textContent = sec.dataset.scene;
      },
    });
  });

  // dossiê fecha a régua em 09 sem alterar o HTML verbatim
  ScrollTrigger.create({
    trigger: '.dossier',
    start: 'top 50%',
    end: 'bottom bottom',
    onToggle: (self) => {
      if (self.isActive && num) num.textContent = '09';
    },
  });
}

// ============================================================
// CENAS
// ============================================================
function initScenes({ reduced }) {
  buildPrice();
  document.addEventListener('langchange', () => {
    buildPrice();
    applyLock();
  });

  const checkPaths = gsap.utils.toArray('.ga-check path');
  const receiptRows = gsap.utils.toArray('.ga-rrow');

  if (reduced) {
    // tudo visível, sem pins, sem vídeo rodando (CSS reduced cobre o resto)
    priceProgress = 1;
    applyLock();
    receiptRows.forEach((r) => r.classList.add('is-done'));
    const hero = document.querySelector('.ga-hero-video');
    if (hero) {
      hero.removeAttribute('autoplay');
      hero.pause();
    }
    gsap.set('.s8-form', { opacity: 1 });
    initJourney();
    return;
  }

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
      { yPercent: 115, y: 0 },
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
  // TELA 1 — pin +=70%: parallax sutil; o texto já entrou no intro
  // ============================================================
  gsap
    .timeline({
      scrollTrigger: {
        trigger: '.ga-s1',
        start: 'top top',
        end: '+=70%',
        pin: true,
        scrub: 0.7,
        anticipatePin: 1,
      },
    })
    .to('.ga-frame--hero', { y: -46, ease: 'none' }, 0)
    .to('.ga-strip', { yPercent: 18, ease: 'none' }, 0)
    .to('.ga-s1-copy', { opacity: 0.3, y: -34, ease: 'power1.in', duration: 0.5 }, 0.5)
    .to('.ga-s1-art', { opacity: 0.45, ease: 'power1.in', duration: 0.35 }, 0.65);

  // ============================================================
  // TELA 2 — pin +=160%: o livro preenche linha a linha
  // ============================================================
  const rows = gsap.utils.toArray('.ga-row:not(.ga-row--slip)');
  const tl2 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.ga-s2',
      start: 'top top',
      end: '+=160%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
    },
  });
  tl2
    .fromTo('.ga-s2a', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0)
    .fromTo('.ga-s2b', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.5);
  rows.forEach((row, i) => {
    tl2.fromTo(row, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.45 }, 1.5 + i * 0.62);
  });
  tl2
    .fromTo('.ga-row--slip', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 6.9)
    .fromTo(
      '.ga-row--slip',
      { backgroundColor: 'rgba(248, 113, 113, 0.16)' },
      { backgroundColor: 'rgba(248, 113, 113, 0)', duration: 0.9, ease: 'power1.out' },
      7.1
    )
    .fromTo('.ga-book-note', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4 }, 7.6)
    .fromTo('.ga-s2c', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 8.2)
    .to({}, { duration: 1.2 }, 9); // segura o quadro com tudo lido

  // ============================================================
  // TELA 3 — pin +=180%: promessas UMA POR VEZ sobre a banda de luz
  // ============================================================
  const words = gsap.utils.toArray('.ga-word');
  const tl3 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.ga-s3',
      start: 'top top',
      end: '+=180%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
    },
  });
  tl3
    .fromTo('.ga-band-cap', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.15)
    .fromTo('.ga-s3t', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.3)
    .to('.ga-band-video', { xPercent: -5, ease: 'none', duration: 9.5 }, 0);
  words.forEach((w, i) => {
    const at = 0.5 + i * 2.15;
    tl3.fromTo(w, { autoAlpha: 0, y: 46 }, { autoAlpha: 1, y: 0, duration: 0.75 }, at);
    tl3.to(w, { autoAlpha: 0, y: -42, duration: 0.6, ease: 'power2.in' }, at + (i === words.length - 1 ? 1.85 : 1.55));
  });
  tl3.to({}, { duration: 0.4 }, 9.6);

  // ============================================================
  // TELA 4 — pin +=200%: o preço trava dígito a dígito
  // ============================================================
  const tl4 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.ga-s4',
      start: 'top top',
      end: '+=200%',
      pin: true,
      scrub: 0.6,
      anticipatePin: 1,
      onUpdate: (self) => {
        // a trava começa em 18% e completa em 72% do pin
        priceProgress = gsap.utils.clamp(0, 1, (self.progress - 0.18) / 0.54);
        applyLock();
      },
    },
  });
  tl4
    .fromTo('.ga-s4-label', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.2)
    .fromTo('.ga-price', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.6)
    .fromTo('.ga-s4t', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 7.6)
    .fromTo('.ga-s4sub', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 8.4)
    .to({}, { duration: 1 }, 9);

  // embaralhamento em ticker próprio (~11fps), só com a cena na área
  let scrambleTimer = 0;
  ScrollTrigger.create({
    trigger: '.ga-s4',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      clearInterval(scrambleTimer);
      scrambleTimer = 0;
      if (self.isActive) scrambleTimer = setInterval(scramblePrice, 90);
    },
  });

  // shard com parallax de mola (motion.dev) — leve, só pointer fino
  const shard = document.querySelector('.ga-shard');
  if (shard && window.matchMedia('(pointer: fine)').matches) {
    const sx = springValue(0, { stiffness: 55, damping: 16 });
    const sy = springValue(0, { stiffness: 55, damping: 16 });
    sx.on('change', (v) => shard.style.setProperty('--px', `${v.toFixed(2)}px`));
    sy.on('change', (v) => shard.style.setProperty('--py', `${v.toFixed(2)}px`));
    window.addEventListener(
      'pointermove',
      (e) => {
        sx.set((e.clientX / window.innerWidth - 0.5) * -30);
        sy.set((e.clientY / window.innerHeight - 0.5) * -22);
      },
      { passive: true }
    );
  }

  // ============================================================
  // TELA 5 — pin +=120%: a linha varre, flash, "Executado."
  // ============================================================
  const tl5 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.ga-s5',
      start: 'top top',
      end: '+=120%',
      pin: true,
      scrub: 0.6,
      anticipatePin: 1,
    },
  });
  tl5
    .fromTo('.ga-exec-line', { scaleX: 0 }, { scaleX: 1, duration: 3, ease: 'none' }, 0)
    .to('.ga-exec-flash', { opacity: 0.85, duration: 0.22, ease: 'power1.in' }, 2.85)
    .to('.ga-exec-flash', { opacity: 0, duration: 0.9, ease: 'power2.out' }, 3.1)
    .fromTo('.ga-s5t', { autoAlpha: 0, scale: 0.94, y: 24 }, { autoAlpha: 1, scale: 1, y: 0, duration: 1.2 }, 3.2)
    .fromTo('.ga-s5sub', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7 }, 4.5)
    .to('.ga-exec-line', { opacity: 0.25, duration: 1 }, 5.4)
    .to({}, { duration: 1 }, 9);

  // ============================================================
  // TELA 6 — pin +=140%: extrato com ✓ desenhados a traço (anime.js)
  // ============================================================
  const drawables = checkPaths.map((p) => {
    const [d] = animeSvg.createDrawable(p);
    animeUtils.set(d, { draw: '0 0' });
    return d;
  });
  const CHECK_AT = [0.3, 0.44, 0.58, 0.72];
  const checkDone = CHECK_AT.map(() => false);

  const tl6 = gsap.timeline({
    defaults: { ease: 'power2.out' },
    scrollTrigger: {
      trigger: '.ga-s6',
      start: 'top top',
      end: '+=140%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
      onUpdate: (self) => {
        CHECK_AT.forEach((at, i) => {
          if (!drawables[i]) return;
          if (self.progress >= at && !checkDone[i]) {
            checkDone[i] = true;
            animeAnimate(drawables[i], { draw: '0 1', duration: 480, ease: 'outQuad' });
            receiptRows[i]?.classList.add('is-done');
          } else if (self.progress < at - 0.05 && checkDone[i]) {
            checkDone[i] = false;
            animeAnimate(drawables[i], { draw: '0 0', duration: 260, ease: 'outQuad' });
            receiptRows[i]?.classList.remove('is-done');
          }
        });
      },
    },
  });
  tl6
    .fromTo('.ga-s6t', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.2)
    .to('.ga-s6-glow', { opacity: 0.25, duration: 1.4, ease: 'power1.out' }, 0.3)
    .fromTo(
      '.ga-receipt',
      { clipPath: 'inset(0% 0% 100% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'power3.out' },
      0.7
    );
  receiptRows.forEach((row, i) => {
    tl6.fromTo(row, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 2.4 + i * 1.4);
  });
  tl6
    .fromTo('.ga-s6sub', { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 8.1)
    .fromTo('.ga-s6-note', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 8.7)
    .to({}, { duration: 0.8 }, 9.2);

  // ============================================================
  // TELA 8 — contato: título em máscara + form + obra final
  // ============================================================
  gsap.fromTo(
    '.ga-contact .line-inner',
    { yPercent: 115, y: 0 },
    {
      yPercent: 0,
      duration: 1,
      ease: 'power4.out',
      stagger: 0.1,
      scrollTrigger: { trigger: '.ga-contact', start: 'top 72%', once: true },
    }
  );
  gsap.fromTo(
    '.ga-s8sub',
    { autoAlpha: 0, y: 14 },
    {
      autoAlpha: 1,
      y: 0,
      duration: 0.8,
      ease: 'power3.out',
      scrollTrigger: { trigger: '.ga-contact', start: 'top 62%', once: true },
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

  // ---------- vídeos: pausa fora da viewport + load por proximidade ----------
  manageVideo(document.querySelector('.ga-hero-video'), '.ga-s1');
  manageVideo(document.querySelector('.ga-strip-video'), '.ga-s1');
  manageVideo(document.querySelector('.ga-band-video'), '.ga-s3');
  manageVideo(document.querySelector('.ga-glow-video'), '.ga-s6');

  // ---------- régua da jornada (depois dos pins, p/ medir certo) ----------
  initJourney();
}

// ============================================================
// INTRO — primeira dobra pós-preloader
// ============================================================
function runIntro({ reduced }) {
  if (reduced) {
    gsap.set('.ga-grid', { opacity: 1 });
    return;
  }

  gsap
    .timeline({ defaults: { ease: 'power4.out' } })
    .to('.ga-grid', { opacity: 1, duration: 1.6, ease: 'power2.out' }, 0)
    .fromTo('.ga-kicker', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.1)
    .fromTo(
      '.ga-s1 .line-inner',
      { yPercent: 115, y: 0 },
      { yPercent: 0, duration: 1.15, stagger: 0.12 },
      0.18
    )
    .to('.ga-frame--hero', { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.35, ease: 'power4.inOut' }, 0.35)
    .fromTo('.ga-sub', { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.9 }, 0.62)
    .fromTo('.ga-cta', { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.78)
    .fromTo('.ga-strip', { autoAlpha: 0 }, { autoAlpha: 0.12, duration: 1.2, ease: 'power2.out' }, 0.9)
    .fromTo('.ga-frame--hero .ga-caption', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.7 }, 1.25);
}

bootVariant({ dict, initScenes, runIntro });
