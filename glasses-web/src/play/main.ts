import './style.css';
import { Playground } from '../../../companion-web/src/Playground';
import { RoomClient, normalizeServerUrl, type CompatibleSnapshot, type Membership, type ConnectionState } from '../../../companion-web/src/RoomClient';
import { beaverMoodFace } from '../../../companion-web/src/BeaverMoodFace';
import { evidenceReadiness } from '../../../companion-web/src/EvidenceReadiness';
import { GlassesMotion } from './GlassesMotion';
import { GlassesPosePublisher } from './GlassesPosePublisher';
import { GlassesCamera, type CaptureStatus } from './GlassesCamera';
import type { EvidenceQuestId, PetActionKind } from '../../../shared/play-protocol';

const params = new URLSearchParams(location.search);
const simulator = params.has('simulator');
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const read = (key: string) => { try { return localStorage.getItem(`kith:glasses:${key}`); } catch { return null; } };
const save = (key: string, value: string) => { try { localStorage.setItem(`kith:glasses:${key}`, value); } catch { /* Private mode works for this visit. */ } };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const defaultServer = () => {
  const url = new URL('/play', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; return url.href;
};
const configuredServer = import.meta.env.VITE_PLAY_SERVER_URL as string | undefined;
const changedServer = !!configuredServer && configuredServer !== read('configured-server');
let server = params.get('server') || (changedServer ? configuredServer! : read('server')) || configuredServer || defaultServer();
if (configuredServer) save('configured-server', configuredServer);
let name = params.get('name')?.slice(0, 24) || read('name') || 'Explorer';
let member: Membership | null = null;
let snapshot: CompatibleSnapshot | null = null;
let connection: ConnectionState = 'idle';
let ready = false;
let motionEnabled = false;
let currentPanel = '';
let selectedQuest: EvidenceQuestId = 'touchGrass';
let capture: CaptureStatus | null = null;
let captureQuest: EvidenceQuestId | null = null;
let cameraPoll: ReturnType<typeof setTimeout> | undefined;
let cameraGeneration = 0;
let cameraBusy = false;
let previousMember = '';
let walkingRequest = 0;
let headingSign: 1 | -1 = read('yaw-sign') === '1' ? 1 : -1;
let simulatorHeading = 0;
let lastRoomNotice = '';
let grassQuestAvailable: boolean | undefined;
let renderedHappiness: number | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let resumeAfterReconnect = false;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="glass-header"><span class="brand">kith</span><div class="glass-mood"><span id="mood-face">${beaverMoodFace(70)}</span><div><span id="mood-value">70%</span><div class="glass-mood-track"><div id="mood-fill" class="glass-mood-fill" style="width:70%"></div></div></div></div><span id="connection" class="connection">Not connected</span></header>
  <canvas id="playground" aria-label="Your shared beaver playground"></canvas>
  <div id="tracking-status" class="glass-status">Loading your beaver…</div><div id="notice" class="glass-notice" role="status"></div>
  <nav class="action-rail" aria-label="Game actions"><button id="walk" type="button" disabled>Walk</button><button data-action="wave" type="button" disabled>Wave</button><button data-action="feed" id="feed" type="button" disabled>Berry</button><button id="quests" type="button" disabled>Quests</button><button id="more" type="button">More</button></nav>
  <div class="input-hint">${simulator ? '<span class="simulator-badge">SIMULATOR · </span>' : ''}Swipe to choose · Pinch to select</div>
  <section id="panel" class="glass-overlay" role="dialog" aria-modal="true" aria-labelledby="panel-title" hidden></section>`;

let playground: Playground;
function tell(message: string): void {
  clearTimeout(noticeTimer);
  el('notice').textContent = message;
  if (message) noticeTimer = setTimeout(() => { el('notice').textContent = ''; }, 6000);
}
function panel(title: string, content: string, id: string): void {
  leaveCameraPanel(id);
  currentPanel = id;
  el('panel').innerHTML = `<h1 id="panel-title">${title}</h1>${content}`;
  el('panel').hidden = false;
  queueMicrotask(() => el('panel').querySelector<HTMLElement>('button:not(:disabled),input')?.focus());
}
function closePanel(): void {
  leaveCameraPanel('');
  currentPanel = ''; el('panel').hidden = true;
  el('more').focus();
}
function button(label: string, id: string, disabled = false): string {
  return `<button type="button" class="glass-button" id="${id}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function bind(id: string, action: () => void | Promise<void>): void {
  el(id)?.addEventListener('click', () => { void Promise.resolve(action()).catch(showError); });
}
function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'Please try again.';
  const status = currentPanel && el('panel-status');
  if (status) status.textContent = message; else tell(message);
}
function tokenKey(): string { return `session:${server}`; }
function updateGameControls(): void {
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-action],#walk,#quests')) control.disabled = !ready || connection !== 'connected';
}
function join(): void {
  try {
    server = normalizeServerUrl(server); save('server', server); save('name', name);
    resumeAfterReconnect = false;
    motion.stop();
    lastRoomNotice = ''; grassQuestAvailable = undefined;
    previousMember = ''; member = null; snapshot = null;
    let saved: Membership | null = null;
    try { saved = JSON.parse(read(tokenKey()) || 'null'); } catch { /* Fresh entry. */ }
    client.start(server, params.has('room') ? { type: 'join', roomCode: params.get('room')!.toUpperCase(), name,
      ...(saved?.roomCode === params.get('room')!.toUpperCase() ? { playerToken: saved.playerToken } : {}) }
      : { type: 'lobby', name, ...(saved ? { playerToken: saved.playerToken } : {}) });
    closePanel();
  } catch (error) { showError(error); }
}

