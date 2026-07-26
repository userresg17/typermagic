// ============================================================
// VARIANTE B — "O TERMINAL"
// A mesa como interface: cotação viva, livro de ofertas que sofre,
// log de sistema, ticket que trava e carimba, pipeline T+0.
// Tudo mock e sinalizado; o core (variant-core) cuida do resto.
// ============================================================

import { bootVariant } from '../js/variant-core.js';
import './terminal.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { svg as animeSvg, utils as animeUtils } from 'animejs';
import { springValue } from 'motion';
import { t, getLang } from '../js/i18n.js';

gsap.registerPlugin(ScrollTrigger);

const SCRUB = 0.55;

// ---------- Strings próprias da variante (prefixo tm.) ----------
const dict = {
  pt: {
    'tm.card': 'cotação de referência',
    'tm.card.meta': 'spread 0,18% · janela 30s',
    'tm.note': '* dados ilustrativos',
    'tm.mkt': 'mercado aberto',
    'tm.mkt.book': 'livro de ofertas · btc/brl',
    'tm.mkt.avg': 'preço médio',
    'tm.mkt.slip': 'slippage −0,58%',
    'tm.desk': 'mesa otc',
    'tm.desk.sub': 'cotação firme · btc/brl',
    'tm.desk.price': 'R$ 618.240',
    'tm.desk.lock': 'travado',
    'tm.log.title': 'diário de execução · sessão 0001',
    'tm.log.sub': 'saída do sistema · demo',
    'tm.log1': '> cotação firme',
    'tm.log2': '> preço único',
    'tm.log3': '> spread justo',
    'tm.log4': '> slippage',
    'tm.log4.v': '0,00%',
    'tm.ticket': 'ticket de execução · nº 0001',
    'tm.ticket.asset': 'ativo',
    'tm.ticket.vol': 'volume',
    'tm.ticket.vol.v': 'R$ 590.000.000',
    'tm.ticket.cp': 'contraparte',
    'tm.ticket.cp.v': 'MESA',
    'tm.ticket.val': 'validade',
    'tm.ticket.price': 'preço btc/brl',
    'tm.ticket.price.v': 'R$ 618.240',
    'tm.stamp': 'executado',
    'tm.n1': 'execução',
    'tm.n2': 'custódia',
    'tm.n3': 'fiscal',
    'tm.n4': 'liquidado',
    'tm.form': 'novo pedido de cotação · #0001',
  },
  en: {
    'tm.card': 'reference quote',
    'tm.card.meta': 'spread 0.18% · 30s window',
    'tm.note': '* illustrative data',
    'tm.mkt': 'open market',
    'tm.mkt.book': 'order book · btc/brl',
    'tm.mkt.avg': 'average price',
    'tm.mkt.slip': 'slippage −0.58%',
    'tm.desk': 'otc desk',
    'tm.desk.sub': 'firm quote · btc/brl',
    'tm.desk.price': 'R$ 618,240',
    'tm.desk.lock': 'locked',
    'tm.log.title': 'execution log · session 0001',
    'tm.log.sub': 'system output · demo',
    'tm.log1': '> firm quote',
    'tm.log2': '> single price',
    'tm.log3': '> fair spread',
    'tm.log4': '> slippage',
    'tm.log4.v': '0.00%',
    'tm.ticket': 'execution ticket · no. 0001',
    'tm.ticket.asset': 'asset',
    'tm.ticket.vol': 'volume',
    'tm.ticket.vol.v': 'R$ 590,000,000',
    'tm.ticket.cp': 'counterparty',
    'tm.ticket.cp.v': 'DESK',
    'tm.ticket.val': 'validity',
    'tm.ticket.price': 'btc/brl price',
    'tm.ticket.price.v': 'R$ 618,240',
    'tm.stamp': 'executed',
    'tm.n1': 'execution',
    'tm.n2': 'custody',
    'tm.n3': 'tax',
    'tm.n4': 'settled',
    'tm.form': 'new quote request · #0001',
  },
};

