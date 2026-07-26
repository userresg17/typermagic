import { springValue } from 'motion';

// Cursor custom com física de mola (motion.dev):
// o dot responde rápido, o anel persegue com inércia.
export function initCursor({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  const dot = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;

  document.documentElement.classList.add('has-custom-cursor');

  const dotX = springValue(-100, { stiffness: 3000, damping: 120 });
  const dotY = springValue(-100, { stiffness: 3000, damping: 120 });
  const ringX = springValue(-100, { stiffness: 320, damping: 32, mass: 0.9 });
  const ringY = springValue(-100, { stiffness: 320, damping: 32, mass: 0.9 });

  const applyDot = () => {
    dot.style.transform = `translate3d(${dotX.get()}px, ${dotY.get()}px, 0) translate(-50%, -50%)`;
  };
  const applyRing = () => {
    ring.style.transform = `translate3d(${ringX.get()}px, ${ringY.get()}px, 0) translate(-50%, -50%)`;
  };

  dotX.on('change', applyDot);
  dotY.on('change', applyDot);
  ringX.on('change', applyRing);
  ringY.on('change', applyRing);

  window.addEventListener('pointermove', (e) => {
    dotX.set(e.clientX);
    dotY.set(e.clientY);
    ringX.set(e.clientX);
    ringY.set(e.clientY);
  });

  // Cresce sobre elementos interativos
  const HOVER = 'a, button, [data-cursor]';
  document.addEventListener('pointerover', (e) => {
    if (e.target.closest(HOVER)) ring.classList.add('is-hover');
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest(HOVER)) ring.classList.remove('is-hover');
  });
}
