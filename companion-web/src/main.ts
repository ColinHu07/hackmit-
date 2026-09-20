import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './style.css';
import { LocalWeather } from './LocalWeather';
import { readMood, moodValue, rewardMood } from './PetMood';
import { Playground } from './Playground';
import { RoomClient, normalizeServerUrl } from './RoomClient';
import { NearbyClient } from './NearbyClient';
import { LocationDiscovery } from './LocationDiscovery';
import { DevelopmentLocation } from './DevelopmentLocation';
import { isNativePhone, nativeCommand, nativeFix, NativeLocation, onNativeEvent } from './NativePhone';
import { WalkingTracker } from './WalkingTracker';
import type { LocationFix } from './LocationDiscovery';
import type { NearbyPet, MeetRequest } from '../../shared/nearby-protocol';
import type { ConnectionState, Membership } from './RoomClient';
import type { PetActionKind, PlaySnapshot } from '../../shared/play-protocol';

const paths: Record<string, string> = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  leaf: '<path d="M19 4C8 3 3 8 6 15s14 3 13-11Z"/><path d="M5 20 15 10"/>',
  heart: '<path d="m12 20-8-8C-2 6 6 0 12 7c6-7 14-1 8 5Z"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="3"/><path d="M15 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h2"/>',
  wave: '<path d="M8 13 5 8a2 2 0 0 1 3-2l3 5-3-7a2 2 0 0 1 3-1l3 7-1-6a2 2 0 0 1 4 0l1 10 1-3a2 2 0 0 1 3 1l-1 5c-1 5-8 6-11 2l-5-5a2 2 0 0 1 3-3l3 3M3 3 1 1M20 3l2-2"/>',
  treat: '<path d="M12 20 4 9l3-5h10l3 5-8 11ZM4 9h16M7 4l5 16 5-16"/>',
  jump: '<path d="M12 18V4m-5 5 5-5 5 5M5 18v3h14v-3"/>',
  play: '<path d="m8 3 3 5-3 5-3-5 3-5Zm10 8 3 5-3 5-3-5 3-5ZM16 3v4m-2-2h4M4 17v4m-2-2h4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="m10 14 4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 8a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.leaf}</svg>`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Bondimals home"><span class="brand-mark">${icon('leaf')}</span>bondimals</a>
    <div class="header-right"><span class="edition">A LITTLE CLOSER, TOGETHER</span><button class="icon-button" id="server-settings" aria-label="Server settings" title="Server settings">${icon('settings')}</button></div>
  </header>
  <main class="layout">
    <section class="side-panel" aria-label="Your playground">
      <div id="home-panel">
        <div class="eyebrow"><span class="sun-dot"></span> GOOD COMPANY, CLOSE BY</div>
        <h1>Your next friend.<br><em>A few steps away.</em></h1>
        <p class="intro">Discover nearby pets. Say hello in person.<br>Let your little worlds meet.</p>
        <form id="entry-form" class="entry-card">
          <div id="manual-modes" class="entry-tabs" role="tablist" aria-label="How to join" hidden><button type="button" role="tab" aria-selected="true" id="create-tab">Start a playground</button><button type="button" role="tab" aria-selected="false" id="join-tab">Join a friend</button></div>
          <label for="player-name">Your name</label><input id="player-name" name="name" autocomplete="given-name" maxlength="24" placeholder="What should we call you?" required />
          <div id="location-explainer" class="location-explainer"><span class="range-chip">ABOUT 10 METERS</span><p>Find people who are also playing nearby. Nearby discovery starts automatically and can be paused. Your location is shared with the game server while it is active. Rounded coordinates are used for local weather. Other players see your pet and an approximate distance.</p><span id="location-host"></span></div>
          <div id="room-input-wrap" hidden><label for="room-input">Your friend's room code</label><input id="room-input" name="room" maxlength="6" minlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" pattern="[A-Za-z0-9]{6}" /></div>
          <button class="primary-button" id="enter-button" type="submit" disabled><span id="enter-label">Loading your pet…</span>${icon('arrow')}</button>
          <p class="form-note" id="entry-note">${icon('people')} Turn a nearby pet into a real hello.</p>
          <button type="button" id="entry-mode" class="entry-mode">Use a room code instead</button>
        </form>
        <div class="little-note"><span class="note-line"></span><p>The best adventures<br>start with a little hello.</p></div>
      </div>
      <div id="nearby-panel" hidden>
        <div class="eyebrow"><span class="sun-dot"></span> AROUND YOU, RIGHT NOW</div>
        <h1>Little paws.<br><em>Real hellos.</em></h1>
        <div class="nearby-summary"><span class="range-chip">~10 M RANGE</span><span id="nearby-count">Looking for pets…</span></div>
        <p class="nearby-status" id="location-status" role="status">Waiting for location permission…</p>
        <p class="nearby-accuracy" id="nearby-accuracy">Distances are estimates. Pet placement is illustrative.</p>
        <div id="nearby-list" class="nearby-list" aria-label="Nearby pets"></div>
        <div id="meet-request" class="quest-card request-card" hidden><span class="small-label">A LITTLE HELLO</span><h2 id="request-title"></h2><p id="request-description"></p><div class="request-actions"><button id="accept-meet" class="primary-button">Let’s meet ${icon('arrow')}</button><button id="decline-meet" class="text-button">Not now</button></div></div>
        <button id="resume-nearby" class="primary-button" hidden>Resume nearby ${icon('arrow')}</button>
        <p class="nearby-accuracy">Discovery shares your location with the game server while this app is open. Local weather uses rounded coordinates.</p><button id="stop-nearby" class="leave-button">Stop nearby discovery</button>
      </div>
      <div id="room-panel" hidden>
        <div class="eyebrow"><span class="sun-dot"></span> YOUR SHARED PLAYGROUND</div>
        <h1>A very good<br><em>place to meet.</em></h1>
        <div class="invite-card" id="room-invite"><div><span class="small-label">ROOM CODE</span><button id="copy-code" class="room-code" title="Copy room code"><span id="room-code">------</span>${icon('copy')}</button></div><button id="invite-button" class="round-button" title="Invite your friend" aria-label="Invite your friend">${icon('link')}</button></div>
        <p id="invite-note" class="room-description">Share your room code. Your friend's pet will appear here.</p>
        <div class="roster" id="roster" aria-label="Players"></div>
        <div id="dap-quest" class="quest-card dap-card" hidden><div class="quest-header"><span class="quest-symbol">${icon('wave')}</span><div><span class="small-label">MEET IN REAL LIFE</span><h2>Dap them up</h2></div></div><p>Walk over, introduce yourselves, and share a dap, high-five, or wave.</p><button class="primary-button" id="confirm-dap">We said hello ${icon('check')}</button><p id="dap-status" role="status">Both players confirm after meeting in person.</p></div>
        <div class="quest-card">
          <div class="quest-header"><span class="quest-symbol">${icon('play')}</span><div><span class="small-label">YOUR QUEST BOARD</span><h2>Grow your little world</h2></div><span class="quest-count" id="quest-count">0/5</span></div>
          <ol class="quest-list"><li id="quest-touch-grass"><span class="quest-tick">${icon('check')}</span><span><strong>Solo · touch grass <em class="verification-tag" id="touch-grass-tag">PHOTO CHECK</em></strong><small>Walk your pet one world-unit, then share a photo of grass to finish it.</small></span></li><li id="quest-meet-friend"><span class="quest-tick">${icon('check')}</span><span><strong>Duo · meet another user</strong><small id="duo-status">Bring a second pet into the pen, then meet nearby.</small></span></li><li id="quest-dap-handshake"><span class="quest-tick">${icon('check')}</span><span><strong>Duo · dap up</strong><small id="dap-handshake-status">Stand close to a pet and both tap Dap up within a few seconds.</small></span></li><li id="quest-squad-circle"><span class="quest-tick">${icon('check')}</span><span><strong>Squad · circle up</strong><small id="squad-status">Needs three connected pets in the pen.</small></span></li><li id="quest-raid-boss"><span class="quest-tick">${icon('check')}</span><span><strong>Raid · calm Mossback</strong><small id="raid-quest-status">Complete the squad circle to call the meadow’s tangled guardian.</small></span></li></ol>
          <button id="meet-button" class="text-button" disabled>Meet in the middle ${icon('arrow')}</button><button id="ready-squad" class="text-button" disabled>Ready for squad circle ${icon('arrow')}</button><button id="verify-touch-grass" class="text-button" hidden>Verify touch grass photo ${icon('arrow')}</button><input id="touch-grass-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden /><p id="photo-verification-status" class="photo-verification-status" role="status" hidden></p>
        </div>
        <div class="quest-card raid-card" id="raid-card"><div class="quest-header"><span class="quest-symbol">✦</span><div><span class="small-label">SQUAD RAID · 3–4 PETS</span><h2>Mossback, Keeper of the Pen</h2></div></div><p id="raid-description">A gentle guardian’s vine magic has tangled up. Gather a completed squad close together, then calm it with your pets’ actions.</p><div class="raid-health"><span id="raid-health-label">Mossback is resting</span><meter id="raid-health-meter" min="0" max="1" value="0"></meter></div><button id="ready-raid" class="primary-button" disabled>Call Mossback ${icon('arrow')}</button></div>
        <button id="leave-button" class="leave-button">Leave playground</button>
      </div>
      <div id="error-message" class="error-message" role="alert" hidden></div>
    </section>
    <section class="playground-panel" aria-label="Your local world">
      <div class="scene-topline"><div class="scene-title">${icon('leaf')} <span id="world-title">AROUND YOU</span></div><div id="connection-status" class="connection-status" data-state="idle"><span></span><span id="connection-label">Pet preview</span></div></div>
      <div class="weather-line"><span id="weather-status" role="status">Allow location for your local weather</span></div><div class="scene" id="scene"><canvas id="playground" tabindex="0" aria-label="Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move."></canvas><div id="scene-loading" class="scene-loading"><span class="loading-dot"></span>Waking up Nova…</div></div>
      <div class="mood-card"><div><strong>Your pet’s happiness</strong><span id="mood-label"></span></div><meter id="mood-meter" min="0" max="100" value="70" aria-label="Pet happiness"></meter><p id="mood-note">Complete a quest together for +12 happiness. Slowly drifts down between adventures.</p></div>
      <div class="scene-caption" id="scene-caption"><span class="caption-star">✳</span> Small paws. Big adventures.</div>
      <div class="play-controls" id="play-controls" hidden>
        <div class="moment-line"><span id="scene-hint">Tap the ground to move your pet.</span><span class="bond-counter">${icon('heart')}<span id="bond-count">0</span><span class="bond-word">moments</span></span></div>
        <div class="action-bar action-bar-five"><button data-action="wave">${icon('wave')}<span>Wave</span></button><button data-action="dap" class="co-op-action">${icon('wave')}<span>Dap up</span></button><button data-action="feed">${icon('treat')}<span>Treat</span></button><button data-action="jump">${icon('jump')}<span>Jump</span></button><button data-action="play" class="co-op-action">${icon('play')}<span>Play together</span></button></div>
        <p class="action-notice" id="action-notice" role="status" aria-live="polite">Your little adventure starts here.</p>
      </div>
      <div id="native-tools" class="native-tools" hidden>
        <div class="native-walking-heading"><strong>Walk with your pet</strong><span id="compass-reading">Compass off</span></div>
        <p id="walking-status" role="status">Your pet follows your steps and the direction you face automatically.</p>
      </div>
      <section id="quest-tools" class="native-tools quest-tools" aria-label="Quest clips" hidden>
        <div class="native-walking-heading"><strong>Quest clips</strong></div>
        <p>Save a moment from your adventure.</p>
        <div class="native-buttons"><button id="record-clip">Record quest clip</button><button id="review-clip">Review clip</button><button id="delete-clip">Delete clip</button></div>
        <p id="recording-status" role="status">Record up to 10 seconds. Quest photo checks use a photo you choose to share.</p>
      </section>
      <div class="meadow-footer"><span>01 / THE FIRST HELLO</span><span>A WORLD WE MAKE TOGETHER</span></div>
    </section>
  </main>
  <footer class="site-footer"><span>More play. More connection.</span><span>PHONE EDITION <span class="tiny-star">✳</span> BONDIMALS</span></footer>
  <details class="app-credits"><summary>Credits</summary><p>Weather data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p></details>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="settings-dialog"><form id="settings-form"><div class="dialog-heading"><h2>Server settings</h2><button class="icon-button" type="button" id="close-settings" aria-label="Close settings">${icon('close')}</button></div><p>Both phones connect to the same multiplayer server. Use the address from your host.</p><label for="server-url">Multiplayer server URL</label><input id="server-url" type="url" spellcheck="false" autocapitalize="off" placeholder="wss://your-server.example/play" required /><p class="settings-note">On the same Wi-Fi, use your computer's network address and port 8788. A hosted HTTPS app needs a secure wss:// server.</p><p class="error-message" id="settings-error" hidden></p><button class="primary-button" type="submit">Save server ${icon('check')}</button></form></dialog>
