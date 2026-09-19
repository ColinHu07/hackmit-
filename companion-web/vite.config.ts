import { defineConfig } from 'vite';

export default defineConfig({
  // Reuse the supplied character. Both clients ship exactly the same asset.
  publicDir: '../glasses-web/public',
  server: { strictPort: true },
  build: { target: 'es2022' },
});
