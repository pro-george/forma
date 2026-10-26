import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set BASE_PATH to the site root when deploying (studio.artea.ro serves Artea Studio at / and Forma at /forma/).
const base = (process.env.BASE_PATH ?? '/') + 'forma/';

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  server: { port: 5173 },
  build: { target: 'es2022', sourcemap: true },
});
