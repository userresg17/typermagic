// Fontes (self-hosted via fontsource)
import '@fontsource-variable/inter';
import '@fontsource/instrument-serif';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

// Estilos
import '../styles/base.css';
import '../styles/layout.css';
import '../styles/components.css';
import '../styles/animations.css';

// Módulos
import { initI18n } from './i18n.js';
import { initSmoothScroll, getSmoother } from './smooth-scroll.js';
import { initNav } from './nav.js';
import { initAssetMedia } from './assets.js';
import { initScenes, runIntro } from './scenes.js';
import { initFaq } from './faq.js';
import { initIcons } from './icons.js';
import { initCursor } from './cursor.js';
import { initMagnetic } from './magnetic.js';
import { initPreloader } from './preloader.js';
import { initBlob3D } from './blob3d.js';
import { initInteract } from './interact.js';
import { initStageMedia, preloadCritical } from './loader.js';

const html = document.documentElement;
html.classList.add('js');

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) html.classList.add('reduced-motion');

function boot() {
  initI18n();
  initStageMedia(); // desliga o vídeo de palco que não vale p/ o dispositivo
  initSmoothScroll({ reduced });
  initNav();
  initAssetMedia();
  initFaq();
  initIcons({ reduced });
  initCursor({ reduced });
  initMagnetic({ reduced });
  initInteract({ reduced }); // o mouse vira o tempo dos vídeos (scrub invisível)

  const blob = initBlob3D({ reduced });
  initScenes({ reduced, blob });

  const smoother = getSmoother();
  if (smoother) smoother.paused(true);

  initPreloader({
    reduced,
    waitFor: (onProgress) => preloadCritical(onProgress), // progresso REAL
    onDone: () => {
      if (smoother) smoother.paused(false);
      runIntro({ reduced });
      blob.start(); // o personagem entra em cena depois do preloader
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
