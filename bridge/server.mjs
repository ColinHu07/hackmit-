import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRelay } from './relay.mjs';

const stateDir = path.resolve(process.env.BONDIMALS_BRIDGE_STATE || '../.bondimals-bridge');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const stateFile = path.join(stateDir, 'pairing.json');
let pairing;
try { pairing = JSON.parse(await readFile(stateFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  pairing = { room: randomBytes(8).toString('hex'), publisherToken: randomBytes(24).toString('hex'), viewerToken: randomBytes(24).toString('hex') };
}
const port = Number(process.env.PORT || 8787);
const relay = process.env.BONDIMALS_RELAY_URL || `ws://localhost:${port}/ws`;
const site = process.env.BONDIMALS_WEB_URL || 'https://colinhu07.github.io/bondimals-display/';
const config = (token) => new URLSearchParams({ relay, room: pairing.room, token }).toString();
pairing.phoneLink = `bondimals://bridge?${config(pairing.publisherToken)}`;
pairing.glassesLink = `${site}#${config(pairing.viewerToken)}`;
pairing.simulatorLink = `${site}?simulator#${config(pairing.viewerToken)}`;
await writeFile(stateFile, JSON.stringify(pairing, null, 2), { mode: 0o600 });
const app = createRelay(pairing);
app.server.listen(port, process.env.BONDIMALS_BIND || '127.0.0.1', () => {
  console.log(`Kith landmark relay listening on port ${port}. Pairing links: ${stateFile}`);
  if (!relay.startsWith('wss:')) console.log('Local testing only: set BONDIMALS_RELAY_URL to a public wss:// endpoint for glasses.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
