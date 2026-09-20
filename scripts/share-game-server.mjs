import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { serveoSshArgs } from './share-phone-web.mjs';

// Expose the existing game server; never start a second set of rooms. A reserved
// hostname is mandatory because anonymous tunnel restarts change client URLs.
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '8788' },
  hostname: { type: 'string' },
  identity: { type: 'string' },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: node scripts/share-game-server.mjs --hostname NAME.serveousercontent.com --identity /path/to/registered-key [--port 8788]\nShares an existing game server with a fixed HTTPS/WSS address and reconnects the tunnel after interruptions. Keep this Mac awake.');
  process.exit(0);
}
if (!values.hostname || !values.identity) throw new Error('Pass a reserved --hostname and its registered --identity file.');
const port = Number(values.port);
const args = serveoSshArgs(port, { hostname: values.hostname, identityFile: values.identity });
await access(values.identity);
const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
const health = response.ok && await response.json();
if (!health?.ok || health.service !== 'bondimals-play') throw new Error(`Start the existing Kith game server on port ${port} first.`);

const expected = `https://${values.hostname}`;
let active, stopping = false, fatal = false;
const abort = new AbortController();
function stop() { stopping = true; abort.abort(); active?.kill('SIGTERM'); }
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
let failures = 0;
while (!stopping && !fatal) {
  console.log(`Connecting ${expected} to the existing game server on port ${port}…`);
  const sessionStarted = Date.now();
  await new Promise(resolve => {
    const child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    active = child;
    let output = '';
    const onData = chunk => {
      process.stderr.write(chunk);
      output = (output + chunk.toString()).slice(-16384);
      const match = output.match(/Forwarding HTTP traffic from (https:\/\/[a-z0-9.-]+)/);
      if (match && match[1] !== expected && !fatal) {
        console.error('Serveo did not accept the reserved hostname. Register the key and reserve the domain in your account before retrying.');
        fatal = true;
        child.kill('SIGTERM');
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', error => { console.error(error.message); fatal = true; });
    child.once('close', resolve);
  });
  active = undefined;
  if (stopping || fatal) break;
  failures = Date.now() - sessionStarted >= 60_000 ? 0 : failures + 1;
  if (failures >= 12) { console.error('The tunnel repeatedly failed. Check the registered key and network, then restart this command.'); fatal = true; break; }
  const waitMs = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
  console.log(`Tunnel disconnected. Reconnecting the same address in ${waitMs / 1000}s…`);
  await delay(waitMs, undefined, { signal: abort.signal }).catch(() => {});
}
process.exitCode = fatal ? 1 : 0;
