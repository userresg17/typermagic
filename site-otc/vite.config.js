import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// páginas: site atual (index) + variantes de desktop + seletor (as que existirem)
const pages = Object.fromEntries(
  ['index', 'galeria', 'terminal', 'monolito', 'escolher']
    .map((n) => [n === 'index' ? 'main' : n, resolve(__dirname, `${n}.html`)])
    .filter(([, p]) => existsSync(p))
);

// base './' → o build funciona em qualquer hospedagem, inclusive subpastas (cPanel etc.)
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: pages,
      output: {
        manualChunks: {
          three: ['three'],
          gsap: ['gsap'],
          motion: ['motion', 'animejs'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
