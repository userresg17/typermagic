import { springValue } from 'motion';

// Botões magnéticos: o elemento é atraído pelo ponteiro e volta
// ao centro com mola física (motion.dev) ao sair.
export function initMagnetic({ reduced }) {
  if (reduced || !window.matchMedia('(pointer: fine)').matches) return;

  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const x = springValue(0, { stiffness: 260, damping: 18, mass: 0.9 });
    const y = springValue(0, { stiffness: 260, damping: 18, mass: 0.9 });

    const apply = () => {
      el.style.transform = `translate3d(${x.get()}px, ${y.get()}px, 0)`;
    };
    x.on('change', apply);
    y.on('change', apply);

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      x.set((e.clientX - r.left - r.width / 2) * 0.35);
      y.set((e.clientY - r.top - r.height / 2) * 0.45);
    });

    el.addEventListener('pointerleave', () => {
      x.set(0);
      y.set(0);
    });
  });
}
