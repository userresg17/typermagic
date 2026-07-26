import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function initFaq() {
  const items = document.querySelectorAll('.faq-item');

  items.forEach((item) => {
    const btn = item.querySelector('.faq-q');
    const answer = item.querySelector('.faq-a');
    if (!btn || !answer) return;

    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('is-open');

      // fecha os outros (accordion de item único)
      items.forEach((other) => {
        if (other !== item && other.classList.contains('is-open')) {
          other.classList.remove('is-open');
          other.querySelector('.faq-q')?.setAttribute('aria-expanded', 'false');
          gsap.to(other.querySelector('.faq-a'), {
            height: 0,
            duration: 0.5,
            ease: 'power3.inOut',
          });
        }
      });

      item.classList.toggle('is-open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
      gsap.to(answer, {
        height: isOpen ? 0 : 'auto',
        duration: 0.55,
        ease: 'power3.inOut',
        onComplete: () => ScrollTrigger.refresh(),
      });
    });
  });
}