`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function stored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function save(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } }
const resumeKey = 'bondimals:play-session';
function clearResume(): void { try { sessionStorage.removeItem(resumeKey); } catch { /* Storage is optional. */ } }
function readResume(): (Membership & { serverUrl: string }) | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(resumeKey) || 'null') as (Membership & { serverUrl: string }) | null;
    if (!saved || typeof saved.name !== 'string' || typeof saved.serverUrl !== 'string'
      || !/^[A-Z0-9]{6}$/.test(saved.roomCode) || !/^[a-f0-9]{48}$/.test(saved.playerToken)) return null;
    return saved;
  } catch { return null; }
}
const params = new URLSearchParams(location.search);
const devServer = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}${import.meta.env.DEV ? ':8788' : location.port ? `:${location.port}` : ''}${import.meta.env.DEV ? '' : '/play'}`;
let serverUrl = params.get('server') || stored('bondimals:server') || window.bondimalsNative?.serverURL || import.meta.env.VITE_PLAY_SERVER_URL || devServer;
let mode: 'nearby' | 'create' | 'join' = params.has('room') ? 'join' : 'nearby';
let walking = false;
const walkingTracker = new WalkingTracker();
let ready = false;
let connection: ConnectionState = 'idle';
let membership: Membership | null = null;
let snapshot: PlaySnapshot | null = null;
let playground: Playground | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let lastRoster = '';
let lastNotice = '';
let nearbyActive = false;
let locationActive = false;
let discoveryConnected = false;
let nearbyPeers: NearbyPet[] = [];
let pendingMeet: (MeetRequest & { incoming: boolean }) | null = null;
let nearbyListKey = '';
let photoVerificationPending = false;
const canvas = el<HTMLCanvasElement>('playground');
const nameInput = el<HTMLInputElement>('player-name');
const codeInput = el<HTMLInputElement>('room-input');
nameInput.value = stored('bondimals:name') || 'Explorer';
codeInput.value = (params.get('room') || '').toUpperCase().slice(0, 6);

