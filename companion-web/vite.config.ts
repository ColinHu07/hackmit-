import { defineConfig, loadEnv } from 'vite';

// Proxy the existing team server through the web origin so HTTPS phones can use
// a LAN WebSocket server without starting a second, isolated game server.
export default defineConfig(({ mode }) => {
  const upstream = new URL(loadEnv(mode, '.', 'PLAY_UPSTREAM_URL').PLAY_UPSTREAM_URL || 'http://127.0.0.1:8788');
  if (upstream.protocol === 'ws:') upstream.protocol = 'http:';
  if (upstream.protocol === 'wss:') upstream.protocol = 'https:';
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password
    || upstream.search || upstream.hash || !['/', '/play', '/ws'].includes(upstream.pathname)) {
    throw new Error('PLAY_UPSTREAM_URL must be an HTTP(S) or WS(S) game server address ending in /play, /ws, or /.');
  }

  return {
    // Reuse the supplied character. Both clients ship exactly the same asset.
    publicDir: '../glasses-web/public',
    server: {
      strictPort: true,
      proxy: {
        '/play': { target: upstream.origin, ws: true },
        '/nearby': { target: upstream.origin, ws: true },
        '/verify': { target: upstream.origin },
        '/health': { target: upstream.origin },
      },
    },
    preview: {
      // Limit temporary sharing to supported tunnel providers.
      allowedHosts: ['.serveousercontent.com', '.serveo.net', '.trycloudflare.com', '.free.pinggy.net', '.run.pinggy-free.link'],
    },
    build: { target: 'es2022' },
  };
});
