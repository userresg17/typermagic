// Chuva de números — o ruído do mercado aberto (cena 1).
// Canvas 2D leve; preços reais da CoinGecko quando disponíveis.
const FALLBACK = ['118250.00', '4480.12', '258.40', '1.0002', '97810.55', '-0.84%', '+1.24%', '63120.00', '-2.10%', '+0.36%'];

let canvas = null;
let ctx = null;
let raf = 0;
let columns = [];
let intensity = 1;
let tokens = [...FALLBACK];

async function fetchPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,tether&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return;
    const j = await res.json();
    tokens = [];
    Object.values(j).forEach((v) => {
      tokens.push(v.usd.toLocaleString('en-US', { maximumFractionDigits: 2 }));
      const c = v.usd_24h_change ?? 0;
      tokens.push(`${c >= 0 ? '+' : ''}${c.toFixed(2)}%`);
    });
    tokens.push(...FALLBACK.slice(0, 4));
  } catch {
    /* mantém fallback */
  }
}
fetchPrices();

function resize() {
  if (!canvas) return;
  canvas.width = canvas.clientWidth * Math.min(devicePixelRatio, 2);
  canvas.height = canvas.clientHeight * Math.min(devicePixelRatio, 2);
  const colW = 90 * Math.min(devicePixelRatio, 2);
  const n = Math.ceil(canvas.width / colW);
  columns = Array.from({ length: n }, (_, i) => ({
    x: i * colW + colW * 0.2,
    y: Math.random() * canvas.height,
    v: 1.5 + Math.random() * 3.5,
    t: tokens[(Math.random() * tokens.length) | 0],
    neg: Math.random() < 0.4,
  }));
}

function tick() {
  raf = requestAnimationFrame(tick);
  if (!ctx) return;
  const dpr = Math.min(devicePixelRatio, 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${11 * dpr}px "JetBrains Mono", monospace`;

  columns.forEach((c) => {
    c.y += c.v * (0.4 + intensity * 2.2);
    if (c.y > canvas.height + 30) {
      c.y = -30;
      c.t = tokens[(Math.random() * tokens.length) | 0];
      c.neg = Math.random() < 0.4;
    }
    const a = 0.05 + intensity * 0.3;
    ctx.fillStyle = c.t.startsWith('+')
      ? `rgba(74, 222, 128, ${a})`
      : c.t.startsWith('-')
        ? `rgba(248, 113, 113, ${a})`
        : `rgba(242, 242, 240, ${a * 0.8})`;
    ctx.fillText(c.t, c.x, c.y);
  });
}

export function startNoise() {
  canvas = document.getElementById('noiseRain');
  if (!canvas || raf) return;
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  tick();
}

export function stopNoise() {
  cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener('resize', resize);
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function setNoiseIntensity(v) {
  intensity = Math.max(0, Math.min(1, v));
}