let mood = readMood(stored('bondimals:mood'));
save('bondimals:mood', JSON.stringify(mood));
function renderMood(): void {
  const value = Math.round(moodValue(mood));
  el<HTMLMeterElement>('mood-meter').value = value;
  el('mood-label').textContent = `${value}% · ${value >= 80 ? 'Joyful' : value >= 50 ? 'Content' : 'Ready for company'}`;
}
renderMood();
setInterval(renderMood, 60_000);
const weather = new LocalWeather(value => {
  el('weather-status').textContent = value.label;
  document.querySelector<HTMLElement>('.playground-panel')!.dataset.weather = value.kind;
  playground?.setWeather(value.kind);
});
let autoNearby = stored('bondimals:auto-nearby') !== 'off';
function resumeAutomaticNearby(): void {
  renderMood();
  if (!ready || !autoNearby || membership || connection === 'connecting' || connection === 'reconnecting' || mode !== 'nearby' || document.hidden || (nearbyActive && locationActive)) return;
  try { startNearby(); } catch (cause) { error(cause instanceof Error ? cause.message : 'Check your server settings.'); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { resumeAutomaticNearby(); startWalking(); } });

function toast(message: string): void {
  clearTimeout(toastTimer);
  el('toast').textContent = message;
  el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 4000);
}
function verificationEndpoint(): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/verify';
  url.search = '';
  url.hash = '';
  return url.href;
}
function photoQuestComplete(quests: { touchGrass: boolean; photoVerification: Partial<Record<'touchGrass', 'required' | 'pending' | 'approved' | 'rejected'>> }, key: 'touchGrass' | 'meetFriend' | 'dapHandshake' | 'squadCircle' | 'raidBoss'): boolean {
  return key !== 'touchGrass' || quests.photoVerification.touchGrass === 'approved';
}
function error(message: string, terminal = false): void {
  if (terminal) clearResume();
  if (terminal && !membership && !nearbyActive) {
    el('nearby-panel').hidden = true;
    el('home-panel').hidden = false;
    el('app').classList.remove('in-nearby');
  }
  el('error-message').textContent = message;
  el('error-message').hidden = false;
  if (membership) toast(message);
}
function updateEntry(): void {
  const busy = connection === 'connecting';
  el('manual-modes').hidden = mode === 'nearby';
  el('location-explainer').hidden = mode !== 'nearby';
  el('entry-mode').textContent = mode === 'nearby' ? 'Use a room code instead' : 'Find nearby pets instead';
  try { el('location-host').textContent = `Game server: ${new URL(serverUrl).host}`; } catch { el('location-host').textContent = 'Set your game server in Server settings.'; }
  el('entry-note').textContent = mode === 'nearby' ? 'Turn a nearby pet into a real hello.' : 'A room for you and a friend.';
  el('room-input-wrap').hidden = mode !== 'join';
  codeInput.required = mode === 'join';
  el('create-tab').setAttribute('aria-selected', String(mode === 'create'));
  el('join-tab').setAttribute('aria-selected', String(mode === 'join'));
  el('enter-label').textContent = !ready ? 'Loading your pet…' : busy ? 'Opening your playground…' : mode === 'nearby' ? 'Find nearby pets' : mode === 'create' ? 'Let’s play together' : 'Join the playground';
  el<HTMLButtonElement>('enter-button').disabled = !ready || busy;
  el<HTMLButtonElement>('create-tab').disabled = busy;
  el<HTMLButtonElement>('join-tab').disabled = busy;
  el<HTMLButtonElement>('entry-mode').disabled = busy;
  nameInput.disabled = busy;
  codeInput.disabled = busy;
}
function updateControls(): void {
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  const friends = snapshot?.players.filter(p => p.id !== membership?.playerId && p.connected) ?? [];
  const friend = friends[0];
  const near = !!local && friends.some(other => Math.hypot(local.x - other.x, local.z - other.z) <= 1.5);
  const connected = connection === 'connected';
  playground?.setEnabled(ready && (nearbyActive ? locationActive && discoveryConnected : connected));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.disabled = !connected || !!local?.action || ((button.dataset.action === 'play' || button.dataset.action === 'dap') && !near);
  });
  el<HTMLButtonElement>('meet-button').disabled = !connected || !friend || walking;
  el<HTMLButtonElement>('ready-squad').disabled = !connected || !local || !!snapshot?.quests[local.id]?.squadCircle || (snapshot?.players.filter(player => player.connected).length ?? 0) < 3;
  const raid = snapshot?.raid;
  const connectedPlayers = snapshot?.players.filter(player => player.connected) ?? [];
  const squadComplete = connectedPlayers.length >= 3 && connectedPlayers.every(player => snapshot?.quests[player.id]?.squadCircle);
  el<HTMLButtonElement>('ready-raid').disabled = !connected || !local || !!snapshot?.quests[local.id]?.raidBoss
    || raid?.state === 'active' || raid?.state === 'defeated' || !squadComplete;
  el<HTMLButtonElement>('confirm-dap').disabled = !connected || !friend || !!snapshot?.encounter?.dapConfirmed.includes(membership?.playerId ?? '') || !!snapshot?.encounter?.dapComplete;
  el('scene-hint').textContent = connection === 'offline' ? 'Offline. Leave the playground to connect again.'
    : !connected ? 'Reconnecting. Your pets are waiting for you.'
    : !friend ? 'Touch grass to finish your solo quest, or invite a friend.'
    : near ? 'You’re close! Wave hello or play together.' : 'Tap to move, or meet in the middle.';
}
function setConnection(state: ConnectionState): void {
  connection = state;
  if (state === 'offline' || state === 'reconnecting') stopWalking();
  const labels: Record<ConnectionState, string> = { idle: 'Pet preview', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline' };
  el('connection-status').dataset.state = state;
  el('connection-label').textContent = labels[state];
  el<HTMLButtonElement>('server-settings').disabled = !!membership || nearbyActive || state === 'connecting';
  updateEntry();
  updateControls();
  if (state === 'connected') startWalking();
}
function renderRoster(): void {
  if (!snapshot || !membership) return;
  const key = JSON.stringify(snapshot.players.map(p => [p.id, p.name, p.slot, p.connected]));
  if (key === lastRoster) return;
  lastRoster = key;
  const roster = el('roster');
  roster.replaceChildren();
  for (const player of snapshot.players) {
    const item = document.createElement('div');
    item.className = `player-row slot-${player.slot}`;
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = player.slot === 0 ? 'N' : 'P';
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = `${player.slot === 0 ? 'Nova' : 'Pip'}${player.id === membership.playerId ? ' · your pet' : ''}`;
    const owner = document.createElement('span');
    owner.textContent = player.name;
    text.append(name, owner);
    const status = document.createElement('span');
    status.className = `player-state${player.connected ? ' online' : ''}`;
    status.textContent = player.connected ? 'Here to play' : 'Reconnecting';
    item.append(avatar, text, status);
    roster.append(item);
  }
  if (snapshot.players.length < 4) {
    const empty = document.createElement('div');
    empty.className = 'empty-friend';
    empty.innerHTML = `${icon('people')}<span>${4 - snapshot.players.length} ${4 - snapshot.players.length === 1 ? 'space' : 'spaces'} open in the pen</span>`;
    roster.append(empty);
  }
}
const client = new RoomClient({
  state: setConnection,
  error,
  snapshot(next, member) {
    const entering = !membership;
    membership = member;
    snapshot = next;
    if (entering) {
      stopWalking();
      try { sessionStorage.setItem(resumeKey, JSON.stringify({ ...member, serverUrl })); } catch { /* Reconnect still works without persistent storage. */ }
    }
    el('home-panel').hidden = true;
    el('nearby-panel').hidden = true;
    el('room-panel').hidden = false;
    el('play-controls').hidden = false;
    el('scene-caption').hidden = true;
    el('app').classList.add('in-room');
    el('app').classList.remove('in-nearby');
    el('room-code').textContent = member.roomCode;
    const connectedCount = next.players.filter(p => p.connected).length;
    const localPlayer = next.players.find(player => player.id === member.playerId);
    const nearbyFriend = next.players.find(player => player.id !== member.playerId && player.connected);
    const nearFriend = !!localPlayer && next.players.some(player => player.id !== member.playerId && player.connected && Math.hypot(player.x - localPlayer.x, player.z - localPlayer.z) <= 1.5);
    el('connection-label').textContent = `${connectedCount}/4 here`;
    el<HTMLButtonElement>('server-settings').disabled = true;
    el('room-invite').hidden = !!next.encounter;
    el('dap-quest').hidden = !next.encounter;
    el('invite-note').textContent = next.encounter ? 'You found each other nearby. Make this a real-world hello.' : connectedCount >= 3 ? 'Squad is here! Circle up for your shared quest.' : connectedCount === 2 ? 'Duo quest unlocked. Meet each other in the pen.' : 'Share your room code. Up to four pets can join this pen.';
    if (next.encounter) {
      const confirmed = next.encounter.dapConfirmed.includes(member.playerId);
      el('dap-status').textContent = next.encounter.dapComplete ? 'You both confirmed your hello. One shared moment earned!' : confirmed ? 'You confirmed. Waiting for your friend to confirm too.' : 'Both players confirm after meeting in person.';
      el('confirm-dap').textContent = next.encounter.dapComplete ? 'Hello completed ✓' : confirmed ? 'Waiting for your friend…' : 'We said hello';
    }
    renderRoster();
    const quests = next.quests[member.playerId] ?? { touchGrass: false, meetFriend: false, dapHandshake: false, squadCircle: false, raidBoss: false, photoVerification: {} };
    let done = 0;
    for (const [key, doneId] of [['touchGrass', 'touch-grass'], ['meetFriend', 'meet-friend'], ['dapHandshake', 'dap-handshake'], ['squadCircle', 'squad-circle'], ['raidBoss', 'raid-boss']] as const) {
      const complete = quests[key] && photoQuestComplete(quests, key);
      el(`quest-${doneId}`).classList.toggle('done', complete);
      if (complete) done++;
    }
    el('quest-count').textContent = `${done}/5`;
    const squadUnlocked = connectedCount >= next.squad.minPlayers;
    const squadReady = next.squad.ready.includes(member.playerId);
    el('duo-status').textContent = quests.meetFriend ? 'Completed with a nearby pet.' : connectedCount < 2 ? 'Locked until another user enters the pen.' : 'Bring your pets close together to complete it.';
    const dapOffer = next.dap.pending.find(offer => offer.from === member.playerId || offer.to === member.playerId);
    const dapPartner = dapOffer && next.players.find(player => player.id === (dapOffer.from === member.playerId ? dapOffer.to : dapOffer.from));
    el('dap-handshake-status').textContent = quests.dapHandshake ? 'You and a nearby pet completed your handshake.'
      : !nearbyFriend ? 'Locked until another user enters the pen.'
        : !nearFriend ? 'Bring your pets close together, then tap Dap up.'
          : dapOffer?.from === member.playerId ? `Dap offered to ${dapPartner?.name ?? 'your friend'} — tap Dap up on their phone.`
            : dapOffer?.to === member.playerId ? `${dapPartner?.name ?? 'Your friend'} offered a dap — tap Dap up now!` : 'Both players tap Dap up within a few seconds.';
    el('squad-status').textContent = quests.squadCircle ? 'Your squad circle is complete.' : !squadUnlocked ? 'Locked until three pets are connected in the pen.' : squadReady ? 'You are ready. Waiting for the squad to ready up.' : 'Gather close, then have every squad member ready up.';
    el<HTMLButtonElement>('ready-squad').textContent = quests.squadCircle ? 'Squad circle completed ✓' : squadReady ? 'Ready · waiting for squad…' : 'Ready for squad circle →';
    const photoStatus = quests.photoVerification.touchGrass;
    const photoButton = el<HTMLButtonElement>('verify-touch-grass');
    photoButton.hidden = !quests.touchGrass || photoStatus === 'approved';
    photoButton.disabled = photoVerificationPending || photoStatus === 'pending';
    photoButton.textContent = photoStatus === 'pending' || photoVerificationPending ? 'Checking photo…' : photoStatus === 'rejected' ? 'Try another grass photo →' : 'Verify touch grass photo →';
    el('touch-grass-tag').classList.toggle('verified', photoStatus === 'approved');
    const photoMessage = el('photo-verification-status');
    photoMessage.hidden = !quests.touchGrass || photoStatus === 'approved';
    photoMessage.textContent = photoStatus === 'pending' || photoVerificationPending ? 'Checking your photo…' : photoStatus === 'rejected' ? 'That photo did not clearly show grass. Try another one.' : 'Photo check needed to finish this quest.';
    const allConnectedSquadComplete = connectedCount >= next.raid.minPlayers && next.players.filter(player => player.connected).every(player => next.quests[player.id]?.squadCircle);
    const raid = next.raid;
    const raidReady = raid.ready.includes(member.playerId);
    const raidMeter = el<HTMLMeterElement>('raid-health-meter');
    const raidActive = raid.state === 'active';
    raidMeter.max = Math.max(1, raid.maxHealth);
    raidMeter.value = raidActive ? raid.health : 0;
    el('raid-health-label').textContent = raidActive ? `${raid.health}/${raid.maxHealth} calm points remaining` : raid.state === 'defeated' ? 'Mossback is calm' : 'Mossback is resting';
    el('raid-quest-status').textContent = quests.raidBoss ? 'You calmed Mossback with your squad.'
      : raidActive ? 'Mossback is awake — use any pet action to calm it.'
        : raid.state === 'defeated' ? 'Mossback is already calm in this pen.'
          : !allConnectedSquadComplete ? 'Complete the squad circle with three connected pets first.'
            : raidReady ? 'You are ready. Waiting for the squad to call it.' : 'Gather close, then have every squad member call it.';
    el('raid-description').textContent = raidActive
      ? 'Every pet action soothes the guardian; Play together is especially powerful. Keep all raiders here until it is calm.'
      : 'A gentle guardian’s vine magic has tangled up. A completed squad can gather close and calm it together.';
    el<HTMLButtonElement>('ready-raid').textContent = quests.raidBoss || raid.state === 'defeated' ? 'Mossback calmed ✓'
      : raidActive ? 'Mossback is awake!' : raidReady ? 'Ready · waiting for squad…' : 'Call Mossback →';
    const previousMood = mood;
    for (const key of ['touchGrass', 'meetFriend', 'dapHandshake', 'squadCircle', 'raidBoss', 'dap'] as const) {
      if (key === 'dap' ? next.encounter?.dapComplete : key === 'touchGrass' ? quests.touchGrass && photoQuestComplete(quests, key) : quests[key]) {
        mood = rewardMood(mood, `${member.playerToken}:${key}`);
      }
    }
    if (mood !== previousMood) save('bondimals:mood', JSON.stringify(mood));
    renderMood();
    el('bond-count').textContent = String(next.bond);
    if (next.notice && next.notice !== lastNotice) {
      lastNotice = next.notice;
      el('action-notice').textContent = next.notice;
    }
    playground?.update(next, member.playerId);
    if (entering) startWalking();
    updateControls();
    if (entering) {
      el('error-message').hidden = true;
      canvas.setAttribute('aria-label', 'Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move.');
      if (!next.encounter) el('copy-code').focus();
    }
  },
});

function renderNearby(): void {
  el('nearby-count').textContent = `${nearbyPeers.length} ${nearbyPeers.length === 1 ? 'pet' : 'pets'} nearby`;
  const key = JSON.stringify([nearbyPeers, !!pendingMeet, locationActive, discoveryConnected]);
  if (key === nearbyListKey) return;
  nearbyListKey = key;
  const list = el('nearby-list');
  list.replaceChildren();
  if (!nearbyPeers.length) {
    const empty = document.createElement('div');
    empty.className = 'nearby-empty';
    empty.innerHTML = `${icon('leaf')}<strong></strong><p></p>`;
    empty.querySelector('strong')!.textContent = locationActive ? 'A little space for a new friend.' : 'Your pet is off the nearby map.';
    empty.querySelector('p')!.textContent = locationActive ? 'Nearby players will appear here automatically. Both phones need nearby mode on and a fresh location.' : 'Resume when you’re ready to be discoverable again.';
    list.append(empty);
  }
  for (const pet of nearbyPeers) {
    const button = document.createElement('button');
    button.className = 'nearby-pet';
    button.disabled = !!pendingMeet || !locationActive || !discoveryConnected;
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = pet.name.slice(0, 1).toUpperCase();
    const text = document.createElement('span');
    text.className = 'nearby-pet-text';
    const name = document.createElement('strong');
    name.textContent = `${pet.name}’s pet`;
    const distance = document.createElement('span');
    distance.textContent = `${pet.distanceMeters === 0 ? 'Very close' : `About ${pet.distanceMeters} m away`}${pet.uncertain ? ' · location uncertain' : ' · estimated'}`;
    text.append(name, distance);
    const arrow = document.createElement('span');
    arrow.innerHTML = icon('arrow');
    button.append(avatar, text, arrow);
    button.addEventListener('click', () => requestMeet(pet.id));
    list.append(button);
  }
  playground?.setNearby(nearbyPeers, requestMeet);
  playground?.setEnabled(ready && discoveryConnected && locationActive && !pendingMeet);
}
function requestMeet(peerId: string): void {
  if (!nearbyActive || !locationActive || !discoveryConnected || pendingMeet) return;
  nearbyClient.meet(peerId);
}
function showRequest(request: MeetRequest, incoming: boolean): void {
  if (!nearbyActive) return;
  pendingMeet = { ...request, incoming };
  el('meet-request').hidden = false;
  el('request-title').textContent = incoming ? `${request.name} wants to say hello.` : `A hello for ${request.name}.`;
  el('request-description').textContent = incoming ? 'Meet up, introduce yourselves, and let your pets play.' : 'Waiting for them to accept. This invitation expires shortly.';
  el('accept-meet').hidden = !incoming;
  el('decline-meet').hidden = !incoming;
  el<HTMLButtonElement>('accept-meet').disabled = false;
  el<HTMLButtonElement>('decline-meet').disabled = false;
  renderNearby();
}
function clearRequest(): void { pendingMeet = null; el('meet-request').hidden = true; }
function pauseLocation(): void {
  locationActive = false;
  nearbyClient.pause();
  nearbyPeers = [];
  clearRequest();
  if (!nearbyActive) return;
  el('resume-nearby').hidden = false;
  el('connection-status').dataset.state = 'idle';
  el('connection-label').textContent = 'Nearby paused';
  renderNearby();
}
const nearbyClient = new NearbyClient({
  state(state) {
    discoveryConnected = state === 'connected';
    if (!nearbyActive) return;
    el('connection-status').dataset.state = state === 'connected' && !locationActive ? 'idle' : state;
    el('connection-label').textContent = state === 'connected' ? locationActive ? 'Finding nearby pets' : 'Nearby paused' : state === 'connecting' ? 'Connecting' : state === 'offline' ? 'Offline' : 'Nearby paused';
    if (state === 'offline') {
      locationTracker.stop();
      pauseLocation();
      el('location-status').textContent = 'Connection lost. Resume nearby to reconnect.';
    }
    renderNearby();
  },
  ready() { if (!locationActive) nearbyClient.pause(); renderNearby(); },
  nearby(peers, accuracy, notice) {
    if (!nearbyActive) return;
    nearbyPeers = locationActive ? peers : [];
    el('nearby-accuracy').textContent = accuracy === null ? 'Waiting for a fresh location. Pet placement is illustrative.' : `Location accuracy: ±${Math.ceil(accuracy)} m. Distances are estimates; pet placement is illustrative.`;
    if (locationActive) {
      el('location-status').textContent = notice;
      el('connection-label').textContent = accuracy === null ? 'Getting location' : accuracy > 25 ? 'Location too broad' : 'Nearby is on';
    }
    renderNearby();
  },
  incoming(request) { showRequest(request, true); },
  outgoing(request) { showRequest(request, false); },
  closed(requestId, reason) {
    if (pendingMeet?.requestId !== requestId) return;
    clearRequest();
    toast(reason);
    renderNearby();
  },
  matched(roomCode, playerToken) {
    locationTracker.stop();
    nearbyActive = false;
    locationActive = false;
    nearbyPeers = [];
    clearRequest();
    playground?.setNearby(null);
    playground?.setEnabled(false);
    el('location-status').textContent = 'Opening your shared playground…';
    client.start(serverUrl, { type: 'join', roomCode, playerToken, name: nameInput.value.trim() });
  },
  error(message) { if (nearbyActive) { el('location-status').textContent = message; toast(message); } },
});
const locationCallbacks = {
  fix(fix: LocationFix) { void weather.update(fix); if (nearbyActive && locationActive) nearbyClient.location(fix); },
  status(message: string) { if (nearbyActive) el('location-status').textContent = message; },
  unavailable(message: string) { pauseLocation(); if (nearbyActive) el('location-status').textContent = message; },
  paused() { pauseLocation(); if (nearbyActive) el('location-status').textContent = 'Location paused while you were away. Tap Resume nearby.'; },
};
const locationTracker = import.meta.env.DEV && params.get('demo') === 'nearby'
  ? new DevelopmentLocation(locationCallbacks, params.get('player') === '2')
  : isNativePhone() ? new NativeLocation(locationCallbacks) : new LocationDiscovery(locationCallbacks);
function startNearby(): void {
  autoNearby = true; save('bondimals:auto-nearby', 'on');
  stopWalking();
  serverUrl = normalizeServerUrl(serverUrl);
  nearbyActive = true;
  locationActive = true;
  nearbyPeers = [];
  nearbyListKey = '';
  clearRequest();
  el('home-panel').hidden = true;
  el('nearby-panel').hidden = false;
  el('room-panel').hidden = true;
  el('resume-nearby').hidden = true;
  el('error-message').hidden = true;
  el('app').classList.add('in-nearby');
  el('scene-caption').textContent = 'Nearby pets · an illustrative view';
  canvas.setAttribute('aria-label', 'Nearby pets. Tap a pet to invite its owner to meet, or use the nearby pet list. Pet placement is illustrative.');
  el<HTMLButtonElement>('server-settings').disabled = true;
  nearbyClient.start(serverUrl, nameInput.value.trim());
  // iOS/browser still owns the permission prompt; discovery is on by default.
  if (locationActive) locationTracker.start();
  startWalking();
  renderNearby();
}
function stopNearby(): void {
  nearbyActive = false;
  locationActive = false;
  locationTracker.stop();
  nearbyClient.stop();
  nearbyPeers = [];
  clearRequest();
  playground?.setNearby(null);
  playground?.update(null, null);
  playground?.setEnabled(false);
  el('nearby-panel').hidden = true;
  el('home-panel').hidden = false;
  el('app').classList.remove('in-nearby');
  el('scene-caption').textContent = 'Small paws. Big adventures.';
  canvas.setAttribute('aria-label', 'Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move.');
  setConnection('idle');
}

el('entry-mode').addEventListener('click', () => { mode = mode === 'nearby' ? 'join' : 'nearby'; updateEntry(); });
el('stop-nearby').addEventListener('click', () => { autoNearby = false; save('bondimals:auto-nearby', 'off'); stopNearby(); });
el('resume-nearby').addEventListener('click', () => {
  // A pause removes server presence too. Re-register before publishing a new fix.
  startNearby();
});
el('accept-meet').addEventListener('click', () => {
  if (pendingMeet?.incoming) { nearbyClient.respond(pendingMeet.requestId, true); el<HTMLButtonElement>('accept-meet').disabled = true; el<HTMLButtonElement>('decline-meet').disabled = true; }
});
el('decline-meet').addEventListener('click', () => { if (pendingMeet?.incoming) nearbyClient.respond(pendingMeet.requestId, false); });
el('confirm-dap').addEventListener('click', () => { client.confirmDap(); });

el('create-tab').addEventListener('click', () => { mode = 'create'; updateEntry(); });
el('join-tab').addEventListener('click', () => { mode = 'join'; updateEntry(); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
el('entry-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!ready || connection === 'connecting') return;
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  save('bondimals:name', name);
  clearResume();
  el('error-message').hidden = true;
  try {
    serverUrl = normalizeServerUrl(serverUrl);
    if (mode === 'nearby') startNearby();
    else client.start(serverUrl, mode === 'create' ? { type: 'create', name } : { type: 'join', name, roomCode: codeInput.value.trim().toUpperCase() });
  } catch (cause) { error(cause instanceof Error ? cause.message : 'Check the multiplayer server address.'); }
});
el('leave-button').addEventListener('click', () => {
  stopWalking();
  clearResume();
  membership = null;
  snapshot = null;
  lastRoster = '';
  lastNotice = '';
  client.stop();
  playground?.update(null, null);
  el('home-panel').hidden = false;
  el('room-panel').hidden = true;
  el('play-controls').hidden = true;
  el('scene-caption').hidden = false;
  el('error-message').hidden = true;
  el('app').classList.remove('in-room');
  mode = 'nearby';
  el('scene-caption').textContent = 'Small paws. Big adventures.';
  updateEntry();
  resumeAutomaticNearby();
  startWalking();
});
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    el('error-message').hidden = true;
    client.action(button.dataset.action as PetActionKind);
  });
});
el('meet-button').addEventListener('click', () => {
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  if (local) client.move(local.slot === 0 ? -0.5 : 0.5, 0);
});
el('ready-squad').addEventListener('click', () => { client.readySquadQuest(); });
el('ready-raid').addEventListener('click', () => { client.readyRaid(); });
const touchGrassPhotoInput = el<HTMLInputElement>('touch-grass-photo');
el('verify-touch-grass').addEventListener('click', () => { touchGrassPhotoInput.click(); });
touchGrassPhotoInput.addEventListener('change', () => {
  const file = (touchGrassPhotoInput.files ?? [])[0];
  touchGrassPhotoInput.value = '';
  if (!file || !membership || !snapshot) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
    toast('Choose a JPEG, PNG, or WebP photo smaller than 4 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => toast('That photo could not be read. Please try another one.');
  reader.onload = () => {
    if (typeof reader.result !== 'string' || !membership || !snapshot) return;
    photoVerificationPending = true;
    updateControls();
    void fetch(verificationEndpoint(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode: membership.roomCode, playerToken: membership.playerToken, questId: 'touchGrass', photoDataUrl: reader.result }),
    }).then(async response => {
      const result = await response.json().catch(() => ({})) as { verified?: boolean; reason?: string; error?: string };
      if (!response.ok) throw new Error(result.error || 'Photo verification is unavailable.');
      toast(result.verified ? 'Photo verified — touch grass is complete!' : result.reason || 'That photo did not clearly show grass. Try another one.');
    }).catch(cause => toast(cause instanceof Error ? cause.message : 'Photo verification is unavailable.'))
      .finally(() => { photoVerificationPending = false; updateControls(); });
  };
  reader.readAsDataURL(file);
});
canvas.addEventListener('keydown', event => {
  const direction: Record<string, [number, number]> = { ArrowUp: [0, -0.5], ArrowDown: [0, 0.5], ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0] };
  const delta = direction[event.key];
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  if (delta && local && connection === 'connected' && !walking) {
    event.preventDefault();
    client.move(Math.max(-3, Math.min(3, local.targetX + delta[0])), Math.max(-3, Math.min(3, local.targetZ + delta[1])));
  }
});

