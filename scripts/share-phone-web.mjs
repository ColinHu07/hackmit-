import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;

// Verified against https://serveo.net/docs/ (SSH setup and keys), September 2026.
const serveoFingerprint = 'SHA256:GnmVK+70U6GqbupoV+gg7LnHHUsW1IjrK0cLqvDJxIk';
const serveoKnownHosts = fileURLToPath(new URL('./serveo-known-hosts', import.meta.url));

export function serveoSshArgs(port) {
  const entries = readFileSync(serveoKnownHosts, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  const [host, algorithm, key] = entries[0]?.split(/\s+/) ?? [];
  const fingerprint = key && `SHA256:${createHash('sha256').update(Buffer.from(key, 'base64')).digest('base64').replace(/=+$/, '')}`;
  if (entries.length !== 1 || host !== '[serveo.net]:443' || algorithm !== 'ssh-ed25519' || fingerprint !== serveoFingerprint) {
    throw new Error('The pinned Serveo host key does not match its verified fingerprint. Restore scripts/serveo-known-hosts; do not bypass host verification.');
  }
  return [
    '-F', 'none', '-p', '443',
    '-o', `UserKnownHostsFile=${serveoKnownHosts}`,
    '-o', `GlobalKnownHostsFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'UpdateHostKeys=no',
    '-o', 'IdentityFile=none', '-o', 'CertificateFile=none', '-o', 'IdentityAgent=none',
    '-o', 'PubkeyAuthentication=no', '-o', 'PasswordAuthentication=no',
    // Serveo's anonymous handshake uses keyboard-interactive with no password challenge.
    '-o', 'PreferredAuthentications=keyboard-interactive', '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    '-T', '-R', `80:127.0.0.1:${port}`, '--', 'bondimals@serveo.net', '--https-only',
  ];
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    // Keep our process groups separate so stopping this launcher also stops npm's children.
    detached: process.platform !== 'win32',
    ...options,
  });
  children.add(child);
  child.once('close', () => children.delete(child));
  return child;
}

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`Could not stop a child process: ${error.message}`);
  }
}

async function stop(code, message) {
  if (stopping) return;
  stopping = true;
  if (message) console.error(`\n${message}`);
  const active = [...children];
  const closed = active.map(child => new Promise(resolveClosed => child.once('close', resolveClosed)));
  active.forEach(child => signalChild(child, 'SIGTERM'));
  await Promise.race([Promise.all(closed), delay(4_000)]);
  // Kill the whole original group, including any npm descendants still winding down.
  active.forEach(child => signalChild(child, 'SIGKILL'));
  process.exit(code);
}

process.once('SIGINT', () => void stop(0, 'Stopping the phone link and its game server.'));
process.once('SIGTERM', () => void stop(0));

function completed(child) {
  return new Promise((resolveDone, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolveDone();
      else reject(new Error(`Process exited ${signal ? `with signal ${signal}` : `with code ${code}`}.`));
    });
  });
}

function monitor(child, label) {
  child.once('error', error => void stop(1, `${label} could not start: ${error.message}`));
  child.once('close', (code, signal) => {
    if (!stopping) void stop(1, `${label} stopped (${signal || `exit ${code}`}). Run npm run web:share to create a new link.`);
  });
}

async function availablePort(start) {
  for (let port = start; port <= Math.min(start + 100, 65535); port++) {
    const free = await new Promise((resolveFree, reject) => {
      const probe = createServer();
      probe.once('error', error => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolveFree(false);
        else reject(error);
      });
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolveFree(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free local port found starting at ${start}. Try npm run web:share -- --port 8890.`);
}

async function waitForServer(url, timeoutMs = 15_000, headers = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000), cache: 'no-store', headers });
      const health = response.ok && await response.json();
      if (health?.ok && health.service === 'bondimals-play') return;
    } catch { /* The new server may not have bound its port yet. */ }
    await delay(500);
  }
  throw new Error(`The phone game server did not become ready within ${timeoutMs / 1_000} seconds.`);
}

