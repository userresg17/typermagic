import pt from '../i18n/pt.json';
import en from '../i18n/en.json';

const dict = { pt, en };
const STORAGE_KEY = 'otc-lang';

// Variantes registram strings próprias antes do initI18n()
export function registerDict(extra) {
  if (extra?.pt) Object.assign(dict.pt, extra.pt);
  if (extra?.en) Object.assign(dict.en, extra.en);
}

// PT-BR é a língua principal do site; EN só quando o visitante escolhe no toggle
let current = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'pt';

export function t(key) {
  return dict[current][key] ?? key;
}

export function getLang() {
  return current;
}

function apply(lang) {
  const d = dict[lang];
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  document.title = d['meta.title'];

  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', d['meta.description']);

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (d[key] != null) el.textContent = d[key];
  });

  document.querySelectorAll('.lang-toggle button').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === lang);
  });
}

function switchLang(lang) {
  if (lang === current) return;
  current = lang;
  localStorage.setItem(STORAGE_KEY, lang);

  const html = document.documentElement;
  html.classList.add('lang-switching');
  setTimeout(() => {
    apply(lang);
    html.classList.remove('lang-switching');
    document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }, 260);
}

export function initI18n() {
  apply(current);
  document.querySelectorAll('.lang-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => switchLang(btn.dataset.lang));
  });
}
