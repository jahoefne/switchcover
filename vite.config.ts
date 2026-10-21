/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from https://jahoefne.github.io/switchcover/.
export default defineConfig({
  base: '/switchcover/',
  plugins: [react()],
  worker: { format: 'es' },
  // three.js makes the main chunk ~970 kB; that is expected for a 3D app.
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // manifold-3d ships its own WASM loader; pre-bundling breaks its import.meta.url lookup.
  optimizeDeps: { exclude: ['manifold-3d'] },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