async function copy(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
  else {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Copy is unavailable here. Share the room code shown on screen.');
  }
}
el('copy-code').addEventListener('click', () => {
  if (membership) void copy(membership.roomCode).then(() => toast('Room code copied. Send it to your friend.')).catch(cause => toast(String(cause.message)));
});
el('invite-button').addEventListener('click', () => {
  if (!membership) return;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', membership.roomCode);
  url.searchParams.set('server', serverUrl);
  const share = { title: 'Come play in my Bondimals world', text: `Bring your pet! Room ${membership.roomCode}`, url: url.href };
  if (navigator.share) void navigator.share(share).catch(cause => { if (cause.name !== 'AbortError') toast('Share the room code shown on screen.'); });
  else void copy(url.href).then(() => toast('Invite link copied. Send it to your friend.')).catch(cause => toast(String(cause.message)));
});
const settings = el<HTMLDialogElement>('settings-dialog');
el('server-settings').addEventListener('click', () => {
  el<HTMLInputElement>('server-url').value = serverUrl;
  el('settings-error').hidden = true;
  settings.showModal();
});
el('close-settings').addEventListener('click', () => settings.close());
el('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    serverUrl = normalizeServerUrl(el<HTMLInputElement>('server-url').value);
    save('bondimals:server', serverUrl);
    updateEntry();
    settings.close();
    el('error-message').hidden = true;
    toast('Server saved.');
    resumeAutomaticNearby();
  } catch (cause) {
    el('settings-error').textContent = cause instanceof Error ? cause.message : 'Check the server URL.';
    el('settings-error').hidden = false;
  }
});
window.addEventListener('pagehide', () => { locationTracker.stop(); nearbyClient.stop(); client.stop(false); });
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

