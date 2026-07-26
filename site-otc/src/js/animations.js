import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

let manifestoSplit = null;
let manifestoTrigger = null;

// ---------- Intro do hero (roda depois do preloader) ----------
export function runHeroIntro({ reduced }) {
  if (reduced) return;

  const lines = document.querySelectorAll('.hero-title .line-inner');
  // y:0 zera o translateY(115%) do CSS (canal separado do yPercent no GSAP)
  gsap.fromTo(
    lines,
    { yPercent: 115, y: 0 },
    { yPercent: 0, duration: 1.15, ease: 'power4.out', stagger: 0.12, delay: 0.05 }
  );
  gsap.fromTo(
    ['.hero-kicker', '.hero-sub', '.hero-ctas', '.hero-scroll'],
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.09, delay: 0.55 }
  );
  gsap.fromTo(
    '#nav',
    { opacity: 0, y: -16 },
    { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', delay: 0.4 }
  );
}

// ---------- Manifesto: palavras acendem com o scroll ----------
function buildManifesto() {
  const el = document.getElementById('manifestoText');
  if (!el) return;

  if (manifestoTrigger) manifestoTrigger.kill();
  if (manifestoSplit) manifestoSplit.revert();

  manifestoSplit = new SplitText(el, { type: 'words', wordsClass: 'w' });

  manifestoTrigger = ScrollTrigger.create({
    trigger: el,
    start: 'top 80%',
    end: 'center 42%',
    onUpdate: (self) => {
      const lit = Math.floor(self.progress * manifestoSplit.words.length);
      manifestoSplit.words.forEach((w, i) => w.classList.toggle('is-lit', i < lit));
    },
  });
}

// ---------- Contadores dos números ----------
function initCounters() {
  document.querySelectorAll('[data-stat]').forEach((el) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        el.closest('.stat')?.classList.add('is-inview');
        const finalText = el.textContent;
        const match = finalText.match(/\d+/);
        if (!match) return;
        const target = parseInt(match[0], 10);
        if (target === 0) return;
        const state = { v: 0 };
        gsap.to(state, {
          v: target,
          duration: 1.4,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = finalText.replace(match[0], String(Math.round(state.v)));
          },
          onComplete: () => {
            el.textContent = finalText;
          },
        });
      },
    });
  });
}

// ---------- Seção "Como funciona": pin + scroll horizontal ----------
function initProcessPin() {
  const mm = gsap.matchMedia();
  mm.add('(min-width: 861px)', () => {
    const track = document.getElementById('processTrack');
    const progress = document.getElementById('processProgress');
    if (!track) return;

    const distance = () => Math.max(0, track.scrollWidth - window.innerWidth + 60);

    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: '#process',
        start: 'top top',
        end: () => '+=' + distance(),
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          if (progress) progress.style.transform = `scaleX(${self.progress})`;
        },
      },
    });

    return () => tween.scrollTrigger?.kill();
  });
}

// ---------- Reveals genéricos ----------
function initReveals() {
  // títulos de seção (linhas mascaradas)
  document
    .querySelectorAll('.section-title, .cta-title')
    .forEach((title) => {
      const inners = title.querySelectorAll('.line-inner');
      if (!inners.length) return;
      gsap.fromTo(
        inners,
        { yPercent: 115, y: 0 },
        {
          yPercent: 0,
          duration: 1.05,
          ease: 'power4.out',
          stagger: 0.12,
          scrollTrigger: { trigger: title, start: 'top 82%', once: true },
        }
      );
    });

  // blocos com data-reveal
  document.querySelectorAll('[data-reveal]').forEach((el, i) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 46 },
      {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: 'power3.out',
        delay: (i % 4) * 0.08,
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        onComplete: () => el.classList.add('is-revealed'),
      }
    );
  });

  // kickers e textos soltos
  document.querySelectorAll('.kicker, .stats-note, .cta-sub, .btn--xl').forEach((el) => {
    gsap.fromTo(
      el,
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      }
    );
  });
}

export function initAnimations({ reduced }) {
  if (reduced) return; // CSS garante tudo visível

  buildManifesto();
  initCounters();
  initProcessPin();
  initReveals();

  // retraduzir = re-splitar o manifesto
  document.addEventListener('langchange', () => {
    buildManifesto();
    ScrollTrigger.refresh();
  });
}
