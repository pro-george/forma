import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set BASE_PATH to the site root when deploying (studio.artea.ro serves Artea Studio at / and Forma at /forma/).
const base = (process.env.BASE_PATH ?? '/') + '';

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  server: { port: 5174 },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1600 },
});
