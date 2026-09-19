import './style.css';
import { Playground } from './Playground';
import { RoomClient, normalizeServerUrl } from './RoomClient';
import { GameAccount } from './GameAccount';
import { NearbyClient } from './NearbyClient';
import { LocationDiscovery } from './LocationDiscovery';
import { DevelopmentLocation } from './DevelopmentLocation';
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
          <div id="location-explainer" class="location-explainer"><span class="range-chip">ABOUT 10 METERS</span><p>Find people who are also playing nearby. Your location is shared with the game server while nearby mode is active. Other players see your pet and an approximate distance.</p><span id="location-host"></span></div>
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
        <button id="stop-nearby" class="leave-button">Stop nearby discovery</button>
      </div>
      <div id="room-panel" hidden>
        <div class="eyebrow"><span class="sun-dot"></span> YOUR SHARED PLAYGROUND</div>
        <h1>A very good<br><em>place to meet.</em></h1>
        <div class="invite-card" id="room-invite"><div><span class="small-label">ROOM CODE</span><button id="copy-code" class="room-code" title="Copy room code"><span id="room-code">------</span>${icon('copy')}</button></div><button id="invite-button" class="round-button" title="Invite your friend" aria-label="Invite your friend">${icon('link')}</button></div>
        <p id="invite-note" class="room-description">Share your room code. Your friend's pet will appear here.</p>
        <button type="button" id="pair-display" class="text-button">Pair glasses display</button><p id="display-code" role="status" hidden></p>
        <div class="roster" id="roster" aria-label="Players"></div>
        <div class="quest-card" id="high-five-card"><div class="quest-header"><span class="quest-symbol">${icon('wave')}</span><div><span class="small-label">PLAY TOGETHER</span><h2>High five</h2></div></div><p id="high-five-status" role="status">Bring your pets together to invite a high five.</p><div class="request-actions"><button type="button" id="invite-high-five" class="primary-button">Invite high five</button><button type="button" id="accept-high-five" class="primary-button" hidden>Accept</button><button type="button" id="decline-high-five" class="text-button" hidden>Decline</button></div></div>
        <div id="dap-quest" class="quest-card dap-card" hidden><div class="quest-header"><span class="quest-symbol">${icon('wave')}</span><div><span class="small-label">MEET IN REAL LIFE</span><h2>Dap them up</h2></div></div><p>Walk over, introduce yourselves, and share a dap, high-five, or wave.</p><button class="primary-button" id="confirm-dap">We said hello ${icon('check')}</button><p id="dap-status" role="status">Both players confirm after meeting in person.</p></div>
        <div class="quest-card">
          <div class="quest-header"><span class="quest-symbol">${icon('play')}</span><div><span class="small-label">YOUR FIRST LITTLE ADVENTURE</span><h2>Make a new friend</h2></div><span class="quest-count" id="quest-count">0/3</span></div>
          <ol class="quest-list"><li id="quest-met"><span class="quest-tick">${icon('check')}</span>Bring your pets together</li><li id="quest-waved"><span class="quest-tick">${icon('check')}</span>Give your new friend a wave</li><li id="quest-played"><span class="quest-tick">${icon('check')}</span>Share a little playtime</li></ol>
          <button id="meet-button" class="text-button" disabled>Meet in the middle ${icon('arrow')}</button>
        </div>
        <button id="leave-button" class="leave-button">Leave playground</button>
      </div>
      <div id="error-message" class="error-message" role="alert" hidden></div>
    </section>
    <section class="playground-panel" aria-label="The meadow">
      <div class="scene-topline"><div class="scene-title">${icon('leaf')} THE MEADOW</div><div id="connection-status" class="connection-status" data-state="idle"><span></span><span id="connection-label">Pet preview</span></div></div>
      <div class="scene" id="scene"><canvas id="playground" tabindex="0" aria-label="Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move."></canvas><div id="scene-loading" class="scene-loading"><span class="loading-dot"></span>Waking up Nova…</div></div>
      <div class="scene-caption" id="scene-caption"><span class="caption-star">✳</span> Small paws. Big adventures.</div>
      <div class="play-controls" id="play-controls" hidden>
        <div class="moment-line"><span id="scene-hint">Tap the meadow to move your pet.</span><span class="bond-counter">${icon('heart')}<span id="bond-count">0</span><span class="bond-word">moments</span></span></div><p id="pet-progress" role="status">Your pet and rewards will appear when you join.</p>
        <div class="action-bar"><button data-action="wave">${icon('wave')}<span>Wave</span></button><button data-action="feed">${icon('treat')}<span>Treat</span></button><button data-action="jump">${icon('jump')}<span>Jump</span></button><button data-action="play" class="co-op-action">${icon('play')}<span>Play together</span></button></div>
        <p class="action-notice" id="action-notice" role="status" aria-live="polite">Your little adventure starts here.</p>
      </div>
      <div class="meadow-footer"><span>01 / THE FIRST HELLO</span><span>A WORLD WE MAKE TOGETHER</span></div>
    </section>
  </main>
  <footer class="site-footer"><span>More play. More connection.</span><span>PHONE EDITION <span class="tiny-star">✳</span> BONDIMALS</span></footer>
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
let serverUrl = params.get('server') || stored('bondimals:server') || import.meta.env.VITE_PLAY_SERVER_URL || devServer;
let mode: 'nearby' | 'create' | 'join' = params.has('room') ? 'join' : 'nearby';
let ready = false;
let connection: ConnectionState = 'idle';
let membership: Membership | null = null;
let snapshot: PlaySnapshot | null = null;
let account: GameAccount | null = null;
let lastPetSignal = '';
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
const canvas = el<HTMLCanvasElement>('playground');
const nameInput = el<HTMLInputElement>('player-name');
const codeInput = el<HTMLInputElement>('room-input');
nameInput.value = stored('bondimals:name') || '';
codeInput.value = (params.get('room') || '').toUpperCase().slice(0, 6);