// ---------- Helpers ----------
const fmtInt = (n) =>
  new Intl.NumberFormat(getLang() === 'pt' ? 'pt-BR' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(Math.round(n));

const QUOTE_BASE = 618240;
const SLIP_DELTA = 3586; // −0,58% sobre a base (mock)

// ============================================================
// HUD: relógio UTC + latência fake + dot (cluster title="demo")
// ============================================================
function startHudCluster() {
  const clock = document.getElementById('tmUtc');
  const lat = document.getElementById('tmLat');
  if (!clock || !lat) return;
  const tickClock = () => {
    clock.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
  };
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(() => {
    lat.textContent = `lat ${8 + Math.round(Math.random() * 22)}ms`;
  }, 3000);
}

// ============================================================
// Cursor: coordenadas mono flutuando ao lado do ponteiro
// ============================================================
function initCoords({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;
  const box = document.getElementById('tmCoords');
  const ex = document.getElementById('tmCoordX');
  const ey = document.getElementById('tmCoordY');
  if (!box) return;
  let lx = 0;
  let ly = 0;
  let pending = false;
  window.addEventListener('pointermove', (e) => {
    lx = Math.round(e.clientX);
    ly = Math.round(e.clientY);
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      box.style.transform = `translate3d(${lx + 22}px, ${ly + 16}px, 0)`;
      ex.textContent = `x ${String(lx).padStart(4, '0')}`;
      ey.textContent = `y ${String(ly).padStart(4, '0')}`;
    });
  });
}

// ============================================================
// Vídeos: fora da viewport = pausado; lazies só carregam ao chegar
// ============================================================
function gateVideo(video, trigger, { lazy }) {
  if (!video) return;
  let loaded = !lazy;
  ScrollTrigger.create({
    trigger,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      if (self.isActive) {
        if (!loaded) {
          loaded = true;
          video.preload = 'auto';
          try { video.load(); } catch { /* já carregando */ }
        }
        video.style.visibility = '';
        if (video.paused && video.dataset.scrub !== '1') video.play().catch(() => {});
      } else {
        if (!video.paused) video.pause();
        video.style.visibility = 'hidden';
      }
    },
  });
}

// ============================================================
// Sparklines estáticas nos cards de métrica (dados fake)
// ============================================================
const SPARKS = [
  [4, 6, 5, 9, 11, 10, 14, 17, 16, 20],
  [8, 7, 10, 9, 13, 12, 15, 14, 18, 21],
  [14, 12, 13, 10, 11, 9, 8, 7, 6, 5],
  [3, 5, 4, 7, 6, 10, 9, 13, 15, 19],
];

function injectSparklines() {
  document.querySelectorAll('.nums .num').forEach((card, i) => {
    const data = SPARKS[i % SPARKS.length];
    const max = Math.max(...data);
    const pts = data
      .map((v, j) => `${(2 + (j * 96) / (data.length - 1)).toFixed(1)},${(24 - (v / max) * 20).toFixed(1)}`)
      .join(' ');
    const [lastX, lastY] = pts.split(' ').pop().split(',');
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'tm-spark');
    svgEl.setAttribute('viewBox', '0 0 100 26');
    svgEl.setAttribute('preserveAspectRatio', 'none');
    svgEl.setAttribute('aria-hidden', 'true');
    svgEl.innerHTML = `<polyline points="${pts}"></polyline><circle cx="${lastX}" cy="${lastY}" r="1.8"></circle>`;
    card.appendChild(svgEl);
  });
}

// ============================================================
// Preço do ticket: trava dígito a dígito (regra 6)
// ============================================================
let priceChars = [];
let lockedCount = -1;
let lastLockP = 0;