const posePublisher = new GlassesPosePublisher({
  heading: yaw => { if (connection === 'connected' && !document.hidden) client.heading(yaw, motionEnabled); },
  move: (x, z) => { if (connection === 'connected' && !document.hidden) client.move(x, z); },
});
const motion = new GlassesMotion({
  onPose: (pose, reason) => {
    if (!motionEnabled || connection !== 'connected' || document.hidden) return;
    playground?.setWalkingPose(pose);
    posePublisher.publish(pose, reason);
  },
  onStatus: state => {
    const wasEnabled = motionEnabled;
    motionEnabled = ['waiting', 'live', 'simulated'].includes(state.status);
    if (wasEnabled && !motionEnabled) {
      posePublisher.clearHeading();
      if (connection === 'connected') client.heading(motion.pose.yaw, false);
    }
    if (ready) el('tracking-status').textContent = state.message;
    const resume = ['paused', 'stale'].includes(state.status);
    el('walk').textContent = motionEnabled ? 'Pause' : state.status === 'requesting' ? 'Allow…' : resume ? 'Resume' : 'Walk';
    el<HTMLButtonElement>('walk').disabled = !ready || connection !== 'connected' || state.status === 'requesting';
    playground?.setWalkingPose(motionEnabled ? motion.pose : null);
    if (el('enable-walking')) el('enable-walking').textContent = motionEnabled ? 'Pause walking' : 'Enable walking';
    if (el('recenter')) el<HTMLButtonElement>('recenter').disabled = !motionEnabled;
  },
});
motion.setYawSign(headingSign);

