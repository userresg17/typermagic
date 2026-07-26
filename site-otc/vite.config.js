import { defineConfig } from 'vite';

// base './' → o build funciona em qualquer hospedagem, inclusive subpastas (cPanel etc.)
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
    rollupOptions: {
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
