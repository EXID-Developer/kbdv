import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// News APIs do not send CORS headers, so the browser reaches them through these proxies.
const upstream = (target: string, prefix: string): ProxyOptions => ({
  target,
  changeOrigin: true,
  rewrite: (path) => path.slice(prefix.length),
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => {
      req.removeHeader('origin');
      req.removeHeader('referer');
      req.removeHeader('cookie');
    });
  },
});

const proxy = {
  '/proxy/naverapihub': upstream('https://naverapihub.apigw.ntruss.com', '/proxy/naverapihub'),
  '/proxy/naveropenapi': upstream('https://openapi.naver.com', '/proxy/naveropenapi'),
  '/proxy/gnews': upstream('https://news.google.com', '/proxy/gnews'),
  // '/proxy/naver': upstream('https://openapi.naver.com', '/proxy/naver'),
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, proxy },
  preview: { port: 4173, host: true, proxy },
  // Served locally to a kiosk, so one large bundle is fine.
  build: { chunkSizeWarningLimit: 2500 },
});