const client = new RoomClient({
  state: state => {
    connection = state;
    el('connection').textContent = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting…' : state === 'reconnecting' ? 'Reconnecting…' : 'Offline';
    playground?.setEnabled(state === 'connected');
    updateGameControls();
    if (state !== 'connected') {
      suspendCameraWork();
      walkingRequest++; previousMember = ''; posePublisher.clear();
      if (state === 'reconnecting' && !document.hidden) {
        resumeAfterReconnect ||= ['waiting', 'live', 'stale', 'simulated'].includes(motion.status);
        motion.suspend();
      } else {
        resumeAfterReconnect = false;
        motion.stop();
      }
      motionEnabled = false; playground?.setWalkingPose(null);
      if (resumeAfterReconnect && ready) el('tracking-status').textContent = 'Reconnecting… tracking will resume when you’re back.';
    }
  },
  snapshot: (next, membership) => {
    snapshot = next; member = membership; save(tokenKey(), JSON.stringify(member));
    playground?.update(next, member.playerId);
    const local = next.players.find(player => player.id === member!.playerId);
    if (local && previousMember !== member.playerId) {
      previousMember = member.playerId;
      motion.syncPose({ x: local.targetX, z: local.targetZ, yaw: local.yaw });
      if (resumeAfterReconnect && !document.hidden) {
        resumeAfterReconnect = false;
        motion.resume();
      }
    }
    motion.setWorldLimit(next.worldLimit ?? 3);
    if (motionEnabled) playground?.setWalkingPose(motion.pose);
    const happiness = local?.survival?.happiness ?? 70;
    playground?.setHappiness(happiness);
    const roundedHappiness = Math.round(happiness);
    if (renderedHappiness !== roundedHappiness) {
      renderedHappiness = roundedHappiness;
      el('mood-face').innerHTML = beaverMoodFace(roundedHappiness);
      el('mood-value').textContent = `${roundedHappiness}%`;
      el('mood-fill').style.width = `${roundedHappiness}%`;
    }
    el('connection').textContent = `${next.players.filter(player => player.connected).length}/4 here`;
    const cooldown = local?.survival?.treatCooldownMs ?? 0;
    el<HTMLButtonElement>('feed').disabled = !ready || cooldown > 0 || (local?.survival?.inventory.berry ?? 1) < 1;
    el('feed').textContent = cooldown > 0 ? `${Math.ceil(cooldown / 1000)}s` : 'Berry';
    // Room notices are shared and repeated in every snapshot. Never turn one
    // player's walking milestone into a sticky upload prompt for everyone.
    const grassAvailable = !!next.quests[member.playerId]?.touchGrass;
    const grassJustAvailable = grassQuestAvailable === false && grassAvailable;
    grassQuestAvailable = grassAvailable;
    if (next.notice !== lastRoomNotice) {
      lastRoomNotice = next.notice;
      if (!currentPanel && !next.notice.endsWith(' touched grass! Add a photo to verify this quest.')) tell(next.notice);
    }
    if (grassJustAvailable && !currentPanel) tell('Touch grass quest ready. Open Quests whenever you like.');
  },
  error: (message, terminal) => {
    tell(message);
    if (terminal) settings(message);
  },
}, { retryInitialConnection: true });
const camera = new GlassesCamera(() => server, () => member);

function settings(message = ''): void {
  panel('Connect your playground', `<p>Use the same server as your phone and iPad.</p><label>Your name<input id="name-input" maxlength="24" value="${escape(name)}" autocomplete="off"></label><label>Game server<input id="server-input" value="${escape(server)}" spellcheck="false" autocomplete="off" inputmode="url"></label><p id="panel-status" class="small">${escape(message || 'Glasses need a secure WSS server. Set this up before putting them on.')}</p><div class="button-row">${button('Join', 'join', !ready)}${button('Back', 'back')}</div>`, 'settings');
  bind('join', () => { name = el<HTMLInputElement>('name-input').value.trim().slice(0, 24) || 'Explorer'; server = el<HTMLInputElement>('server-input').value.trim(); join(); });
  bind('back', closePanel);
}

async function enableWalking(): Promise<void> {
  resumeAfterReconnect = false;
  if (motionEnabled || motion.status === 'requesting') { walkingRequest++; motion.stop(); return; }
  if (connection !== 'connected' || document.hidden) return;
  const local = snapshot?.players.find(player => player.id === member?.playerId);
  if (!local) return;
  const request = ++walkingRequest;
  motion.syncPose({ x: local.targetX, z: local.targetZ, yaw: local.yaw });
  simulatorHeading = 0;
  if (simulator) motion.startSimulation(); else await motion.start();
  if (request !== walkingRequest || connection !== 'connected' || document.hidden) return;
  closePanel();
}

