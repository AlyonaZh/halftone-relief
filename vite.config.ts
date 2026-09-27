import { defineConfig } from 'vite';

// base './' — сборка работает из любой подпапки (GitHub Pages: /halftone-relief/)
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { target: 'es2022' },
});
