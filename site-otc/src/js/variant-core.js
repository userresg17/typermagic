// ============================================================
// NÚCLEO DAS VARIANTES DE DESKTOP (galeria / terminal / monolito)
// Cada variante fornece só o seu initScenes + strings próprias;
// todo o resto (i18n, preloader real, cursor, física, formulário,
// gráfico, dossiê, smooth scroll) vem daqui — idêntico nas três.
// ============================================================

import '@fontsource-variable/inter';
import '@fontsource/instrument-serif';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/animations.css';

import { initI18n, registerDict } from './i18n.js';
import { initSmoothScroll, getSmoother } from './smooth-scroll.js';
import { initNav } from './nav.js';
import { initAssetMedia } from './assets.js';
import { initFaq } from './faq.js';
import { initIcons } from './icons.js';
import { initCursor } from './cursor.js';
import { initMagnetic } from './magnetic.js';
import { initPreloader } from './preloader.js';
import { initInteract } from './interact.js';
import { initInstitutional } from './institutional.js';
import { preloadCritical } from './loader.js';

export { getSmoother };

export function bootVariant({ dict, initScenes, runIntro }) {
  const html = document.documentElement;
  html.classList.add('js');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) html.classList.add('reduced-motion');

  function boot() {
    if (dict) registerDict(dict);
    initI18n();
    initSmoothScroll({ reduced });
    initNav();
    initAssetMedia();
    initFaq();
    initIcons({ reduced });
    initCursor({ reduced });
    initMagnetic({ reduced });
    initInteract({ reduced });
    initInstitutional({ reduced });

    initScenes?.({ reduced });

    const smoother = getSmoother();
    if (smoother) smoother.paused(true);

    initPreloader({
      reduced,
      waitFor: (onProgress) => preloadCritical(onProgress),
      onDone: () => {
        if (smoother) smoother.paused(false);
        runIntro?.({ reduced });
      },
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
