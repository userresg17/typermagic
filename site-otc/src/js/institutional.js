import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { animate, svg, utils } from 'animejs';
import { getLang, t } from './i18n.js';

// ============================================================
// CAMADA INSTITUCIONAL — dados MOCK para aprovação de layout.
// Contadores GSAP + gráfico SVG artesanal (série única #9678f2,
// validado contra o fundo escuro) desenhado no scroll (anime.js).
// ============================================================

// volume mensal ilustrativo, em R$ milhões
const DATA = [82, 95, 88, 110, 124, 118, 141, 155, 149, 172, 190, 208];
const MONTHS = {
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

// O gráfico é COMPOSTO por dispositivo, não encolhido:
// mobile tem viewBox, densidade de labels e grade próprios.
const isMobileChart = () => window.matchMedia('(max-width: 720px)').matches;

let D = null; // dimensões ativas

function computeDims() {
  const mob = isMobileChart();
  D = mob
    ? { W: 360, H: 250, M: { l: 34, r: 14, t: 26, b: 26 }, grid: [0, 105, 210], labelStep: 2, font: 11 }
    : { W: 800, H: 300, M: { l: 46, r: 20, t: 30, b: 30 }, grid: [0, 70, 140, 210], labelStep: 1, font: 10 };
  return mob;
}

const MAX = 210; // teto da escala

const px = (i) => D.M.l + (i * (D.W - D.M.l - D.M.r)) / (DATA.length - 1);
const py = (v) => D.H - D.M.b - ((v / MAX) * (D.H - D.M.t - D.M.b));

function buildChart() {
  const box = document.getElementById('chartBox');
  if (!box) return;
  computeDims();
  const months = MONTHS[getLang()] ?? MONTHS.pt;

  const linePts = DATA.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const areaPts = `${D.M.l},${py(0)} ${linePts} ${px(DATA.length - 1).toFixed(1)},${py(0)}`;

  const gridRows = D.grid
    .map(
      (v) => `
      <line class="grid-line" x1="${D.M.l}" x2="${D.W - D.M.r}" y1="${py(v)}" y2="${py(v)}"></line>
      <text class="axis-label" x="${D.M.l - 7}" y="${py(v) + 3}" text-anchor="end" font-size="${D.font}">${v}</text>`
    )
    .join('');

  const monthLabels = months
    .map((m, i) =>
      i % D.labelStep
        ? ''
        : `<text class="axis-label" x="${px(i)}" y="${D.H - 6}" text-anchor="middle" font-size="${D.font}">${m}</text>`
    )
    .join('');

  const last = DATA.length - 1;

  box.innerHTML = `
    <svg viewBox="0 0 ${D.W} ${D.H}" role="img" aria-label="${t('num.chart.title')} — ${t('num.chart.unit')}">
      <defs>
        <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#9678f2" stop-opacity="0.22"></stop>
          <stop offset="100%" stop-color="#9678f2" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      ${gridRows}
      ${monthLabels}
      <polygon class="vol-area" points="${areaPts}"></polygon>
      <polyline class="vol-line" points="${linePts}"></polyline>
      <line class="vol-cross" id="volCross" y1="${D.M.t}" y2="${D.H - D.M.b}" x1="0" x2="0" opacity="0"></line>
      <circle class="vol-dot" id="volDot" r="4" opacity="0"></circle>
      <circle class="vol-dot" cx="${px(last)}" cy="${py(DATA[last])}" r="4"></circle>
      <text class="direct-label" x="${px(last)}" y="${py(DATA[last]) - 12}" text-anchor="end" font-size="${D.font + 1}">R$ ${DATA[last]} mi</text>
    </svg>
    <table class="sr-only">
      <caption>${t('num.chart.title')} (${t('num.chart.unit')})</caption>
      <tbody>${DATA.map((v, i) => `<tr><th>${months[i]}</th><td>${v}</td></tr>`).join('')}</tbody>
    </table>`;
}

function initChartDraw({ reduced }) {
  const box = document.getElementById('chartBox');
  const line = box?.querySelector('.vol-line');
  if (!line) return;

  if (reduced) {
    box.classList.add('is-drawn');
    return;
  }

  const [drawable] = svg.createDrawable(line);
  utils.set(drawable, { draw: '0 0' });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        animate(drawable, { draw: '0 1', ease: 'inOutQuad', duration: 1500 });
        box.classList.add('is-drawn');
      });
    },
    { threshold: 0.35 }
  );
  io.observe(box);
}

