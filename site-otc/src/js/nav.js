import { ScrollTrigger } from 'gsap/ScrollTrigger';

// HUD some ao descer, volta ao subir
export function initNav() {
  const hud = document.getElementById('hud');
  if (!hud) return;

  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: (self) => {
      hud.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 400);
    },
  });
}
