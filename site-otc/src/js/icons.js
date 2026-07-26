import { animate, svg, stagger, utils } from 'animejs';

// Ícones desenhados traço a traço (anime.js svg.createDrawable)
export function initIcons({ reduced }) {
  if (reduced) return;

  // Losango do header desenha na entrada
  const mark = document.querySelector('.nav-mark path');
  if (mark) {
    const [d] = svg.createDrawable(mark);
    utils.set(d, { draw: '0 0' });
    animate(d, { draw: '0 1', ease: 'inOutQuad', duration: 1400, delay: 400 });
  }

  // Ícones da seção segurança desenham quando entram na tela
  const lis = document.querySelectorAll('.security-list li');
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        const paths = entry.target.querySelectorAll('.sec-draw');
        if (!paths.length) return;
        const drawables = [...paths].flatMap((p) => svg.createDrawable(p));
        animate(drawables, {
          draw: ['0 0', '0 1'],
          ease: 'inOutQuad',
          duration: 1100,
          delay: stagger(180),
        });
      });
    },
    { threshold: 0.4 }
  );
  lis.forEach((li) => io.observe(li));
}