updateEntry();
try {
  playground = new Playground(canvas, (x, z) => {
    if (walking) return;
    el('error-message').hidden = true;
    client.move(x, z);
  });
  await playground.load();
  ready = true;
  playground.update(null, null);
  playground.setEnabled(false);
  el('scene-loading').hidden = true;
  updateEntry();
  const saved = readResume();
  if (saved && (!params.has('room') || params.get('room')?.toUpperCase() === saved.roomCode)) {
    try {
      serverUrl = normalizeServerUrl(saved.serverUrl);
      client.start(serverUrl, { type: 'join', name: saved.name, roomCode: saved.roomCode, playerToken: saved.playerToken });
    } catch (cause) { error(cause instanceof Error ? cause.message : 'Check your saved server address.', true); }
  }
} catch (cause) {
  console.error('Playground could not load:', cause);
  el('scene-loading').textContent = 'Your world couldn’t load. Refresh to try again.';
  el('enter-label').textContent = 'Pet unavailable';
  error('We couldn’t load the 3D playground. Check your connection and WebGL support, then refresh.');
}

function stopWalking(): void {
  if (!walking) return;
  walking = false;
  nativeCommand('stopLocation', { purpose: 'walking' });
  playground?.setWalkingPose(null);
  el('walking-status').textContent = 'Walking pauses while you’re away and resumes when you return.';
  el('compass-reading').textContent = 'Compass off';
  updateControls();
}
function startWalking(): void {
  if (!isNativePhone() || !ready || walking || document.hidden) return;
  walking = true;
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  walkingTracker.reset(local?.x ?? 0, local?.z ?? 0);
  el('walking-status').textContent = 'Aligning your pet with your phone…';
  el('compass-reading').textContent = 'Reading your starting direction…';
  publishWalking();
  updateControls();
  nativeCommand('startLocation', { purpose: 'walking' });
}
function publishWalking(moved = false, initialHeading = false): void {
  if (!walking || !walkingTracker.hasHeading) return;
  playground?.setWalkingPose(walkingTracker.pose, initialHeading);
  if (membership && connection === 'connected') {
    if (moved) client.move(walkingTracker.pose.x, walkingTracker.pose.z);
    client.heading(walkingTracker.pose.yaw);
  }
}
if (isNativePhone()) {
  el('native-tools').hidden = false;
  el('quest-tools').hidden = false;
  for (const [id, command] of [['record-clip', 'recordClip'], ['review-clip', 'reviewClip'], ['delete-clip', 'deleteClip']] as const) {
    el(id).addEventListener('click', () => nativeCommand(command));
  }
  onNativeEvent(event => {
    if (event.type === 'active') { resumeAutomaticNearby(); startWalking(); }
    const weatherFix = nativeFix(event);
    if (weatherFix) void weather.update(weatherFix);
    if (event.type === 'recording') el('recording-status').textContent = event.message ?? '';
    if (event.type === 'paused' || event.type === 'unavailable') {
      stopWalking();
      if (event.message) el('walking-status').textContent = event.message;
    }
    if (!walking) return;
    if (event.type === 'status') el('walking-status').textContent = event.message ?? '';
    if (event.type === 'heading') {
      const initialHeading = !walkingTracker.hasHeading;
      if (walkingTracker.heading(event.degrees ?? -1, event.accuracy ?? -1)) {
        el('compass-reading').textContent = `Facing ${Math.round(event.degrees!)}° ${event.reference === 'true' ? 'true' : 'magnetic'}`;
        publishWalking(false, initialHeading);
      } else el('compass-reading').textContent = 'Compass uncertain · move away from metal';
    }
    const fix = nativeFix(event);
    if (fix) {
      const result = walkingTracker.location(fix);
      el('walking-status').textContent = result.message;
      publishWalking(result.moved);
    }
  });
  nativeCommand('ready', { sceneReady: ready });
}

resumeAutomaticNearby();
startWalking();
