import gsap from 'gsap';

export function initPreloader({ reduced, onDone }) {
  const pre = document.getElementById('preloader');
  if (!pre) return onDone();

  const seen = sessionStorage.getItem('otc-preloaded');
  if (reduced || seen) {
    pre.classList.add('is-done');
    return onDone();
  }
  sessionStorage.setItem('otc-preloaded', '1');

  const count = document.getElementById('preloaderCount');
  const state = { v: 0 };

  gsap
    .timeline({
      onComplete: () => {
        pre.classList.add('is-done');
        onDone();
      },
    })
    .to(state, {
      v: 100,
      duration: 1.7,
      ease: 'power2.inOut',
      onUpdate: () => {
        count.textContent = String(Math.round(state.v)).padStart(2, '0');
      },
    })
    .to('#preloaderBar', { scaleX: 1, duration: 1.7, ease: 'power2.inOut' }, 0)
    .to('.preloader-center', { opacity: 0, duration: 0.3, ease: 'power1.out' }, '+=0.15')
    .to('.preloader-panel--l', { xPercent: -101, duration: 0.9, ease: 'power4.inOut' }, '<0.1')
    .to('.preloader-panel--r', { xPercent: 101, duration: 0.9, ease: 'power4.inOut' }, '<');
}