async function main() {
  const { values } = parseArgs({ options: {
    port: { type: 'string' },
    provider: { type: 'string', default: 'cloudflare' },
    server: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: npm run web:share [-- --provider cloudflare|serveo --port 8790 --server ws://HOST:8788/play]\n\nBuilds the phone web app and creates a temporary public HTTPS link.\n--server connects every player to that existing team server. Without it,\na separate local game server starts. Keep this terminal open.\nCloudflare (default) needs cloudflared; Serveo uses SSH on port 443.\nWEB_PORT can also select the first local port to try; occupied ports are skipped.');
    return;
  }
  const provider = values.provider;
  if (!['cloudflare', 'serveo'].includes(provider)) {
    throw new Error('Choose --provider cloudflare or --provider serveo.');
  }
  const preferredPort = Number(values.port ?? process.env.WEB_PORT ?? 8790);
  if (!Number.isInteger(preferredPort) || preferredPort < 1024 || preferredPort > 65535) {
    throw new Error('Choose a local port between 1024 and 65535.');
  }
  let upstream;
  if (values.server) {
    upstream = new URL(values.server);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(upstream.protocol) || upstream.username || upstream.password
      || upstream.search || upstream.hash || !['/', '/play', '/ws'].includes(upstream.pathname)) {
      throw new Error('--server needs an HTTP(S) or WS(S) game server address ending in /play, /ws, or /.');
    }
  }
  try {
    await completed(spawnChild(provider === 'serveo' ? 'ssh' : 'cloudflared', [provider === 'serveo' ? '-V' : '--version'], { stdio: 'ignore' }));
  } catch {
    if (provider === 'serveo') throw new Error('OpenSSH is required for Serveo sharing. Install an SSH client, then run npm run web:share -- --provider serveo again.');
    throw new Error('cloudflared is required for a shareable HTTPS link. On macOS, install it with: brew install cloudflared\nThen run npm run web:share again.');
  }
  // Validate our public host key before building or starting any server.
  if (provider === 'serveo') serveoSshArgs(preferredPort);

  console.log('Building the phone web app…');
  await completed(spawnChild(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:phone'], {
    // This session serves the UI and game together, even if a separate server was used before.
    env: { ...process.env, VITE_PLAY_SERVER_URL: '' },
  }));
  if (stopping) return;
  const port = await availablePort(preferredPort);
  const localUrl = `http://127.0.0.1:${port}`;
  const server = spawnChild(process.execPath, upstream
    ? [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', resolve(root, 'companion-web'), '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : ['--import', './scripts/load-env.mjs', 'bridge/play-server.mjs', '--web'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      WEB_ROOT: resolve(root, 'companion-web/dist'),
      // A quick tunnel has a new hostname each run. This setting affects only this test server.
      ALLOWED_ORIGINS: '',
      PLAY_UPSTREAM_URL: upstream?.href || '',
    },
  });
  monitor(server, upstream ? 'Team server web proxy' : 'Game server');
  if (upstream) console.log(`All gameplay goes to the team server at ${upstream.href}. No local game rooms are created.`);
  await waitForServer(localUrl);
  if (stopping) return;
  console.log(`${upstream ? 'Team server connection' : 'Game server'} ready at ${localUrl}. Creating the phone link…`);
  const tunnel = spawnChild(provider === 'serveo' ? 'ssh' : 'cloudflared', provider === 'serveo'
    ? serveoSshArgs(port)
    : ['tunnel', '--no-autoupdate', '--loglevel', 'info', '--url', localUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  monitor(tunnel, 'Phone tunnel');
  let announced = false;
  let output = '';
  const timeout = setTimeout(() => {
    void stop(1, `${provider === 'serveo' ? 'Serveo' : 'cloudflared'} did not provide a public link within 60 seconds. Check your internet connection and try again.`);
  }, 60_000);
  const onOutput = chunk => {
    process.stderr.write(chunk);
    output = (output + chunk.toString()).slice(-16_384);
    const match = output.match(provider === 'serveo'
      ? /https:\/\/[a-z0-9-]+\.(?:serveousercontent\.com|serveo\.net)\b/i
      : /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
    if (match && !announced) {
      announced = true;
      clearTimeout(timeout);
      console.log('Tunnel address allocated. Checking the public game connection…');
      const headers = provider === 'serveo' ? { 'serveo-skip-browser-warning': 'true' } : {};
      void waitForServer(match[0], 45_000, headers).then(() => {
        if (stopping) return;
        const browserNote = provider === 'serveo' ? '\nServeo may show a browser warning; tap its continue button to open the game.\n' : '';
        console.log(`\nShare this link with your friends:\n\n  ${match[0]}\n${browserNote}\nOpen it in Safari or Chrome, start a playground, then share the room's invite link.\nUp to 4 players can join each room; more friends can create additional rooms.\nServer activity: ${match[0]}/health\n\nKeep this Mac awake and this terminal running. Press Ctrl+C to stop sharing.\n`);
      }).catch(() => void stop(1, provider === 'serveo'
        ? 'The public phone link did not become reachable within 45 seconds. Check your internet connection or try another network, then run npm run web:share -- --provider serveo again.'
        : 'The public phone link did not become reachable within 45 seconds. This network may block Cloudflare Tunnel traffic on port 7844. Try npm run web:share -- --provider serveo, or switch networks.'));
    }
  };
  tunnel.stdout.on('data', onOutput);
  tunnel.stderr.on('data', onOutput);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => void stop(1, error.message));
}