function more(): void {
  panel('Your beaver', `<div class="button-row">${button('Jump', 'jump', connection !== 'connected')}${button('Play', 'play', connection !== 'connected')}${button('Dap', 'dap', connection !== 'connected')}</div><div class="button-row">${button(motionEnabled ? 'Pause walking' : 'Enable walking', 'enable-walking', connection !== 'connected')}${button('Recenter', 'recenter', !motionEnabled)}</div>${button('Camera quests · pair phone', 'pair-camera', connection !== 'connected')}${button('Connection & controls', 'settings')}<p id="panel-status" class="small">${simulator ? 'Simulator only: A / D turn, W walks a step. Arrow keys select buttons.' : 'Steps move your beaver; looking around changes its heading. Keep the phone camera bridge open for capture.'}</p>${button('Back to game', 'back')}`, 'more');
  for (const action of ['jump', 'play', 'dap'] as const) bind(action, () => { client.action(action); closePanel(); });
  bind('enable-walking', enableWalking);
  bind('recenter', () => { motion.recenter(); closePanel(); });
  bind('pair-camera', pairCamera);
  bind('settings', controls);
  bind('back', closePanel);
}

function controls(): void {
  panel('Connection & controls', `<p class="small">${escape(name)} · Room ${escape(member?.roomCode || '—')}</p>${button('Change server', 'change-server')}${button(headingSign === -1 ? 'Reverse head-turn direction' : 'Restore head-turn direction', 'reverse')}<p class="small">If turning right faces your beaver left, reverse head-turn direction once. Recenter while looking straight ahead.</p>${button('Step forward', 'step', connection !== 'connected')}<p class="small">Step forward also works when motion sensors are unavailable.</p>${button('Back', 'back')}`, 'controls');
  bind('change-server', () => settings());
  bind('reverse', () => { headingSign = headingSign === 1 ? -1 : 1; save('yaw-sign', String(headingSign)); motion.setYawSign(headingSign); motion.recenter(); closePanel(); });
  bind('step', () => {
    const local = snapshot?.players.find(player => player.id === member?.playerId);
    if (!local || connection !== 'connected' || document.hidden) return;
    const yaw = motionEnabled ? motion.pose.yaw : local.yaw;
    const origin = motionEnabled ? motion.pose : { x: local.targetX, z: local.targetZ };
    motion.syncPose({ x: origin.x + Math.sin(yaw) * 0.7, z: origin.z + Math.cos(yaw) * 0.7, yaw });
    if (!motionEnabled) client.heading(yaw, false);
    posePublisher.move(motion.pose.x, motion.pose.z);
    if (motionEnabled) playground.setWalkingPose(motion.pose);
    closePanel();
  });
  bind('back', more);
}

const quests: { id: EvidenceQuestId; title: string; instruction: string }[] = [
  { id: 'touchGrass', title: 'Touch grass', instruction: 'Look at your hand touching real grass. Take a photo or record a short clip.' },
  { id: 'meetFriend', title: 'Say hello', instruction: 'Meet another player and capture their wave or your high-five.' },
  { id: 'dapHandshake', title: 'Dap up', instruction: 'Record your hands coming together, making contact, and separating.' },
  { id: 'squadCircle', title: 'Circle up', instruction: 'Gather at least three players. Capture everyone cheering or their hands together.' },
];
let captureSession: string | null = null;
let cancelCaptureRequested = false;

