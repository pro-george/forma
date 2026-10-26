import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set BASE_PATH when deploying under a sub-path (GitHub Pages serves the repo at /forma/).
const base = (process.env.BASE_PATH ?? '/') + 'artea/';

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  server: { port: 5174 },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1600 },
});
