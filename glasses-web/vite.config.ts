import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: Object.fromEntries(['/play', '/health', '/verify', '/glasses'].map(path => [path, {
      target: process.env.PLAY_UPSTREAM_URL || 'http://127.0.0.1:8788', ws: path === '/play',
    }])),
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: {
      index: fileURLToPath(new URL('./index.html', import.meta.url)),
      legacy: fileURLToPath(new URL('./legacy.html', import.meta.url)),
    } },
  },
});
