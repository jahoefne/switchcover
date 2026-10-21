/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from https://jahoefne.github.io/switchcover/.
export default defineConfig({
  base: '/switchcover/',
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  // manifold-3d ships its own WASM loader; pre-bundling breaks its import.meta.url lookup.
  optimizeDeps: { exclude: ['manifold-3d'] },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