// crosshair + tooltip (hover é camada padrão de leitura do gráfico)
function initChartHover() {
  const box = document.getElementById('chartBox');
  const tip = document.getElementById('chartTip');
  const svgEl = box?.querySelector('svg');
  if (!svgEl || !tip) return;
  const cross = svgEl.querySelector('#volCross');
  const dot = svgEl.querySelector('#volDot');

  svgEl.addEventListener('pointermove', (e) => {
    const r = svgEl.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * D.W;
    const i = Math.max(0, Math.min(DATA.length - 1, Math.round(((x - D.M.l) / (D.W - D.M.l - D.M.r)) * (DATA.length - 1))));
    const months = MONTHS[getLang()] ?? MONTHS.pt;
    cross.setAttribute('x1', px(i));
    cross.setAttribute('x2', px(i));
    cross.setAttribute('opacity', '1');
    dot.setAttribute('cx', px(i));
    dot.setAttribute('cy', py(DATA[i]));
    dot.setAttribute('opacity', '1');
    tip.hidden = false;
    tip.textContent = `${months[i]} · R$ ${DATA[i]} mi`;
    tip.style.left = `${(px(i) / D.W) * r.width}px`;
    tip.style.top = `${(py(DATA[i]) / D.H) * r.height}px`;
  });
  svgEl.addEventListener('pointerleave', () => {
    cross.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
    tip.hidden = true;
  });
}

// contadores: animam a parte numérica do texto atual (respeita o idioma)
function initCounters({ reduced }) {
  document.querySelectorAll('[data-count]').forEach((el) => {
    if (reduced) return;
    ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        const final = el.textContent;
        const m = final.match(/([\d.,]+)/);
        if (!m) return;
        const raw = m[1];
        const sep = raw.includes(',') && raw.indexOf(',') > raw.length - 4 ? ',' : '.';
        const numeric = parseFloat(raw.replace(/\./g, '').replace(',', '.')) || parseFloat(raw);
        const decimals = /[.,]\d(?!\d)/.test(raw) ? 1 : 0;
        const grouped = decimals === 0 && numeric >= 1000;
        const state = { v: 0 };
        gsap.to(state, {
          v: numeric,
          duration: 1.6,
          ease: 'power2.out',
          onUpdate: () => {
            let s = decimals ? state.v.toFixed(decimals).replace('.', sep) : String(Math.round(state.v));
            if (grouped) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, getLang() === 'pt' ? '.' : ',');
            el.textContent = final.replace(raw, s);
          },
          onComplete: () => {
            el.textContent = final;
          },
        });
      },
    });
  });
}

// formulário DEMO: não envia nada — só valida o layout
function initDemoForm() {
  const form = document.getElementById('demoForm');
  const note = document.getElementById('formDemo');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (note) {
      note.hidden = false;
      gsap.fromTo(note, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });
    }
  });
}

export function initInstitutional({ reduced }) {
  buildChart();
  initChartDraw({ reduced });
  initChartHover();
  initCounters({ reduced });
  initDemoForm();

  document.addEventListener('langchange', () => {
    buildChart();
    document.getElementById('chartBox')?.classList.add('is-drawn');
    initChartHover();
  });

  // cruzou o breakpoint (girou o celular, redimensionou) → recompõe o gráfico
  window.matchMedia('(max-width: 720px)').addEventListener('change', () => {
    buildChart();
    document.getElementById('chartBox')?.classList.add('is-drawn');
    initChartHover();
  });
}
