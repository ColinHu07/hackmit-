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
import { isNativePhone, prepareNativeClip, nativeCommand, nativeFix, NativeLocation, onNativeEvent } from './NativePhone';
import { WalkingTracker, headingToYaw } from './WalkingTracker';
import { BrowserCompass } from './BrowserCompass';
import { BrowserWalking } from './BrowserWalking';
import { StepDetector } from './StepDetector';
import { createInviteUrl, defaultPlayServerUrl, nativeServerSelection } from './WebConnection';
import type { LocationFix } from './LocationDiscovery';
import type { NearbyPet, MeetRequest } from '../../shared/nearby-protocol';
import type { ConnectionState, Membership, CompatibleSnapshot } from './RoomClient';
import type { EvidenceQuestId, PetActionKind, PlayerQuests } from '../../shared/play-protocol';

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
        <h1 id="home-title">Your next friend.<br><em>A few steps away.</em></h1>
        <p class="intro" id="home-intro">Discover nearby pets. Say hello in person.<br>Let your little worlds meet.</p>
        <form id="entry-form" class="entry-card">
          <div id="manual-modes" class="entry-tabs" role="tablist" aria-label="How to join" hidden><button type="button" role="tab" aria-selected="true" id="create-tab">Start a playground</button><button type="button" role="tab" aria-selected="false" id="join-tab">Join a friend</button></div>
          <label for="player-name">Your name</label><input id="player-name" name="name" autocomplete="given-name" maxlength="24" placeholder="What should we call you?" required />
          <div id="location-explainer" class="location-explainer"><span class="range-chip">ABOUT 10 METERS</span><p>Find people who are also playing nearby. Nearby discovery starts automatically and can be paused. Your location is shared with the game server while it is active. Rounded coordinates are used for local weather. Other players see your pet and an approximate distance.</p><span id="location-host"></span></div>
          <div id="room-input-wrap" hidden><label for="room-input">Your friend's room code</label><input id="room-input" name="room" maxlength="6" minlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" pattern="[A-Za-z0-9]{6}" /></div>
          <button class="primary-button" id="enter-button" type="submit" disabled><span id="enter-label">Loading your pet…</span>${icon('arrow')}</button>
          <p class="form-note" id="entry-note">${icon('people')} Turn a nearby pet into a real hello.</p>
          <button type="button" id="entry-mode" class="entry-mode">Private room options</button>
          <button type="button" id="nearby-mode" class="entry-mode">Find nearby pets with location</button>
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
        <p class="nearby-accuracy">Discovery shares your location with the game server while this app is open. Local weather uses rounded coordinates.</p><button id="start-squad-room" class="text-button">Start a squad quest room →</button><button id="join-nearby-room" class="text-button">Join a friend’s room →</button><button id="stop-nearby" class="leave-button">Stop nearby discovery</button>
      </div>
      <div id="room-panel" hidden>
        <div class="eyebrow"><span class="sun-dot"></span> YOUR SHARED PLAYGROUND</div>
        <h1>A very good<br><em>place to meet.</em></h1>
        <div class="invite-card" id="room-invite"><div><span class="small-label">ROOM CODE</span><button id="copy-code" class="room-code" title="Copy room code"><span id="room-code">------</span>${icon('copy')}</button></div><button id="invite-button" class="share-button" title="Share a link to this room">${icon('link')} Invite friends</button></div>
        <p id="invite-note" class="room-description">Share your room code. Your friend's pet will appear here.</p>
        <div class="roster" id="roster" aria-label="Players"></div>
        <div id="dap-quest" class="quest-card dap-card" hidden><div class="quest-header"><span class="quest-symbol">${icon('wave')}</span><div><span class="small-label">MEET IN REAL LIFE</span><h2>Dap them up</h2></div></div><p>Walk over, introduce yourselves, and share a dap, high-five, or wave.</p><button class="primary-button" id="confirm-dap">We said hello ${icon('check')}</button><p id="dap-status" role="status">Both players confirm after meeting in person.</p></div>
        <p id="server-compatibility" class="room-description" role="status" hidden>This server runs an older game version. You can meet, move, wave, feed, jump, and play together. New quests and sharing compass turns need a server update.</p><button id="meet-button" class="text-button" disabled>Meet in the middle ${icon('arrow')}</button><div class="quest-card" id="modern-quests">
          <div class="quest-header"><span class="quest-symbol">${icon('play')}</span><div><span class="small-label">YOUR QUEST BOARD</span><h2>Grow your little world</h2></div><span class="quest-count" id="quest-count">0/5</span></div>
          <ol class="quest-list"><li id="quest-touch-grass"><span class="quest-tick">${icon('check')}</span><span><strong>Solo · touch grass <em class="verification-tag" id="touch-grass-tag">PHOTO CHECK</em></strong><small>Walk your pet one world-unit, then show your hand touching grass to finish it.</small></span></li><li id="quest-meet-friend"><span class="quest-tick">${icon('check')}</span><span><strong>Duo · meet another user</strong><small id="duo-status">Bring a second pet into the pen, then meet nearby.</small></span></li><li id="quest-dap-handshake"><span class="quest-tick">${icon('check')}</span><span><strong>Duo · dap up</strong><small id="dap-handshake-status">Stand close to a pet and both tap Dap up within a few seconds.</small></span></li><li id="quest-squad-circle"><span class="quest-tick">${icon('check')}</span><span><strong>Squad · circle up</strong><small id="squad-status">Needs three connected pets in the pen.</small></span></li><li id="quest-raid-boss"><span class="quest-tick">${icon('check')}</span><span><strong>Raid · calm Mossback</strong><small id="raid-quest-status">Complete the squad circle to call the meadow’s tangled guardian.</small></span></li></ol>
          <button id="ready-squad" class="text-button" disabled>Ready for squad circle ${icon('arrow')}</button><button id="verify-touch-grass" class="text-button" hidden>Verify touch grass photo ${icon('arrow')}</button><input id="touch-grass-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden /><p id="photo-verification-status" class="photo-verification-status" role="status" hidden></p>
        </div>
        <div class="quest-card raid-card" id="raid-card"><div class="quest-header"><span class="quest-symbol">✦</span><div><span class="small-label">SQUAD RAID · 3–4 PETS</span><h2>Mossback, Keeper of the Pen</h2></div></div><p id="raid-description">A gentle guardian’s vine magic has tangled up. Gather a completed squad close together, then calm it with your pets’ actions.</p><div class="raid-health"><span id="raid-health-label">Mossback is resting</span><meter id="raid-health-meter" min="0" max="1" value="0"></meter></div><button id="ready-raid" class="primary-button" disabled>Call Mossback ${icon('arrow')}</button></div>
        <button id="leave-button" class="leave-button">Leave playground</button>
      </div>
      <div id="error-message" class="error-message" role="alert" hidden></div>
      <details id="server-pulse" class="server-pulse" hidden><summary>Multiplayer server</summary><p id="server-pulse-status">Checking server…</p><p>Up to 4 players per room. Start more rooms to test a larger group.</p></details>
    </section>
    <section class="playground-panel" aria-label="Your local world">
      <div class="scene-topline"><div class="scene-title">${icon('leaf')} <span id="world-title">AROUND YOU</span></div><div id="connection-status" class="connection-status" data-state="idle"><span></span><span id="connection-label">Pet preview</span></div></div>
      <div class="weather-line"><span id="weather-status" role="status">Allow location for your local weather</span><button id="local-weather" class="text-button" hidden title="Uses your location once; sends rounded coordinates to Open-Meteo for weather">Use my local weather</button></div><div class="scene" id="scene"><canvas id="playground" tabindex="0" aria-label="Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move."></canvas><aside class="status-effects" aria-label="Pet status effects"><span class="status-effects-title">PET STATUS</span><div class="status-effect"><span class="status-effect-icon">${icon('heart')}</span><span><strong>Happiness</strong><small id="effect-mood">70% · Content</small></span></div><div class="status-effect"><span class="status-effect-icon">${icon('leaf')}</span><span><strong>Local sky</strong><small id="effect-weather">Weather unavailable</small></span></div><div class="status-effect" id="effect-bond-row" hidden><span class="status-effect-icon">${icon('people')}</span><span><strong>Bond</strong><small id="effect-bond">0 shared moments</small></span></div></aside><div id="scene-loading" class="scene-loading"><span class="loading-dot"></span>Waking up Nova…</div></div>
      <div class="mood-card"><div><strong>Your pet’s happiness</strong><span id="mood-label"></span></div><meter id="mood-meter" min="0" max="100" value="70" aria-label="Pet happiness"></meter><p id="mood-note">Complete a quest together for +12 happiness. Slowly drifts down between adventures.</p></div>
      <div class="survival-card" id="survival-card"><div><strong>Pet care</strong><span id="survival-points">0 points</span></div><p id="survival-stats">Connect to the server to load your pet’s health.</p><p id="food-inventory">Food: loading…</p></div>
      <div class="scene-caption" id="scene-caption"><span class="caption-star">✳</span> Small paws. Big adventures.</div>
      <div class="play-controls" id="play-controls" hidden>
        <div class="moment-line"><span id="scene-hint">Tap the ground to move your pet.</span><span class="bond-counter">${icon('heart')}<span id="bond-count">0</span><span class="bond-word">moments</span></span></div>
        <div class="action-bar action-bar-five"><button data-action="wave">${icon('wave')}<span>Wave</span></button><button data-action="dap" class="co-op-action">${icon('wave')}<span>Dap up</span></button><button data-action="feed">${icon('treat')}<span>Treat</span></button><button data-action="jump">${icon('jump')}<span>Jump</span></button><button data-action="play" class="co-op-action">${icon('play')}<span>Play together</span></button></div>
        <p class="action-notice" id="action-notice" role="status" aria-live="polite">Your little adventure starts here.</p>
      </div>
      <div id="native-tools" class="native-tools" hidden>
        <div class="native-walking-heading"><strong id="view-title">Walk with your pet</strong><span id="compass-reading">Compass off</span></div>
        <p id="walking-status" role="status">Your pet follows your steps and the direction you face automatically.</p>
      </div>
      <div id="browser-view-tools" class="native-tools" hidden><div class="native-walking-heading"><strong>Your pet’s view</strong><span id="browser-compass-status">Facing forward</span></div><p>Your pet stays in the middle, facing the top of the screen. Tap the ground or use arrow keys to move. On a phone, enable walking to move with your steps, and the compass to turn together. Hold the phone facing the way you walk.</p><p id="browser-walking-status" role="status">Walking is off · tap to move, or enable walking on your phone.</p><div class="native-buttons"><button id="enable-compass">Enable phone compass</button><button id="enable-walking">Enable walking</button></div></div>
      <section id="quest-tools" class="native-tools quest-tools" aria-label="Quest clips" hidden>
        <div class="native-walking-heading"><strong>Quest clips</strong></div>
        <p>Complete the in-game step, then capture the real-world action.</p>
        <label for="evidence-quest">Quest to verify</label><select id="evidence-quest"><option value="touchGrass">Solo · touch grass</option><option value="meetFriend">Duo · say hello</option><option value="dapHandshake">Duo · handshake / dap</option><option value="squadCircle">Squad · circle and cheer</option></select>
        <p id="evidence-instructions">Show your hand touching natural grass outdoors.</p>
        <div class="native-buttons"><button id="record-clip">Record quest clip</button><button id="review-clip">Review clip</button><button id="delete-clip">Delete clip</button></div>
        <p id="recording-status" role="status">Record 1–10 seconds and review your clip before sending.</p>
        <label class="evidence-consent"><input id="evidence-consent" type="checkbox" /> Everyone shown agrees to send this evidence to Meta for this quest check.</label>
        <div class="native-buttons"><button id="submit-clip">Submit clip to Meta</button><button id="submit-photo">Choose photo to submit</button></div>
        <p id="evidence-status" role="status">Clips send 12 sampled frames; audio stays on your phone. No upload happens until you submit.</p>
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
const devServer = isNativePhone() ? 'ws://127.0.0.1:8788/play' : defaultPlayServerUrl(location.href);
const nativeSelection = nativeServerSelection(window.bondimalsNative?.serverURL, stored('bondimals:applied-native-server'), stored('bondimals:server'));
if (nativeSelection.changed) {
  save('bondimals:applied-native-server', window.bondimalsNative!.serverURL);
  save('bondimals:server', nativeSelection.url!);
  clearResume();
}
let serverUrl = params.get('server') || nativeSelection.url || import.meta.env.VITE_PLAY_SERVER_URL || devServer;
let mode: 'lobby' | 'nearby' | 'create' | 'join' = params.has('room') ? 'join' : 'lobby';
let lobbyPaused = false;
let walking = false;
const walkingTracker = new WalkingTracker();
const stepDetector = new StepDetector();
let stepSensorAvailable = false;
let browserWalkingEnabled = false;
let walkingSteps = 0;
let ready = false;
let connection: ConnectionState = 'idle';
let membership: Membership | null = null;
let snapshot: CompatibleSnapshot | null = null;
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
  el('effect-mood').textContent = el('mood-label').textContent;
}
renderMood();
setInterval(renderMood, 60_000);
const serverPulse = el<HTMLDetailsElement>('server-pulse');
serverPulse.hidden = isNativePhone();
let checkingServer = false;
async function refreshServerPulse(): Promise<void> {
  if (serverPulse.hidden || !serverPulse.open || document.hidden || checkingServer) return;
  checkingServer = true;
  const currentServer = serverUrl;
  try {
    const url = new URL('/health', serverUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    if (url.origin !== location.origin) {
      el('server-pulse-status').textContent = `Server: ${url.host}. ${snapshot?.players.filter(player => player.connected).length ?? 0} players in your room.`;
      return;
    }
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Server unavailable');
    const health = await response.json() as { ok?: boolean; players?: number; activeRooms?: number };
    if (!health.ok) throw new Error('Server unavailable');
    if (currentServer !== serverUrl) return;
    el('server-pulse-status').textContent = Number.isInteger(health.players) && Number.isInteger(health.activeRooms)
      ? `${health.players} players connected across ${health.activeRooms} active ${health.activeRooms === 1 ? 'room' : 'rooms'} · updates every 5 seconds`
      : 'Server online. This server version does not report player counts.';
  } catch {
    if (currentServer === serverUrl) el('server-pulse-status').textContent = 'Server status unavailable. Check the connection indicator above your pet.';
  } finally { checkingServer = false; }
}
serverPulse.addEventListener('toggle', () => { if (serverPulse.open) void refreshServerPulse(); });
setInterval(() => { void refreshServerPulse(); }, 5000);
const weather = new LocalWeather(value => {
  el('weather-status').textContent = value.label;
  el('effect-weather').textContent = value.label;
  document.querySelector<HTMLElement>('.playground-panel')!.dataset.weather = value.kind;
  playground?.setWeather(value.kind);
  el('local-weather').hidden = isNativePhone() || value.kind !== 'unknown';
});
let autoNearby = stored('bondimals:auto-nearby') !== 'off';
function lobbyTokenKey(): string { return `bondimals:lobby-token:${normalizeServerUrl(serverUrl)}`; }
function joinSharedPlayground(): void {
  if (!ready || document.hidden || lobbyPaused || membership || connection === 'connecting' || connection === 'reconnecting') return;
  stopNearby();
  clearResume();
  const name = nameInput.value.trim() || 'Explorer';
  save('bondimals:name', name);
  const token = stored(lobbyTokenKey());
  el('error-message').hidden = true;
  client.start(serverUrl, { type: 'lobby', name, ...(/^[a-f0-9]{48}$/.test(token ?? '') ? { playerToken: token! } : {}) });
}
function resumeAutomaticNearby(): void {
  renderMood();
  if (mode === 'lobby') {
    try { joinSharedPlayground(); } catch (cause) { error(cause instanceof Error ? cause.message : 'Check your server settings.'); }
    return;
  }
  if (!isNativePhone()) return;
  if (!ready || !autoNearby || membership || connection === 'connecting' || connection === 'reconnecting' || mode !== 'nearby' || document.hidden || (nearbyActive && locationActive)) return;
  try { startNearby(); } catch (cause) { error(cause instanceof Error ? cause.message : 'Check your server settings.'); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { resumeAutomaticNearby(); startWalking(); } else stopWalking(); });

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
function photoQuestComplete(quests: Pick<PlayerQuests, 'photoVerification'>, key: EvidenceQuestId | 'raidBoss'): boolean {
  return key === 'raidBoss' || quests.photoVerification[key] === 'approved';
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
  el('manual-modes').hidden = mode === 'nearby' || mode === 'lobby';
  el('location-explainer').hidden = mode !== 'nearby';
  el('entry-mode').textContent = mode === 'lobby' || mode === 'nearby' ? 'Private room options' : 'Back to shared playground';
  try { el('location-host').textContent = `Game server: ${new URL(serverUrl).host}`; } catch { el('location-host').textContent = 'Set your game server in Server settings.'; }
  el('entry-note').textContent = mode === 'nearby' ? 'Turn a nearby pet into a real hello.' : 'Up to 4 players · no download or location needed';
  {
    el('home-title').innerHTML = mode === 'nearby' ? 'Your next friend.<br><em>A few steps away.</em>' : 'Little pets.<br><em>Better together.</em>';
    el('home-intro').textContent = mode === 'nearby' ? 'Discover nearby pets and say hello in person.' : mode === 'join' ? 'Your friends are waiting. Pick a name and join their playground.' : 'Open a playground, send your friends the link, and let your pets meet. Play right here in your browser.';
    if (!isNativePhone()) el('location-explainer').querySelector('p')!.textContent = 'Tap Find nearby pets to share your location with the game server while discovery is active. Rounded coordinates are used for weather. Other players see your pet and an approximate distance.';
  }
  el('room-input-wrap').hidden = mode !== 'join';
  codeInput.required = mode === 'join';
  el('create-tab').setAttribute('aria-selected', String(mode === 'create'));
  el('join-tab').setAttribute('aria-selected', String(mode === 'join'));
  el('enter-label').textContent = !ready ? 'Loading your pet…' : busy ? 'Opening your playground…' : mode === 'nearby' ? 'Find nearby pets' : mode === 'create' ? 'Let’s play together' : 'Join the playground';
  el<HTMLButtonElement>('enter-button').disabled = !ready || busy;
  el<HTMLButtonElement>('create-tab').disabled = busy;
  el<HTMLButtonElement>('join-tab').disabled = busy;
  el<HTMLButtonElement>('entry-mode').disabled = busy;
  el<HTMLButtonElement>('nearby-mode').disabled = busy;
  if (mode === 'lobby') {
    el('home-title').innerHTML = 'Little pets.<br><em>Better together.</em>';
    el('home-intro').textContent = 'Use the same server on both phones. Your pets appear together automatically.';
    el('entry-note').textContent = 'One shared playground · up to 4 players · no room code needed';
    el('enter-label').textContent = !ready ? 'Loading your pet…' : busy ? 'Connecting to your server…' : 'Connect to shared playground';
  }
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
  el<HTMLButtonElement>('meet-button').disabled = !connected || !friend;
  el<HTMLButtonElement>('ready-squad').disabled = !connected || !local || (snapshot?.players.filter(p => p.connected).every(p => snapshot?.quests[p.id]?.squadCircle) ?? false) || (snapshot?.players.filter(player => player.connected).length ?? 0) < 3;
  const raid = snapshot?.raid;
  const connectedPlayers = snapshot?.players.filter(player => player.connected) ?? [];
  const squadComplete = connectedPlayers.length >= 3 && connectedPlayers.every(player => snapshot?.quests[player.id]?.squadCircle);
  el<HTMLButtonElement>('ready-raid').disabled = !connected || !local || !!snapshot?.quests[local.id]?.raidBoss
    || raid?.state === 'active' || raid?.state === 'defeated' || !squadComplete;
  el<HTMLButtonElement>('confirm-dap').disabled = !connected || !friend || !!snapshot?.encounter?.dapConfirmed.includes(membership?.playerId ?? '') || !!snapshot?.encounter?.dapComplete;
  el('scene-hint').textContent = connection === 'offline' ? 'Offline. Leave the playground to connect again.'
    : !connected ? 'Reconnecting. Your pets are waiting for you.'
    : !friend ? snapshot?.publicLobby ? 'Your friend appears automatically when they open the app on this server.' : snapshot?.legacyServer ? 'Invite a friend using this room code.' : 'Touch grass to finish your solo quest, or invite a friend.'
    : near ? 'You’re close! Wave hello or play together.' : 'Tap to move, or meet in the middle.';
}
function setConnection(state: ConnectionState): void {
  connection = state;
  const labels: Record<ConnectionState, string> = { idle: 'Pet preview', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline' };
  el('connection-status').dataset.state = state;
  el('connection-label').textContent = labels[state];
  el<HTMLButtonElement>('server-settings').disabled = false;
  updateEntry();
  updateControls();
  // Local sensors and the preview keep working even when a server rejects a
  // join or disconnects. Only visibility/permission/user actions pause walking.
  startWalking();
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
  if (!snapshot.legacyServer && snapshot.players.length < 4) {
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
    const entering = membership?.playerId !== member.playerId;
    membership = member;
    snapshot = next;
    el('server-compatibility').hidden = !next.legacyServer;
    for (const id of ['modern-quests', 'raid-card', 'quest-tools']) el(id).hidden = !!next.legacyServer;
    document.querySelector<HTMLButtonElement>('[data-action="dap"]')!.hidden = !!next.legacyServer;
    if (entering) {
      stopWalking();
      if (next.publicLobby) save(lobbyTokenKey(), member.playerToken);
      else try { sessionStorage.setItem(resumeKey, JSON.stringify({ ...member, serverUrl })); } catch { /* Reconnect still works without persistent storage. */ }
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
    el('connection-label').textContent = next.legacyServer ? `${connectedCount} here` : `${connectedCount}/${next.encounter ? 2 : 4} here`;
    el<HTMLButtonElement>('server-settings').disabled = false;
    el('room-invite').hidden = !!next.encounter || !!next.publicLobby;
    el('dap-quest').hidden = !next.encounter;
    el('invite-note').textContent = next.encounter ? 'You found each other nearby. Make this a real-world hello.' : connectedCount >= 3 ? 'Squad is here! Circle up for your shared quest.' : connectedCount === 2 ? 'Duo quest unlocked. Meet each other in the pen.' : 'Only players using this room code appear here. Friends in nearby discovery must join this room, or you can leave and find them in nearby mode.';
    if (next.publicLobby) el('invite-note').textContent = `Shared server: ${new URL(serverUrl).host}. Friends appear automatically when they open the app using this server.`;
    if (next.encounter) {
      const confirmed = next.encounter.dapConfirmed.includes(member.playerId);
      el('dap-status').textContent = next.encounter.dapComplete ? 'You both confirmed your hello. One shared moment earned!' : confirmed ? 'You confirmed. Waiting for your friend to confirm too.' : 'Both players confirm after meeting in person.';
      el('confirm-dap').textContent = next.encounter.dapComplete ? 'Hello completed ✓' : confirmed ? 'Waiting for your friend…' : 'We said hello';
    }
    renderRoster();
    const quests = next.quests[member.playerId] ?? { touchGrass: false, meetFriend: false, dapHandshake: false, dapHandshakeReady: false, squadCircle: false, raidBoss: false, photoVerification: {} };
    let done = 0;
    for (const [key, doneId] of [['touchGrass', 'touch-grass'], ['meetFriend', 'meet-friend'], ['dapHandshake', 'dap-handshake'], ['squadCircle', 'squad-circle'], ['raidBoss', 'raid-boss']] as const) {
      const complete = quests[key] && photoQuestComplete(quests, key);
      el(`quest-${doneId}`).classList.toggle('done', complete);
      if (complete) done++;
    }
    el('quest-count').textContent = `${done}/5`;
    const squadUnlocked = connectedCount >= next.squad.minPlayers;
    const squadReady = next.squad.ready.includes(member.playerId);
    el('duo-status').textContent = quests.meetFriend ? photoQuestComplete(quests, 'meetFriend') ? 'Your real hello was verified.' : 'Pets met. Submit a photo or clip of your real hello.' : connectedCount < 2 ? 'Locked until another user enters the pen.' : 'Bring your pets close together to complete it.';
    const dapOffer = next.dap.pending.find(offer => offer.from === member.playerId || offer.to === member.playerId);
    const dapPartner = dapOffer && next.players.find(player => player.id === (dapOffer.from === member.playerId ? dapOffer.to : dapOffer.from));
    el('dap-handshake-status').textContent = quests.dapHandshakeReady ? photoQuestComplete(quests, 'dapHandshake') ? 'Your handshake was verified.' : 'Pets dapped. Record the real handshake and submit the clip.'
      : !nearbyFriend ? 'Locked until another user enters the pen.'
        : !nearFriend ? 'Bring your pets close together, then tap Dap up.'
          : dapOffer?.from === member.playerId ? `Dap offered to ${dapPartner?.name ?? 'your friend'} — tap Dap up on their phone.`
            : dapOffer?.to === member.playerId ? `${dapPartner?.name ?? 'Your friend'} offered a dap — tap Dap up now!` : 'Both players tap Dap up within a few seconds.';
    el('squad-status').textContent = quests.squadCircle ? photoQuestComplete(quests, 'squadCircle') ? 'Your squad cheer was verified.' : 'Squad gathered. Submit your group circle and cheer.' : !squadUnlocked ? 'Locked until three pets are connected in the pen.' : squadReady ? 'You are ready. Waiting for the squad to ready up.' : 'Gather close, then have every squad member ready up.';
    el<HTMLButtonElement>('ready-squad').textContent = quests.squadCircle ? 'Squad gathering step done ✓' : squadReady ? 'Ready · waiting for squad…' : 'Ready for squad circle →';
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
    for (const key of ['touchGrass', 'meetFriend', 'dapHandshake', 'squadCircle', 'raidBoss'] as const) {
      if (quests[key] && photoQuestComplete(quests, key)) {
        mood = rewardMood(mood, `${member.playerToken}:${key}`);
      }
    }
    if (mood !== previousMood) save('bondimals:mood', JSON.stringify(mood));
    renderMood();
    el('bond-count').textContent = String(next.bond);
    const survivalPlayer = next.players.find(player => player.id === member.playerId);
    const survival = survivalPlayer?.survival;
    if (survival) {
      el('survival-points').textContent = `${survival.points} points · ${survival.survivalHours}h alive`;
      el('survival-stats').textContent = `Health ${survival.health}% · Hunger ${survival.hunger}% · Happiness ${survival.happiness}%`;
      el('food-inventory').textContent = `Food: ${Object.entries(survival.inventory).map(([food, quantity]) => `${food} ${quantity}`).join(' · ')}`;
    }
    el('effect-bond').textContent = `${next.bond} shared ${next.bond === 1 ? 'moment' : 'moments'}`;
    el('effect-bond-row').hidden = false;
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
  el<HTMLButtonElement>('server-settings').disabled = false;
  nearbyClient.start(serverUrl, nameInput.value.trim());
  // Native startup or an explicit browser tap requests platform permission.
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

el('entry-mode').addEventListener('click', () => { mode = mode === 'nearby' || mode === 'lobby' ? 'join' : 'lobby'; updateEntry(); });
el('nearby-mode').addEventListener('click', () => { mode = 'nearby'; updateEntry(); });
el('start-squad-room').addEventListener('click', () => { stopNearby(); clearResume(); client.start(serverUrl, { type: 'create', name: nameInput.value.trim() }); });
el('join-nearby-room').addEventListener('click', () => { stopNearby(); mode = 'join'; updateEntry(); codeInput.focus(); });
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
    if (mode === 'lobby') { lobbyPaused = false; joinSharedPlayground(); }
    else if (mode === 'nearby') startNearby();
    else client.start(serverUrl, mode === 'create' ? { type: 'create', name } : { type: 'join', name, roomCode: codeInput.value.trim().toUpperCase() });
  } catch (cause) { error(cause instanceof Error ? cause.message : 'Check the multiplayer server address.'); }
});
function leavePlayground(): void {
  stopWalking();
  clearResume();
  if (snapshot?.publicLobby) save(lobbyTokenKey(), '');
  membership = null;
  snapshot = null;
  el('effect-bond-row').hidden = true;
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
  el('quest-tools').hidden = false;
  mode = 'lobby';
  lobbyPaused = true;
  el('scene-caption').textContent = 'Small paws. Big adventures.';
  updateEntry();
  startWalking();
}
el('leave-button').addEventListener('click', leavePlayground);
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    el('error-message').hidden = true;
    client.action(button.dataset.action as PetActionKind);
  });
});
el('meet-button').addEventListener('click', () => {
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  if (local) {
    const x = local.slot === 0 ? -0.4 : local.slot === 1 ? 0.4 : 0;
    const z = local.slot === 2 ? -0.4 : local.slot === 3 ? 0.4 : 0;
    if (walking) { const aligned = walkingTracker.hasHeading; walkingTracker.reset(x, z); walkingTracker.hasHeading = aligned; }
    client.move(x, z);
  }
});
el('ready-squad').addEventListener('click', () => { client.readySquadQuest(); });
el('ready-raid').addEventListener('click', () => { client.readyRaid(); });
const touchGrassPhotoInput = el<HTMLInputElement>('touch-grass-photo');
const evidenceChoice = el<HTMLSelectElement>('evidence-quest');
const evidenceConsent = el<HTMLInputElement>('evidence-consent');
const evidenceInstructions: Record<EvidenceQuestId, string> = {
  touchGrass: 'Show your hand physically touching natural grass outdoors.',
  meetFriend: 'Show both people greeting each other with a wave or high-five. Faces are not required.',
  dapHandshake: 'Record both hands approaching, making contact, and releasing. Use a clip, not a still photo.',
  squadCircle: 'Show everyone from your squad gathered in a circle with hands together or raised in a shared cheer.',
};
function selectedEvidence(): EvidenceQuestId { return evidenceChoice.value as EvidenceQuestId; }
function updateEvidenceChoice(): void {
  el('evidence-instructions').textContent = evidenceInstructions[selectedEvidence()];
  el<HTMLButtonElement>('submit-photo').disabled = selectedEvidence() === 'dapHandshake';
  evidenceConsent.checked = false;
}
evidenceChoice.addEventListener('change', updateEvidenceChoice);
function evidenceSession() {
  const questId = selectedEvidence();
  if (!membership || connection !== 'connected') throw new Error('Join a quest room with your friends first.');
  const quests = snapshot?.quests[membership.playerId];
  if (!(questId === 'dapHandshake' ? quests?.dapHandshakeReady : quests?.[questId])) throw new Error('Complete this quest’s in-game step first.');
  if (quests?.photoVerification[questId] === 'approved') throw new Error('This quest is already verified.');
  if (!evidenceConsent.checked) throw new Error('Ask everyone shown to agree, then check the consent box before submitting.');
  if (photoVerificationPending) throw new Error('Please wait for the current evidence check.');
  return { roomCode: membership.roomCode, playerToken: membership.playerToken, questId };
}
async function submitEvidence(session: ReturnType<typeof evidenceSession>, evidence: object): Promise<void> {
  if (membership?.playerToken !== session.playerToken) throw new Error('Your quest session changed. Select the quest again.');
  el('evidence-status').textContent = 'Checking your evidence with Meta…';
  const response = await fetch(verificationEndpoint(), {
    method: 'POST', signal: AbortSignal.timeout(40_000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...session, ...evidence }),
  });
  const result = await response.json().catch(() => ({})) as { verified?: boolean; reason?: string; error?: string };
  if (!response.ok) throw new Error(result.error || 'Verification is unavailable.');
  el('evidence-status').textContent = result.verified ? `Verified: ${result.reason ?? 'Quest complete!'}` : `Try again: ${result.reason ?? 'The action was not clear enough.'}`;
  toast(result.verified ? 'Quest verified! Your group’s progress updated.' : 'Evidence was inconclusive. Review the instructions and try again.');
}
function setEvidenceBusy(busy: boolean): void {
  photoVerificationPending = busy;
  evidenceChoice.disabled = busy;
  evidenceConsent.disabled = busy;
  el<HTMLButtonElement>('submit-clip').disabled = busy;
  el<HTMLButtonElement>('submit-photo').disabled = busy || selectedEvidence() === 'dapHandshake';
}
function evidenceError(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : 'Evidence verification is unavailable.';
  el('evidence-status').textContent = message; toast(message);
}
el('submit-clip').addEventListener('click', async () => {
  if (photoVerificationPending) return;
  try {
    const session = evidenceSession(); setEvidenceBusy(true);
    el('evidence-status').textContent = 'Preparing frames from your saved clip…';
    const evidence = await prepareNativeClip();
    await submitEvidence(session, evidence);
  } catch (cause) { evidenceError(cause); }
  finally { setEvidenceBusy(false); updateControls(); }
});
let photoSession: ReturnType<typeof evidenceSession> | null = null;
el('submit-photo').addEventListener('click', () => {
  try { photoSession = evidenceSession(); touchGrassPhotoInput.click(); }
  catch (cause) { evidenceError(cause); }
});
el('verify-touch-grass').addEventListener('click', () => {
  evidenceChoice.value = 'touchGrass'; updateEvidenceChoice();
  el('quest-tools').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
touchGrassPhotoInput.addEventListener('change', () => {
  const file = touchGrassPhotoInput.files?.[0]; touchGrassPhotoInput.value = '';
  const session = photoSession; photoSession = null;
  if (!file || !session) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
    evidenceError(new Error('Choose a JPEG, PNG, or WebP photo smaller than 4 MB.')); return;
  }
  setEvidenceBusy(true);
  const reader = new FileReader();
  reader.onerror = () => { setEvidenceBusy(false); evidenceError(new Error('That photo could not be read.')); };
  reader.onload = () => {
    void submitEvidence(session, { photoDataUrl: reader.result }).catch(evidenceError)
      .finally(() => { setEvidenceBusy(false); updateControls(); });
  };
  reader.readAsDataURL(file);
});
el('quest-tools').hidden = false;
el('submit-clip').hidden = !isNativePhone();
if (!isNativePhone()) for (const id of ['record-clip', 'review-clip', 'delete-clip']) el(id).hidden = true;
if (!isNativePhone()) {
  el('recording-status').textContent = 'Choose a photo after completing the in-game step. The native app also supports video clips.';
  el('evidence-status').textContent = 'Your photo is sent only when you select it after checking consent. Movement and multiplayer actions work without a photo.';
  el('local-weather').hidden = false;
  el('browser-view-tools').hidden = false;
  el('enable-compass').hidden = !window.matchMedia('(pointer: coarse)').matches;
  el('enable-walking').hidden = !window.matchMedia('(pointer: coarse)').matches;
  el('weather-status').textContent = 'Local weather is ready when you allow location';
}
let browserHasHeading = false;
const browserCompass = new BrowserCompass(degrees => {
  const local = snapshot?.players.find(player => player.id === membership?.playerId);
  const yaw = headingToYaw(degrees);
  if (walking) {
    const initial = !walkingTracker.hasHeading;
    walkingTracker.heading(degrees, 0); publishWalking(false, initial); return;
  }
  playground?.setWalkingPose({ x: local?.x ?? 0, z: local?.z ?? 0, yaw }, !browserHasHeading);
  browserHasHeading = true;
  if (membership && connection === 'connected') client.heading(yaw);
}, message => { el('browser-compass-status').textContent = message; });
el('enable-compass').addEventListener('click', () => { void browserCompass.start(); });
const browserWalking = new BrowserWalking(receiveWalkingMotion, message => {
  browserWalkingEnabled = false; stopWalking();
  el('enable-walking').textContent = 'Enable walking';
  el('browser-walking-status').textContent = message;
});
el('enable-walking').addEventListener('click', async () => {
  if (browserWalkingEnabled) {
    browserWalkingEnabled = false; browserWalking.stop(); stopWalking();
    el('enable-walking').textContent = 'Enable walking';
    el('browser-walking-status').textContent = 'Tap the ground to move';
    return;
  }
  browserWalkingEnabled = await browserWalking.start();
  if (browserWalkingEnabled) {
    startWalking(); el('enable-walking').textContent = 'Pause walking';
    el('browser-walking-status').textContent = 'Step tracking ready · take two steps';
  }
});

el('local-weather').addEventListener('click', () => {
  const button = el<HTMLButtonElement>('local-weather');
  if (!navigator.geolocation) { el('weather-status').textContent = 'Location unavailable in this browser'; return; }
  button.disabled = true;
  el('weather-status').textContent = 'Finding your local weather…';
  navigator.geolocation.getCurrentPosition(position => {
    void weather.update({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp })
      .finally(() => { button.disabled = false; });
  }, failure => {
    button.disabled = false;
    el('weather-status').textContent = failure.code === 1 ? 'Allow location for this site, then retry local weather' : 'Location unavailable · retry local weather';
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
});
canvas.addEventListener('keydown', event => {
  const direction: Record<string, [number, number]> = { ArrowUp: [0, -0.5], ArrowDown: [0, 0.5], ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0] };
  const delta = direction[event.key];
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  if (delta && local && connection === 'connected' && !walking) {
    event.preventDefault();
    playground?.moveByScreen(delta[0], delta[1]);
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
  const nativeWebUrl = serverUrl === window.bondimalsNative?.serverURL ? window.bondimalsNative?.webURL : undefined;
  const url = createInviteUrl(location.href, serverUrl, membership.roomCode, nativeWebUrl);
  const share = { title: 'Come play in my Bondimals world', text: `Bring your pet! Room ${membership.roomCode}`, url };
  if (navigator.share) void navigator.share(share).catch(cause => { if (cause.name !== 'AbortError') toast('Share the room code shown on screen.'); });
  else void copy(url).then(() => toast('Invite link copied. Send it to your friend.')).catch(cause => toast(String(cause.message)));
});
const settings = el<HTMLDialogElement>('settings-dialog');
el('server-settings').addEventListener('click', () => {
  if (nearbyActive) stopNearby();
  el<HTMLInputElement>('server-url').value = serverUrl;
  el('settings-error').hidden = true;
  settings.showModal();
});
el('close-settings').addEventListener('click', () => settings.close());
el('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const nextServer = normalizeServerUrl(el<HTMLInputElement>('server-url').value);
    if (nextServer !== serverUrl || !snapshot?.publicLobby || connection !== 'connected') leavePlayground();
    serverUrl = nextServer;
    lobbyPaused = false;
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
window.addEventListener('pagehide', () => { browserCompass.stop(); browserWalking.stop(); locationTracker.stop(); nearbyClient.stop(); client.stop(false); });
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
  if (saved && mode !== 'lobby' && saved.serverUrl === serverUrl && (!params.has('room') || params.get('room')?.toUpperCase() === saved.roomCode)) {
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
  stepSensorAvailable = false; stepDetector.reset(); walkingTracker.setStepTracking(false);
  nativeCommand('stopLocation', { purpose: 'walking' });
  playground?.setWalkingPose(null);
  el('walking-status').textContent = 'Walking pauses while you’re away and resumes when you return.';
  el('compass-reading').textContent = 'Compass off';
  updateControls();
}
function startWalking(): void {
  if ((!isNativePhone() && !browserWalkingEnabled) || !ready || walking || document.hidden) return;
  walking = true;
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  walkingTracker.reset(local?.x ?? 0, local?.z ?? 0);
  stepDetector.reset(); walkingSteps = 0;
  stepSensorAvailable = browserWalkingEnabled;
  walkingTracker.setStepTracking(stepSensorAvailable);
  el('walking-status').textContent = 'Aligning your pet with your phone…';
  el('compass-reading').textContent = 'Reading your starting direction…';
  publishWalking();
  updateControls();
  nativeCommand('startLocation', { purpose: 'walking' });
}
function publishWalking(moved = false, initialHeading = false): void {
  if (!walking) return;
  playground?.setWalkingPose(walkingTracker.pose, initialHeading, true);
  if (membership && connection === 'connected') {
    if (moved) client.move(walkingTracker.pose.x, walkingTracker.pose.z);
    client.heading(walkingTracker.pose.yaw);
  }
}
function receiveWalkingMotion(verticalG: number, timestamp: number): void {
  if (!walking || !stepSensorAvailable || document.hidden) return;
  const steps = stepDetector.sample(verticalG, timestamp);
  if (!walkingTracker.steps(steps)) return;
  walkingSteps += steps;
  el(isNativePhone() ? 'walking-status' : 'browser-walking-status').textContent = `Walking with you · ${walkingSteps} steps detected`;
  publishWalking(true);
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
    if (event.type === 'motionStatus') {
      stepSensorAvailable = event.available === true;
      stepDetector.reset(); walkingTracker.setStepTracking(stepSensorAvailable);
      el('walking-status').textContent = event.message ?? '';
    }
    if (event.type === 'motion') receiveWalkingMotion(event.verticalG ?? NaN, event.timestamp ?? NaN);
    if (event.type === 'status' && !stepSensorAvailable) el('walking-status').textContent = event.message ?? '';
    if (event.type === 'heading') {
      const initialHeading = !walkingTracker.hasHeading;
      if (walkingTracker.heading(event.degrees ?? -1, event.accuracy ?? -1)) {
        el('compass-reading').textContent = `Facing ${Math.round(event.degrees!)}° ${event.reference === 'true' ? 'true' : 'magnetic'}`;
        publishWalking(false, initialHeading);
      } else el('compass-reading').textContent = 'Compass uncertain · move away from metal';
    }
    const fix = nativeFix(event);
    if (fix && !stepSensorAvailable) {
      const result = walkingTracker.location(fix);
      el('walking-status').textContent = result.message;
      publishWalking(result.moved);
    }
  });
  nativeCommand('ready', { sceneReady: ready });
}

resumeAutomaticNearby();
startWalking();
