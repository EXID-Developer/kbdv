import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (`pnpm --filter backend dev`) serves /api; in production it also serves this app's build.
const proxy = { '/api': { target: 'http://localhost:8787', changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, proxy },
  preview: { port: 4173, host: true, proxy },
  build: { chunkSizeWarningLimit: 2500 },
});
