// Detecta assets reais (vídeos do Sora / imagens do Nano Banana) e troca os
// placeholders automaticamente. Basta soltar os arquivos em public/assets/.
export function initAssetMedia() {
  document.querySelectorAll('video.asset-video').forEach((video) => {
    const mark = () => {
      video.classList.add('is-live');
      const wrap = video.parentElement;
      if (wrap) wrap.classList.add('has-asset');
    };
    if (video.readyState >= 3) mark();
    else video.addEventListener('canplay', mark, { once: true });
  });

  document.querySelectorAll('img[data-asset]').forEach((img) => {
    const mark = () => {
      img.classList.add('is-loaded');
      const wrap = img.parentElement;
      if (wrap) wrap.classList.add('has-asset');
    };
    if (img.complete && img.naturalWidth > 0) mark();
    else img.addEventListener('load', mark, { once: true });
  });
}