function cameraViewMatches(generation: number, id: string, session: string): boolean {
  return cameraGeneration === generation && currentPanel === id && camera.sessionKey === session
    && connection === 'connected' && !document.hidden;
}
function leaveCameraPanel(next: string): void {
  cameraGeneration++; clearTimeout(cameraPoll);
  if (currentPanel === 'capture' && next !== 'capture' && next !== 'review') {
    cancelCaptureRequested = true;
    if (!cameraBusy) void discardActiveCapture();
  }
}
async function discardActiveCapture(): Promise<void> {
  if (!captureSession || cameraBusy) return;
  const session = captureSession;
  cameraBusy = true;
  capture = null; captureQuest = null;
  try { if (camera.sessionKey === session) await camera.discard(); }
  catch { /* Disconnects revoke the scoped camera session on the server. */ }
  finally { captureSession = null; cameraBusy = false; }
}
function suspendCameraWork(): void {
  cameraGeneration++; clearTimeout(cameraPoll);
  if (captureSession) {
    cancelCaptureRequested = true;
    if (!cameraBusy) void discardActiveCapture();
  }
  if (connection !== 'connected') { capture = null; captureQuest = null; camera.reset(); }
}
function resumeCameraPanel(): void {
  if (currentPanel === 'capture') questPanel('Capture canceled while the display was paused. Record again when ready.');
  else if (currentPanel === 'review') {
    if (capture) reviewCapture(); else questPanel('Your game session changed. Capture again.');
  }
}
function questList(): void {
  panel('Real-world quests', `<p class="small">Complete quests with your glasses camera.</p><div class="quest-list">${quests.map(quest => button(`${quest.title}<span class="quest-mark">${snapshot?.quests[member?.playerId || '']?.[quest.id] ? '✓' : '→'}</span>`, `quest-${quest.id}`)).join('')}</div>${button('Raid · calm Mossback', 'raid', !snapshot || snapshot.raid.state === 'defeated')}${button('Back', 'back')}`, 'quests');
  for (const quest of quests) bind(`quest-${quest.id}`, () => { selectedQuest = quest.id; questPanel(); });
  bind('raid', () => { client.readyRaid(); closePanel(); });
  bind('back', closePanel);
}
function questPanel(message = ''): void {
  const quest = quests.find(item => item.id === selectedQuest)!;
  const readiness = evidenceReadiness(selectedQuest, snapshot, member?.playerId, connection === 'connected');
  const canReview = capture?.status === 'ready' && captureQuest === selectedQuest && capture.questId === selectedQuest;
  panel(quest.title, `<p>${quest.instruction}</p><p id="panel-status" class="small">${escape(message || readiness.message)}</p><div class="button-row">${button('Photo', 'capture-photo', !readiness.ready || selectedQuest === 'dapHandshake')}${button('6s clip', 'capture-clip', !readiness.ready)}</div>${button('Review capture', 'review', !canReview)}${button('Pair glasses camera', 'pair-camera')}${button('Back', 'back')}`, 'quest');
  bind('capture-photo', () => startCapture('photo'));
  bind('capture-clip', () => startCapture('clip'));
  bind('pair-camera', pairCamera);
  bind('review', reviewCapture);
  bind('back', questList);
}
async function pairCamera(): Promise<void> {
  if (cameraBusy || connection !== 'connected' || document.hidden) return;
  cameraBusy = true;
  panel('Pair your glasses camera', `<p>Open Kith Camera on your paired iPhone. Enable quest controls and enter this game server and pairing code.</p><div id="pair-code" class="pair-code">…</div><p id="pair-server" class="small"></p><p id="panel-status" class="small">Checking your camera bridge…</p>${button('Check bridge', 'check-camera', true)}${button('New pairing code', 'new-camera-code', true)}<p class="small">Use a new code if Kith Camera restarted or you unpaired it.</p>${button('Back', 'back')}`, 'pairing');
  const generation = cameraGeneration, session = camera.sessionKey;
  const current = () => cameraViewMatches(generation, 'pairing', session);
  el('pair-server').textContent = camera.origin;
  bind('back', more);
  const showState = (state: CaptureStatus) => {
    if (!current()) return;
    el('panel-status').textContent = state.connected
      ? 'Camera bridge connected. Start the glasses camera in Kith Camera and keep the phone app open.'
      : state.paired ? 'Paired. Reopen Kith Camera and start the glasses camera.' : 'Enter this eight-character code in Kith Camera on your phone.';
    if (state.paired) el('pair-code').textContent = 'Paired';
  };
  const showCode = (paired: { code: string; expiresAt: number }) => {
    if (!current()) return;
    el('pair-code').textContent = paired.code;
    const minutes = Math.max(1, Math.ceil((paired.expiresAt - Date.now()) / 60_000));
    el('panel-status').textContent = `Enter this eight-character code in Kith Camera. Expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  };
  bind('check-camera', async () => {
    if (cameraBusy || !current()) return;
    cameraBusy = true; el<HTMLButtonElement>('check-camera').disabled = true;
    try { showState(await camera.status()); }
    catch (error) { if (current()) el('panel-status').textContent = error instanceof Error ? error.message : 'Bridge unavailable.'; }
    finally { cameraBusy = false; if (current()) el<HTMLButtonElement>('check-camera').disabled = false; }
  });
  bind('new-camera-code', async () => {
    if (cameraBusy || !current()) return;
    cameraBusy = true;
    el<HTMLButtonElement>('check-camera').disabled = true;
    el<HTMLButtonElement>('new-camera-code').disabled = true;
    el('panel-status').textContent = 'Creating a new camera pairing code…';
    try { showCode(await camera.pair(true)); capture = null; captureQuest = null; }
    catch (error) { if (current()) el('panel-status').textContent = error instanceof Error ? error.message : 'Pairing failed.'; }
    finally {
      cameraBusy = false;
      if (current()) { el<HTMLButtonElement>('check-camera').disabled = false; el<HTMLButtonElement>('new-camera-code').disabled = false; }
    }
  });
  try {
    const state = await camera.status();
    if (!current()) return;
    if (state.paired) showState(state);
    else {
      showCode(await camera.pair());
    }
  } catch (error) { if (current()) el('panel-status').textContent = error instanceof Error ? error.message : 'Pairing failed.'; }
  finally {
    cameraBusy = false;
    if (current()) { el<HTMLButtonElement>('check-camera').disabled = false; el<HTMLButtonElement>('new-camera-code').disabled = false; }
  }
}

async function startCapture(kind: 'photo' | 'clip'): Promise<void> {
  if (cameraBusy || connection !== 'connected' || document.hidden) return;
  const questId = selectedQuest, session = camera.sessionKey;
  const readiness = evidenceReadiness(questId, snapshot, member?.playerId, true);
  if (!readiness.ready || kind === 'photo' && questId === 'dapHandshake') return;
  cameraBusy = true; capture = null; captureQuest = questId;
  captureSession = session; cancelCaptureRequested = false;
  panel(kind === 'photo' ? 'Taking a photo' : 'Recording 6 seconds', `<p>Keep the action in the glasses camera’s view.</p><p id="panel-status" class="progress-text">Requesting glasses camera capture…</p>${button('Cancel', 'cancel-capture', true)}`, 'capture');
  const generation = cameraGeneration;
  const current = () => cameraViewMatches(generation, 'capture', session) && !cancelCaptureRequested;
  bind('cancel-capture', async () => {
    if (cameraBusy) return;
    cancelCaptureRequested = true; cameraGeneration++; clearTimeout(cameraPoll);
    el<HTMLButtonElement>('cancel-capture').disabled = true;
    await discardActiveCapture();
    if (currentPanel === 'capture' && camera.sessionKey === session && !document.hidden) { selectedQuest = questId; questPanel('Capture discarded.'); }
  });
  try {
    const request = await camera.capture(kind, questId);
    if (!current()) {
      cameraBusy = false;
      await discardActiveCapture();
      return;
    }
    cameraBusy = false;
    el<HTMLButtonElement>('cancel-capture').disabled = false;
    el('panel-status').textContent = 'Waiting for fresh glasses camera evidence…';
    const startedAt = Date.now();
    const poll = async () => {
      if (!current()) return;
      try {
        const state = await camera.status();
        if (!current()) return;
        if (state.requestId !== request.requestId || state.questId !== questId || state.status === 'error') throw new Error(state.error || 'Capture ended. Try again.');
        if (state.status === 'ready') { captureSession = null; capture = state; captureQuest = questId; reviewCapture(); return; }
        if (!state.connected || Date.now() - startedAt > 35_000) throw new Error('Camera bridge disconnected. Keep Kith Camera open and try again.');
        cameraPoll = setTimeout(() => { void poll(); }, 1000);
      } catch (error) {
        if (!current()) return;
        selectedQuest = questId;
        questPanel(error instanceof Error ? error.message : 'Capture failed.');
      }
    };
    void poll();
  } catch (error) {
    cameraBusy = false;
    if (current()) { captureSession = null; selectedQuest = questId; questPanel(error instanceof Error ? error.message : 'Capture failed.'); }
    else { captureSession = null; }
  }
}

function reviewCapture(): void {
  if (!capture || capture.status !== 'ready' || !captureQuest || capture.questId !== captureQuest || document.hidden) return;
  const evidence = capture, questId = captureQuest, session = camera.sessionKey;
  selectedQuest = questId;
  const frameCount = evidence.frames?.length ?? 0;
  const seconds = evidence.durationSeconds ?? 6;
  panel('Review your capture', `<img id="capture-preview" class="camera-preview" alt="Your glasses camera capture"><p id="capture-frame" class="small">${frameCount ? `${seconds.toFixed(1)}-second clip · ${frameCount} sampled frames` : 'Glasses photo'} · ${quests.find(quest => quest.id === questId)!.title}</p>${frameCount ? `<div class="button-row">${button('Pause preview', 'preview-toggle')}${button('Next frame', 'preview-next')}</div>` : ''}<label class="consent"><input id="evidence-consent" type="checkbox">Everyone shown agrees to submit.</label><p id="panel-status" class="small">Submit sends this evidence to the game server and Meta for quest verification.</p><div class="button-row">${button('Submit', 'submit', true)}${button('Discard', 'discard')}</div>${button('Back to quest', 'back')}`, 'review');
  const generation = cameraGeneration;
  const current = () => cameraViewMatches(generation, 'review', session) && capture === evidence;
  // Returning from a hidden tab rebuilds the review controls. A verification
  // already requested by the user can finish into that same evidence view.
  const reviewingEvidence = () => currentPanel === 'review' && camera.sessionKey === session && capture === evidence && !document.hidden;
  const image = el<HTMLImageElement>('capture-preview');
  const consent = el<HTMLInputElement>('evidence-consent');
  const submit = el<HTMLButtonElement>('submit');
  const discard = el<HTMLButtonElement>('discard');
  image.src = evidence.photoDataUrl || evidence.frames?.[0] || '';
  let frame = 0, playing = true;
  const showFrame = () => {
    if (!current() || !evidence.frames?.length) return;
    image.src = evidence.frames[frame % frameCount]!;
    el('capture-frame').textContent = `${seconds.toFixed(1)}s clip · frame ${frame % frameCount + 1}/${frameCount} · ${quests.find(quest => quest.id === questId)!.title}`;
  };
  const cycle = () => {
    if (!current() || !playing) return;
    showFrame(); frame++;
    cameraPoll = setTimeout(cycle, Math.max(200, seconds * 1000 / Math.max(1, frameCount - 1)));
  };
  if (frameCount) {
    cycle();
    bind('preview-toggle', () => { playing = !playing; clearTimeout(cameraPoll); el('preview-toggle').textContent = playing ? 'Pause preview' : 'Play preview'; if (playing) cycle(); });
    bind('preview-next', () => { playing = false; clearTimeout(cameraPoll); el('preview-toggle').textContent = 'Play preview'; showFrame(); frame++; });
  }
  consent.addEventListener('change', () => { submit.disabled = cameraBusy || !consent.checked; });
  bind('back', () => { if (!cameraBusy) questPanel(); });
  bind('submit', async () => {
    if (!current() || !consent.checked || cameraBusy) return;
    cameraBusy = true; submit.disabled = true; discard.disabled = true; consent.disabled = true;
    el<HTMLButtonElement>('back').disabled = true;
    el('panel-status').textContent = 'Checking your quest…';
    try {
      const result = await camera.submit(questId, evidence);
      if (result.verified) {
        await camera.discard().catch(() => {});
        const showCompletion = reviewingEvidence();
        capture = null; captureQuest = null; clearTimeout(cameraPoll);
        if (showCompletion) {
          selectedQuest = questId; questPanel(`Quest complete! ${result.reason}`);
        } else tell(`Quest complete! ${result.reason}`);
      } else if (reviewingEvidence()) el('panel-status').textContent = result.reason || 'Try capturing the action again.';
    } catch (error) { if (reviewingEvidence()) el('panel-status').textContent = error instanceof Error ? error.message : 'Quest check failed. Please retry.'; }
    finally {
      cameraBusy = false;
      if (reviewingEvidence()) {
        el<HTMLButtonElement>('discard').disabled = false;
        el<HTMLInputElement>('evidence-consent').disabled = false;
        el<HTMLButtonElement>('submit').disabled = !el<HTMLInputElement>('evidence-consent').checked;
        el<HTMLButtonElement>('back').disabled = false;
      }
    }
  });
  bind('discard', async () => {
    if (cameraBusy || !current()) return;
    cameraBusy = true; discard.disabled = true; submit.disabled = true; consent.disabled = true;
    try {
      await camera.discard(); capture = null; captureQuest = null; clearTimeout(cameraPoll);
      if (cameraGeneration === generation && currentPanel === 'review' && !document.hidden) { selectedQuest = questId; questPanel('Capture discarded.'); }
    } catch (error) { if (current()) el('panel-status').textContent = error instanceof Error ? error.message : 'Discard failed. Please retry.'; }
    finally { cameraBusy = false; if (current()) { discard.disabled = false; consent.disabled = false; submit.disabled = !consent.checked; } }
  });
}

bind('walk', enableWalking); bind('quests', questList); bind('more', more);
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(control => control.addEventListener('click', () => client.action(control.dataset.action as PetActionKind)));
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type !== 'checkbox') return;
  if (simulator && !currentPanel && ['a', 'd', 'w'].includes(event.key.toLowerCase())) {
    if (!motionEnabled) { tell('Select Walk to start simulator controls.'); return; }
    if (event.key.toLowerCase() === 'w') motion.simulateSteps(1);
    else { simulatorHeading += event.key.toLowerCase() === 'd' ? 10 : -10; motion.simulateHeading(simulatorHeading); }
    event.preventDefault(); return;
  }
  if (event.key === 'Escape' && currentPanel && !cameraBusy) { closePanel(); event.preventDefault(); return; }
  if (event.key === 'Enter' && target instanceof HTMLInputElement && target.type === 'checkbox') { target.click(); event.preventDefault(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(event.key)) return;
  const scope = currentPanel ? el('panel') : document.querySelector('.action-rail')!;
  const controls = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')].filter(control => !control.hidden);
  if (!controls.length) return;
  const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) || event.key === 'Tab' && event.shiftKey ? -1 : 1;
  const index = controls.indexOf(target);
  controls[(index + direction + controls.length) % controls.length]!.focus(); event.preventDefault();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (connection === 'connected') tell('Welcome back. Select Walk to resume motion.');
    resumeCameraPanel();
  } else {
    resumeAfterReconnect = false;
    walkingRequest++; posePublisher.clear();
    motion.suspend();
    suspendCameraWork();
  }
});
window.addEventListener('pagehide', () => { suspendCameraWork(); walkingRequest++; posePublisher.clear(); client.stop(false); motion.stop(); clearTimeout(cameraPoll); clearTimeout(noticeTimer); playground?.dispose(); });

// Connecting is independent of the 3D download: an unavailable server must not
// look like a stuck beaver, and users can fix the connection while assets load.
if (params.get('server') || read('server') || configuredServer || !location.hostname.endsWith('.github.io')) join();
else settings();

try {
  el('tracking-status').textContent = 'Loading your beaver…';
  playground = new Playground(el<HTMLCanvasElement>('playground'), (x, z) => {
    if (connection !== 'connected' || document.hidden) return;
    const local = snapshot?.players.find(player => player.id === member?.playerId);
    motion.syncPose({ x, z, yaw: motionEnabled ? motion.pose.yaw : local?.yaw ?? motion.pose.yaw });
    if (!motionEnabled) client.heading(motion.pose.yaw, false);
    posePublisher.move(motion.pose.x, motion.pose.z);
    if (motionEnabled) playground.setWalkingPose(motion.pose);
  }, { display: true });
  await playground.load(); ready = true;
  el('tracking-status').textContent = simulator ? 'Simulator · select Walk, then W / A / D' : 'Select Walk while facing forward';
  updateGameControls();
  if (el('join')) el<HTMLButtonElement>('join').disabled = false;
} catch { el('tracking-status').textContent = 'Could not load the beaver. Reopen Kith to retry.'; }