function toast(message: string): void {
  clearTimeout(toastTimer);
  el('toast').textContent = message;
  el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 4000);
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
  const friend = snapshot?.players.find(p => p.id !== membership?.playerId && p.connected);
  const near = !!local && !!friend && Math.hypot(local.x - friend.x, local.z - friend.z) <= 1.5;
  const connected = connection === 'connected';
  playground?.setEnabled(ready && (nearbyActive ? locationActive && discoveryConnected : connected));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.disabled = !connected || !!local?.action || (button.dataset.action === 'play' && !near);
  });
  el<HTMLButtonElement>('meet-button').disabled = !connected || !friend;
  const interaction = snapshot?.interaction;
  const pending = interaction?.status === 'pending';
  const incoming = pending && interaction.targetId === membership?.playerId;
  el<HTMLButtonElement>('invite-high-five').hidden = !!incoming;
  el<HTMLButtonElement>('invite-high-five').disabled = !connected || !near || !!pending || !!local?.action;
  el<HTMLButtonElement>('accept-high-five').hidden = !incoming;
  el<HTMLButtonElement>('decline-high-five').hidden = !incoming;
  el<HTMLButtonElement>('accept-high-five').disabled = !connected || !near;
  el<HTMLButtonElement>('decline-high-five').disabled = !connected;
  el('high-five-status').textContent = incoming ? `${friend?.name ?? 'Your friend'} invited you to high five. Reply soon!`
    : pending ? 'Waiting for your friend to answer…'
    : interaction?.status === 'accepted' ? 'High five! You shared a moment.'
    : interaction?.status === 'declined' ? 'Your friend declined the high five.'
    : interaction?.status === 'expired' ? 'The high five invitation expired.'
    : interaction?.status === 'canceled' ? 'The high five was canceled.'
    : !friend ? 'Invite a friend to join the playground.'
    : near ? 'Your pets are close enough for a high five.' : 'Bring your pets together first.';
  el<HTMLButtonElement>('confirm-dap').disabled = !connected || !friend || !!snapshot?.encounter?.dapConfirmed.includes(membership?.playerId ?? '') || !!snapshot?.encounter?.dapComplete;
  el('scene-hint').textContent = connection === 'offline' ? 'Offline. Leave the playground to connect again.'
    : !connected ? 'Reconnecting. Your pets are waiting for you.'
    : !friend ? 'Invite a friend, or tap the meadow to explore.'
    : near ? 'You’re close! Wave hello or play together.' : 'Tap to move, or meet in the middle.';
}
function setConnection(state: ConnectionState): void {
  connection = state;
  const labels: Record<ConnectionState, string> = { idle: 'Pet preview', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline' };
  el('connection-status').dataset.state = state;
  el('connection-label').textContent = labels[state];
  el<HTMLButtonElement>('server-settings').disabled = !!membership || nearbyActive || state === 'connecting';
  updateEntry();
  updateControls();
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
  if (snapshot.players.length < 2) {
    const empty = document.createElement('div');
    empty.className = 'empty-friend';
    empty.innerHTML = `${icon('people')}<span>A little space for your friend</span>`;
    roster.append(empty);
  }
}
const client = new RoomClient({
  state: setConnection,
  error,
  deviceGrant(grant, expiresAt) {
    el('display-code').hidden = false;
    el('display-code').textContent = `Open the glasses shared view and enter ${grant}. Code expires at ${new Date(expiresAt).toLocaleTimeString()}.`;
  },
  snapshot(next, member) {
    const entering = !membership;
    membership = member;
    snapshot = next;
    if (entering) {
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
    el('connection-label').textContent = `${next.players.filter(p => p.connected).length}/2 here`;
    el<HTMLButtonElement>('server-settings').disabled = true;
    el('room-invite').hidden = !!next.encounter;
    el('dap-quest').hidden = !next.encounter;
    el('invite-note').textContent = next.encounter ? 'You found each other nearby. Make this a real-world hello.' : next.players.filter(p => p.connected).length === 2 ? 'Both pets are here. Let the little adventures begin.' : 'Share your room code. Your friend’s pet will appear here.';
    if (next.encounter) {
      const confirmed = next.encounter.dapConfirmed.includes(member.playerId);
      el('dap-status').textContent = next.encounter.dapComplete ? 'You both confirmed your hello. One shared moment earned!' : confirmed ? 'You confirmed. Waiting for your friend to confirm too.' : 'Both players confirm after meeting in person.';
      el('confirm-dap').textContent = next.encounter.dapComplete ? 'Hello completed ✓' : confirmed ? 'Waiting for your friend…' : 'We said hello';
    }
    renderRoster();
    let done = 0;
    for (const key of ['met', 'waved', 'played'] as const) {
      el(`quest-${key}`).classList.toggle('done', next.quest[key]);
      if (next.quest[key]) done++;
    }
    el('quest-count').textContent = `${done}/3`;
    el('bond-count').textContent = String(next.bond);
    const localAction = next.players.find(player => player.id === member.playerId)?.action?.id ?? '';
    const petSignal = `${next.bond}:${next.encounter?.dapComplete ?? false}:${localAction}`;
    if (petSignal !== lastPetSignal) {
      lastPetSignal = petSignal;
      void refreshPet();
    }
    if (next.notice && next.notice !== lastNotice) {
      lastNotice = next.notice;
      el('action-notice').textContent = next.notice;
    }
    playground?.update(next, member.playerId);
    updateControls();
    if (entering) {
      el('error-message').hidden = true;
      canvas.setAttribute('aria-label', 'Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move.');
      if (!next.encounter) el('copy-code').focus();
    }
  },
});

async function prepareAccount(): Promise<void> {
  account = await GameAccount.connect(serverUrl);
  client.setAccountToken(account.token);
}

async function refreshPet(): Promise<void> {
  if (!account) return;
  try {
    const profile = await account.profile();
    el('pet-progress').textContent = `${profile.pet.mood} · happiness ${Math.round(profile.pet.happiness)} · energy ${Math.round(profile.pet.energy)} · hunger ${Math.round(profile.pet.hunger)} · ${profile.rewards.interactions} connections · ${profile.rewards.xp} XP · ${profile.rewards.coins} coins`;
  } catch { el('pet-progress').textContent = 'Pet progress is temporarily unavailable.'; }
}

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
  fix(fix: LocationFix) { if (nearbyActive && locationActive) nearbyClient.location(fix); },
  status(message: string) { if (nearbyActive) el('location-status').textContent = message; },
  unavailable(message: string) { pauseLocation(); if (nearbyActive) el('location-status').textContent = message; },
  paused() { pauseLocation(); if (nearbyActive) el('location-status').textContent = 'Location paused while you were away. Tap Resume nearby.'; },
};
const locationTracker = import.meta.env.DEV && params.get('demo') === 'nearby'
  ? new DevelopmentLocation(locationCallbacks, params.get('player') === '2')
  : new LocationDiscovery(locationCallbacks);
function startNearby(): void {
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
  // Called in the initiating tap. There is no location request on page load.
  if (locationActive) locationTracker.start();
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
el('stop-nearby').addEventListener('click', stopNearby);
el('resume-nearby').addEventListener('click', () => {
  // A pause removes server presence too. Re-register before publishing a new fix.
  startNearby();
});
el('accept-meet').addEventListener('click', () => {
  if (pendingMeet?.incoming) { nearbyClient.respond(pendingMeet.requestId, true); el<HTMLButtonElement>('accept-meet').disabled = true; el<HTMLButtonElement>('decline-meet').disabled = true; }
});
el('decline-meet').addEventListener('click', () => { if (pendingMeet?.incoming) nearbyClient.respond(pendingMeet.requestId, false); });
el('confirm-dap').addEventListener('click', () => { client.confirmDap(); });
el('pair-display').addEventListener('click', () => client.requestDisplayCode());
el('invite-high-five').addEventListener('click', () => {
  const friend = snapshot?.players.find(p => p.id !== membership?.playerId && p.connected);
  if (friend) client.inviteHighFive(friend.id);
});
el('accept-high-five').addEventListener('click', () => { if (snapshot?.interaction?.status === 'pending') client.respondHighFive(snapshot.interaction.id, true); });
el('decline-high-five').addEventListener('click', () => { if (snapshot?.interaction?.status === 'pending') client.respondHighFive(snapshot.interaction.id, false); });

el('create-tab').addEventListener('click', () => { mode = 'create'; updateEntry(); });
el('join-tab').addEventListener('click', () => { mode = 'join'; updateEntry(); });
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
el('entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || connection === 'connecting') return;
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  save('bondimals:name', name);
  clearResume();
  el('error-message').hidden = true;
  try {
    serverUrl = normalizeServerUrl(serverUrl);
    await prepareAccount();
    if (mode === 'nearby') startNearby();
    else client.start(serverUrl, mode === 'create' ? { type: 'create', name } : { type: 'join', name, roomCode: codeInput.value.trim().toUpperCase() });
  } catch (cause) { error(cause instanceof Error ? cause.message : 'Check the multiplayer server address.'); }
});
el('leave-button').addEventListener('click', () => {
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
canvas.addEventListener('keydown', event => {
  const direction: Record<string, [number, number]> = { ArrowUp: [0, -0.5], ArrowDown: [0, 0.5], ArrowLeft: [-0.5, 0], ArrowRight: [0.5, 0] };
  const delta = direction[event.key];
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  if (delta && local && connection === 'connected') {
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
  const share = { title: 'Come play in my Bondimals meadow', text: `Bring your pet! Room ${membership.roomCode}`, url: url.href };
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
    toast('Server saved. You’re ready to open a playground.');
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
      await prepareAccount();
      client.start(serverUrl, { type: 'join', name: saved.name, roomCode: saved.roomCode, playerToken: saved.playerToken });
    } catch (cause) { error(cause instanceof Error ? cause.message : 'Check your saved server address.', true); }
  }
} catch (cause) {
  console.error('Playground could not load:', cause);
  el('scene-loading').textContent = 'The meadow couldn’t load. Refresh to try again.';
  el('enter-label').textContent = 'Pet unavailable';
  error('We couldn’t load the 3D playground. Check your connection and WebGL support, then refresh.');
}
