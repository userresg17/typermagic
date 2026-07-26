import gsap from 'gsap';
import { t } from './i18n.js';

// Preços de fallback caso a API esteja indisponível (marcados como aproximados)
const FALLBACK = [
  { sym: 'BTC', price: 118250, chg: 1.24 },
  { sym: 'ETH', price: 4480, chg: 0.86 },
  { sym: 'SOL', price: 258, chg: -0.52 },
  { sym: 'USDT', price: 1.0, chg: 0.01 },
];

const WORD_KEYS = ['ticker.w1', 'ticker.w2', 'ticker.w3', 'ticker.w4'];

let data = FALLBACK;
let tween = null;

function fmtPrice(v) {
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: v < 10 ? 2 : 0,
    maximumFractionDigits: v < 10 ? 4 : 0,
  });
}

function itemHTML(c) {
  const dir = c.chg >= 0 ? 'up' : 'down';
  const sign = c.chg >= 0 ? '+' : '';
  return `
    <span class="ticker-item">
      <span class="ticker-sym">${c.sym}</span>
      <span class="ticker-price">${fmtPrice(c.price)}</span>
      <span class="ticker-chg ${dir}">${sign}${c.chg.toFixed(2)}%</span>
    </span>
    <span class="ticker-sep"></span>`;
}

function groupHTML() {
  let html = '';
  data.forEach((c, i) => {
    html += itemHTML(c);
    html += `<span class="ticker-word">${t(WORD_KEYS[i % WORD_KEYS.length])}</span>`;
    html += '<span class="ticker-sep"></span>';
  });
  return html;
}

function render() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  // dois grupos idênticos → loop infinito sem emenda (anima até -50%)
  const g = groupHTML();
  track.innerHTML = g + g;
}

async function fetchPrices() {
  try {
    const ids = 'bitcoin,ethereum,solana,tether';
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const map = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', tether: 'USDT' };
    data = Object.entries(map).map(([id, sym]) => ({
      sym,
      price: j[id].usd,
      chg: j[id].usd_24h_change ?? 0,
    }));
    render();
  } catch {
    // mantém o fallback silenciosamente
  }
}

export function initTicker() {
  const track = document.getElementById('tickerTrack');
  const wrap = document.getElementById('ticker');
  if (!track || !wrap) return;

  render();
  fetchPrices();
  setInterval(fetchPrices, 90000);

  tween = gsap.to(track, { xPercent: -50, duration: 30, ease: 'none', repeat: -1 });

  wrap.addEventListener('pointerenter', () => gsap.to(tween, { timeScale: 0, duration: 0.6 }));
  wrap.addEventListener('pointerleave', () => gsap.to(tween, { timeScale: 1, duration: 0.6 }));

  document.addEventListener('langchange', render);
}
