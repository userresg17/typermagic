import { animate, svg, utils } from 'animejs';

// Micro-animações de SVG (anime.js)
export function initIcons({ reduced }) {
  if (reduced) return;

  // Losango do HUD desenha na entrada
  const mark = document.querySelector('.nav-mark path');
  if (mark) {
    const [d] = svg.createDrawable(mark);
    utils.set(d, { draw: '0 0' });
    animate(d, { draw: '0 1', ease: 'inOutQuad', duration: 1400, delay: 400 });
  }
}
