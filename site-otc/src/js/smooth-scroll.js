import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';

gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

let smoother = null;

export function getSmoother() {
  return smoother;
}

export function initSmoothScroll({ reduced }) {
  if (!reduced) {
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.3,
      effects: true, // habilita data-speed / data-lag
      smoothTouch: 0.1,
      normalizeScroll: true,
    });
    window.__otcSmoother = smoother; // usado pelos testes de verificação
  }

  // Navegação por âncora com scroll suave
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length <= 1) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      if (smoother) {
        smoother.scrollTo(target, true, 'top top');
      } else {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
}
