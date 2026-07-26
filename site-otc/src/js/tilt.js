import { springValue } from 'motion';

// Tilt 3D dos cards com molas (motion.dev) + glare que segue o mouse (CSS vars).
export function initTilt({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  document.querySelectorAll('[data-tilt]').forEach((card) => {
    const rx = springValue(0, { stiffness: 300, damping: 22 });
    const ry = springValue(0, { stiffness: 300, damping: 22 });

    const apply = () => {
      card.style.transform = `perspective(900px) rotateX(${rx.get()}deg) rotateY(${ry.get()}deg)`;
    };
    rx.on('change', apply);
    ry.on('change', apply);

    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      rx.set((0.5 - py) * 8);
      ry.set((px - 0.5) * 10);
      card.style.setProperty('--mx', `${px * 100}%`);
      card.style.setProperty('--my', `${py * 100}%`);
    });

    card.addEventListener('pointerleave', () => {
      rx.set(0);
      ry.set(0);
    });
  });
}
