import gsap from 'gsap';

// Tela de carregamento com progresso REAL: o contador reflete o download
// dos assets críticos (waitFor), com um mínimo de coreografia de 1.4s.
export function initPreloader({ reduced, onDone, waitFor }) {
  const pre = document.getElementById('preloader');
  if (!pre) return onDone();

  const seen = sessionStorage.getItem('otc-preloaded');
  if (reduced || seen) {
    pre.classList.add('is-done');
    // mesmo pulando a tela, dispara o preload crítico em background
    waitFor?.(() => {});
    return onDone();
  }
  sessionStorage.setItem('otc-preloaded', '1');

  const count = document.getElementById('preloaderCount');
  const bar = document.getElementById('preloaderBar');

  let real = 0;
  let realDone = false;
  const wait = waitFor
    ? waitFor((p) => { real = Math.max(real, p); })
    : Promise.resolve();
  wait.then(() => {
    real = 1;
    realDone = true;
  });

  const MIN = 1400;
  const t0 = performance.now();
  let visual = 0;
  let finishing = false;

  function finish() {
    finishing = true;
    count.textContent = '100';
    bar.style.transform = 'scaleX(1)';
    gsap
      .timeline({
        onComplete: () => {
          pre.classList.add('is-done');
          onDone();
        },
      })
      .to('.preloader-center', { opacity: 0, duration: 0.3, ease: 'power1.out' })
      .to('.preloader-panel--l', { xPercent: -101, duration: 0.9, ease: 'power4.inOut' }, '<0.05')
      .to('.preloader-panel--r', { xPercent: 101, duration: 0.9, ease: 'power4.inOut' }, '<');
  }

  function tick() {
    if (finishing) return;
    const timeP = Math.min(1, (performance.now() - t0) / MIN);
    // trava perto do fim se os assets ainda não chegaram (progresso honesto)
    const target = Math.min(timeP, 0.4 * timeP + 0.6 * real);
    visual += (target - visual) * 0.14;
    count.textContent = String(Math.min(99, Math.round(visual * 100))).padStart(2, '0');
    bar.style.transform = `scaleX(${visual.toFixed(4)})`;
    if (realDone && timeP >= 1 && visual > 0.99) return finish();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