function buildTicketPrice() {
  const el = document.getElementById('tmPrice');
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

function applyLock(progress) {
  lastLockP = progress;
  const digits = priceChars.filter((s) => !s.classList.contains('is-sep'));
  const locked = Math.floor(progress * (digits.length + 1));
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
// Log de sistema: typewriter dirigido pelo progresso do pin
// ============================================================
let logLines = [];
let lastLogP = 0;

function cacheLogLines() {
  logLines = [...document.querySelectorAll('.tm-log-line')].map((line) => ({
    line,
    text: line.querySelector('.tm-log-text'),
    ok: line.querySelector('.tm-log-ok'),
    key: line.querySelector('.tm-log-text').dataset.log,
    lastLen: -1,
  }));
}

function renderLog(p) {
  lastLogP = p;
  logLines.forEach((l, i) => {
    const full = t(l.key);
    const start = i * 0.22;
    const local = gsap.utils.clamp(0, 1, (p - start) / 0.15);
    const len = Math.floor(local * full.length);
    if (len !== l.lastLen) {
      l.lastLen = len;
      l.text.textContent = full.slice(0, len);
    }
    l.line.classList.toggle('is-typing', local > 0 && local < 1);
    l.line.classList.toggle('is-done', local >= 1);
    l.ok.classList.toggle('is-on', p >= start + 0.19);
  });
}

// ============================================================
// Card de cotação: preço vivo + barra regressiva + tilt de mola
// ============================================================
function initQuoteCard({ reduced }) {
  const quoteEl = document.getElementById('tmQuote');
  const bar = document.getElementById('tmCardBar');
  if (!quoteEl) return;

  const state = { v: QUOTE_BASE };
  const render = () => { quoteEl.textContent = `R$ ${fmtInt(state.v)}`; };
  render();
  document.addEventListener('langchange', render);
  if (reduced) return;

  const restartBar = () => {
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth; // reflow: reinicia a transição
    bar.style.transition = 'transform 2s linear';
    bar.style.transform = 'scaleX(0)';
  };

  let timer = 0;
  const tick = () => {
    restartBar();
    gsap.to(state, {
      v: QUOTE_BASE + gsap.utils.random(-900, 900, 1),
      duration: 0.9,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: render,
    });
  };

  // só atualiza com a tela 1 por perto — nada roda em off
  ScrollTrigger.create({
    trigger: '.tm-s1',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      clearInterval(timer);
      if (self.isActive) {
        tick();
        timer = setInterval(tick, 2000);
      }
    },
  });

  // tilt sutil ±4° com física de mola (motion.dev)
  const persp = document.querySelector('.tm-card-persp');
  const card = document.getElementById('tmCard');
  if (!persp || !card || !window.matchMedia('(pointer: fine)').matches) return;
  const rx = springValue(0, { stiffness: 130, damping: 16 });
  const ry = springValue(0, { stiffness: 130, damping: 16 });
  const applyTilt = () => {
    card.style.transform = `rotateX(${rx.get().toFixed(2)}deg) rotateY(${ry.get().toFixed(2)}deg)`;
  };
  rx.on('change', applyTilt);
  ry.on('change', applyTilt);
  persp.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const dx = gsap.utils.clamp(-1, 1, ((e.clientX - r.left) / r.width) * 2 - 1);
    const dy = gsap.utils.clamp(-1, 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    rx.set(-dy * 4);
    ry.set(dx * 4);
  });
  persp.addEventListener('pointerleave', () => {
    rx.set(0);
    ry.set(0);
  });
}

// ============================================================
// Régua da jornada (o core não dirige a rail nas variantes)
// ============================================================
function initJourney() {
  const bar = document.getElementById('journeyBar');
  const marker = document.getElementById('journeyMarker');
  const num = document.getElementById('journeyNum');
  if (!bar) return;
  let lastTxt = '';
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    scrub: true,
    onUpdate: (self) => {
      const p = self.progress;
      bar.style.transform = `scaleY(${p.toFixed(4)})`;
      if (marker) marker.style.top = `${(p * 100).toFixed(2)}%`;
      const txt = String(Math.min(9, Math.floor(p * 9) + 1)).padStart(2, '0');
      if (num && txt !== lastTxt) {
        lastTxt = txt;
        num.textContent = txt;
      }
    },
  });
}

