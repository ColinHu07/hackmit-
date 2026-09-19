import { Playground } from '../../companion-web/src/Playground';
import type { PlaySnapshot, PlayServerMessage } from '../../shared/play-protocol';
import './shared-view.css';

const root = document.getElementById('app')!;
root.innerHTML = `<main><canvas id="meadow" width="600" height="600" aria-label="Two pets in a shared virtual meadow"></canvas><form id="pair"><h1>Shared meadow</h1><p>This is a virtual view of your phone playground.</p><label>Server address<input id="server" type="url" required placeholder="wss://example.com/play"></label><label>Display code<input id="code" required maxlength="8" minlength="8" autocomplete="off" placeholder="8 characters"></label><button type="submit">Connect display</button></form><p id="status" role="status">Enter the code shown on your phone.</p></main>`;
const canvas = document.getElementById('meadow') as HTMLCanvasElement;
const form = document.getElementById('pair') as HTMLFormElement;
const status = document.getElementById('status')!;
const server = document.getElementById('server') as HTMLInputElement;
const code = document.getElementById('code') as HTMLInputElement;
server.value = localStorage.getItem('bondimals:shared-server') ?? (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'ws://127.0.0.1:8788/play' : `wss://${location.host}/play`);
let socket: WebSocket | null = null;
let playerId: string | null = null;
let revision = -1;
const playground = new Playground(canvas, () => {});
void playground.load().catch(() => { status.textContent = 'The pet model could not load.'; });
playground.setEnabled(false);

function accept(snapshot: PlaySnapshot): void {
  if ((snapshot.revision ?? 0) < revision) return;
  revision = snapshot.revision ?? 0;
  playground.update(snapshot, playerId);
  status.textContent = `${snapshot.players.filter(player => player.connected).length}/2 pets here · ${snapshot.notice}`;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  let url: URL;
  try {
    url = new URL(server.value.trim());
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol) || (location.protocol === 'https:' && url.protocol !== 'wss:')) throw new Error();
  } catch { status.textContent = 'Enter a valid WebSocket server address.'; return; }
  const grant = code.value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(grant)) { status.textContent = 'Enter the 8-character display code.'; return; }
  socket?.close();
  const active = new WebSocket(url);
  socket = active;
  localStorage.setItem('bondimals:shared-server', url.href);
  status.textContent = 'Connecting…';
  active.addEventListener('open', () => active.send(JSON.stringify({ type: 'attach_display', grant })));
  active.addEventListener('message', event => {
    if (active !== socket) return;
    let message: PlayServerMessage;
    try { message = JSON.parse(String(event.data)) as PlayServerMessage; } catch { return; }
    if (message.type === 'error') { status.textContent = message.message; return; }
    if (message.type === 'display_welcome') {
      if (message.protocolVersion !== 1) { status.textContent = 'Update this glasses app to join.'; active.close(); return; }
      playerId = message.playerId;
      revision = -1;
      form.hidden = true;
      accept(message.snapshot);
    } else if (message.type === 'snapshot' && playerId) accept(message.snapshot);
  });
  active.addEventListener('close', () => { if (active === socket) { status.textContent = 'Display disconnected. Request a new code on your phone.'; form.hidden = false; } });
});
window.addEventListener('pagehide', () => { socket?.close(); playground.dispose(); });
