import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [{
    name: 'kith-meadow-launch-page',
    apply: 'build',
    writeBundle(output) {
      // A new entry URL lets installed glasses bypass an older cached index.
      // Refresh this alias on every build so it remains a supported app URL.
      const directory = output.dir || fileURLToPath(new URL('./dist/', import.meta.url));
      copyFileSync(resolve(directory, 'index.html'), resolve(directory, 'meadow.html'));
    },
  }],
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