// ============================================================
// CENAS
// ============================================================
function initScenes({ reduced }) {
  startHudCluster();
  initCoords({ reduced });
  injectSparklines();
  buildTicketPrice();
  cacheLogLines();
  initJourney();
  initQuoteCard({ reduced });

  // referências das telas 2 e 6 (usadas nos dois modos)
  const bookRows = [...document.querySelectorAll('.tm-book-row')];
  const avgEl = document.getElementById('tmAvg');
  const slipEl = document.getElementById('tmSlip');
  const deskMon = document.getElementById('tmMonDesk');
  const nodes = [...document.querySelectorAll('.tm-node')];
  const pipe = document.getElementById('tmPipe');
  const valBar = document.getElementById('tmValBar');

  const pipePath = document.getElementById('tmPipePath');
  let drawable = null;
  if (pipePath) {
    [drawable] = animeSvg.createDrawable(pipePath);
    animeUtils.set(drawable, { draw: '0 0' });
  }

  document.addEventListener('langchange', () => {
    buildTicketPrice();
    applyLock(lastLockP);
    logLines.forEach((l) => { l.lastLen = -1; });
    renderLog(lastLogP);
    if (avgEl && avgEl.classList.contains('is-hot')) avgEl.textContent = fmtInt(QUOTE_BASE + SLIP_DELTA);
  });

  // ---------- Movimento reduzido: tudo visível, sem pins ----------
  if (reduced) {
    gsap.set(
      [
        '.tm-pre', '.tm-sub', '.tm-hero-cta', '.tm-s2-verdict', '.tm-s3-t',
        '.tm-s4-t', '.tm-s5-sub', '.tm-pipe-t', '.tm-pipe-sub',
        '.tm-form-kicker', '.s8-sub', '.s8-form',
      ],
      { opacity: 1 }
    );
    gsap.set('#tmStamp', { opacity: 1, xPercent: -50, yPercent: -50, rotation: -8 });
    applyLock(1);
    if (valBar) valBar.style.transform = 'scaleX(0)';
    renderLog(1);
    bookRows.forEach((r) => r.classList.add('is-eaten'));
    if (avgEl) {
      avgEl.classList.add('is-hot');
      avgEl.textContent = fmtInt(QUOTE_BASE + SLIP_DELTA);
    }
    slipEl?.classList.add('is-on');
    deskMon?.classList.add('is-on');
    nodes.forEach((n) => n.classList.add('is-on'));
    if (drawable) animeUtils.set(drawable, { draw: '0 1' });
    return;
  }

  // ---------- Reveals obrigatórios (camada institucional) ----------
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
  gsap.utils.toArray('.inst-title').forEach((title) =>
    gsap.fromTo(
      title.querySelectorAll('.line-inner'),
      { yPercent: 115, y: 0 },
      {
        yPercent: 0,
        duration: 1,
        ease: 'power4.out',
        stagger: 0.1,
        scrollTrigger: { trigger: title, start: 'top 82%', once: true },
      }
    )
  );

  // ---------- Vídeos com gerenciamento de visibilidade ----------
  gateVideo(document.querySelector('.tm-card-seal video'), '.tm-s1', { lazy: false });
  gateVideo(document.querySelector('.tm-log-glow'), '.tm-s3', { lazy: true });
  gateVideo(document.querySelector('.tm-pipe-glow'), '.tm-s6', { lazy: true });

  // ========== TELA 1 — abertura + card (pin +=70%) ==========
  const s1 = gsap.timeline({
    scrollTrigger: {
      trigger: '.tm-s1',
      start: 'top top',
      end: '+=70%',
      pin: true,
      scrub: SCRUB,
    },
  });
  s1.to({}, { duration: 0.5 }) // segura o quadro para leitura
    .to('.tm-hero-copy', { yPercent: -14, opacity: 0, filter: 'blur(8px)', duration: 0.4 }, 0.55)
    .to('.tm-card-persp', { yPercent: -10, opacity: 0, filter: 'blur(6px)', duration: 0.4 }, 0.62);

  // ========== TELA 2 — dois monitores (pin +=180%) ==========
  let lastEaten = -1;
  const s2 = gsap.timeline({
    scrollTrigger: {
      trigger: '.tm-s2',
      start: 'top top',
      end: '+=180%',
      pin: true,
      scrub: SCRUB,
      onUpdate: (self) => {
        const p = self.progress;
        // a ordem grande consome o livro nível a nível
        const eatP = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.12, 0.58, 0, 1, p));
        const eaten = Math.floor(eatP * bookRows.length);
        if (eaten !== lastEaten) {
          lastEaten = eaten;
          bookRows.forEach((r, i) => r.classList.toggle('is-eaten', i < eaten));
        }
        if (avgEl) {
          avgEl.textContent = fmtInt(QUOTE_BASE + eatP * SLIP_DELTA);
          avgEl.classList.toggle('is-hot', eatP > 0.05);
        }
        slipEl?.classList.toggle('is-on', eatP >= 1);
        // a mesa só acende quando o livro público terminou de sangrar
        deskMon?.classList.toggle('is-on', p > 0.68);
      },
    },
  });
  s2.fromTo('.tm-mon--mkt', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.06 }, 0.01)
    .fromTo('.tm-mon--desk', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.06 }, 0.04)
    .fromTo('.tm-s2 .mock-note', { opacity: 0 }, { opacity: 1, duration: 0.04 }, 0.08)
    .fromTo('.tm-s2-verdict', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.07 }, 0.8)
    .to({}, { duration: 0.13 }); // leitura do veredito

  // ========== TELA 3 — log de sistema (pin +=150%) ==========
  const s3 = gsap.timeline({
    scrollTrigger: {
      trigger: '.tm-s3',
      start: 'top top',
      end: '+=150%',
      pin: true,
      scrub: SCRUB,
      onUpdate: (self) => {
        renderLog(gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.1, 0.82, 0, 1, self.progress)));
      },
    },
  });
  s3.fromTo('.tm-logpanel', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.06 }, 0.01)
    .fromTo('.tm-s3-t', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.06 }, 0.88)
    .to({}, { duration: 0.06 });

  // ========== TELAS 4+5 — ticket + carimbo (pin +=320% = 200% + 120%) ==========
  // Um pin só: é O MESMO ticket que trava o preço e recebe o carimbo.
  gsap.set('#tmStamp', { xPercent: -50, yPercent: -50, rotation: -8, transformOrigin: '50% 50%' });
  let scrambleTimer = 0;
  ScrollTrigger.create({
    trigger: '.tm-s4',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      clearInterval(scrambleTimer);
      if (self.isActive) scrambleTimer = setInterval(scramblePrice, 90); // ~11fps
    },
  });
  const s4 = gsap.timeline({
    scrollTrigger: {
      trigger: '.tm-s4',
      start: 'top top',
      end: '+=320%',
      pin: true,
      scrub: SCRUB,
      onUpdate: (self) => {
        const lockP = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.08, 0.5, 0, 1, self.progress));
        applyLock(lockP);
        if (valBar) valBar.style.transform = `scaleX(${(1 - lockP).toFixed(4)})`; // 30s escoando
      },
    },
  });
  s4.fromTo('.tm-ticket-wrap', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.05 }, 0.005)
    .fromTo('.tm-s4-t', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.06 }, 0.52)
    // — o carimbo cai —
    .fromTo('#tmStamp', { scale: 3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.07, ease: 'back.out(2.2)' }, 0.68)
    .to('#tmTicket', { scale: 0.985, duration: 0.015 }, 0.71)
    .to('#tmTicket', { scale: 1, duration: 0.03 }, 0.73)
    .to('#tmFlash', { opacity: 0.5, duration: 0.012 }, 0.705)
    .to('#tmFlash', { opacity: 0, duration: 0.05 }, 0.72)
    // linha iridescente varre atrás do ticket
    .fromTo('.tm-sweep', { xPercent: 0 }, { xPercent: 560, duration: 0.14, ease: 'power2.inOut' }, 0.68)
    .fromTo('.tm-sweep', { opacity: 0 }, { opacity: 0.5, duration: 0.03 }, 0.68)
    .to('.tm-sweep', { opacity: 0, duration: 0.04 }, 0.78)
    .fromTo('.tm-s5-sub', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.06 }, 0.84)
    .to({}, { duration: 0.1 }); // leitura do estado final

  // ========== TELA 6 — pipeline T+0 (pin +=160%) ==========
  const NODE_AT = [0.02, 0.35, 0.68, 0.99];
  let pipeLit = false;
  const s6 = gsap.timeline({
    scrollTrigger: {
      trigger: '.tm-s6',
      start: 'top top',
      end: '+=160%',
      pin: true,
      scrub: SCRUB,
      onUpdate: (self) => {
        const lineP = gsap.utils.clamp(0, 1, gsap.utils.mapRange(0.16, 0.86, 0, 1, self.progress));
        if (drawable) animeUtils.set(drawable, { draw: `0 ${lineP.toFixed(4)}` });
        nodes.forEach((n, i) => n.classList.toggle('is-on', lineP >= NODE_AT[i]));
        const lit = lineP >= NODE_AT[3];
        if (lit !== pipeLit) {
          pipeLit = lit;
          pipe?.classList.toggle('is-lit', lit);
        }
      },
    },
  });
  s6.fromTo('.tm-pipe-t', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.06 }, 0.01)
    .fromTo('.tm-pipe-sub', { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.06 }, 0.05)
    .fromTo('.tm-pipe', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.06 }, 0.09)
    .to({}, { duration: 0.85 }); // a linha desenha no onUpdate; o quadro segura

  // ========== TELA 8 — contato ==========
  gsap.fromTo(
    '.s8-t .line-inner',
    { yPercent: 115, y: 0 },
    {
      yPercent: 0,
      duration: 1.05,
      ease: 'power4.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.tm-s8', start: 'top 65%', once: true },
    }
  );
  gsap.fromTo(
    ['.tm-form-kicker', '.s8-sub', '.s8-form'],
    { opacity: 0, y: 22 },
    {
      opacity: 1,
      y: 0,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.tm-s8', start: 'top 55%', once: true },
    }
  );
}

// ============================================================
// Intro pós-preloader
// ============================================================
function runIntro({ reduced }) {
  if (reduced) return;
  gsap
    .timeline()
    .fromTo('.tm-pre', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' }, 0.1)
    .fromTo(
      '.tm-hero-copy .line-inner',
      { yPercent: 115, y: 0 },
      { yPercent: 0, duration: 1.2, ease: 'power4.out', stagger: 0.14 },
      0.3
    )
    .fromTo('.tm-sub', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power2.out' }, 0.8)
    .fromTo('.tm-hero-cta', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 0.95)
    .fromTo(
      '.tm-card-persp',
      { opacity: 0, y: 46, filter: 'blur(10px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.1, ease: 'power3.out' },
      0.55
    )
    .fromTo(
      ['.hud', '.journey', '.tm-coords'],
      { opacity: 0 },
      { opacity: 1, duration: 0.9, ease: 'power2.out', stagger: 0.1 },
      1.0
    );
}

bootVariant({ dict, initScenes, runIntro });
