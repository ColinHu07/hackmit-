import './style.css';
import { placeAnchor, projectAnchor, type AnchorProjection } from './anchor/PseudoWorldAnchor';
import { SimulatedOrientation, isEditingControl } from './input/SimulatedOrientation';
import { HeadOrientation } from './input/HeadOrientation';
import { CreatureSession, type CreatureAction } from './interaction/CreatureSession';
import { NovaRenderer } from './rendering/NovaRenderer';

// Explicit route: never guess a glasses device from viewport size or user agent.
// The root and /display routes are safe, debug-free black display surfaces.
const simulator = new URLSearchParams(location.search).has('simulator') || window.location.pathname.replace(/\/$/, '').endsWith('/simulator');
document.body.className = simulator ? 'simulator-mode' : 'display-mode';
if (simulator) document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1.0');

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const sparkle = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.5 14.8 9.2 21.5 12l-6.7 2.8-2.8 6.7-2.8-6.7L2.5 12l6.7-2.8L12 2.5Z" fill="currentColor"/></svg>';
const canvasMarkup = '<div class="display-surface"><canvas id="nova-canvas" width="600" height="600" role="img" aria-label="Nova, your 3D character on a black display"></canvas><p id="render-error" role="alert" hidden></p><p id="display-notice" role="status">Loading your character…</p></div>';

element('#app').innerHTML = simulator ? `
  <div class="shell">
    <header class="site-header">
      <a class="brand" href="?simulator" aria-label="Bondimals simulator"><span class="brand-icon">${sparkle}</span>bondimals<span class="brand-dot">.</span></a>
      <div class="header-meta"><span class="status-dot"></span> a shared little world <span class="header-divider"></span><span class="version">BUILD 002</span></div>
    </header>
    <main>
      <section class="intro">
        <div><p class="eyebrow">THE FIRST HELLO <span>/</span> GLASSES SIMULATOR</p><h1>A little friend. A place in your world.</h1><p class="intro-copy">Your character, brought to life. Make a connection, then try looking away and back.</p></div>
        <span class="simulation-badge"><span class="status-dot"></span> Local simulation</span>
      </section>
      <div class="workspace">
        <section class="preview-panel" aria-label="Glasses display preview">
          <div class="panel-heading"><h2><span class="small-square"></span> Display preview</h2><span class="mono">600 × 600</span></div>
          ${canvasMarkup}
          <div class="preview-footer"><span><span class="status-dot purple"></span> Nova’s world, through your eyes</span><a href="./" target="_blank" rel="noopener">Open display view <span aria-hidden="true">↗</span></a></div>
        </section>
        <aside class="controls-panel" aria-label="Desktop simulator controls">
          <section class="nova-info"><div class="nova-title"><div><p class="eyebrow">YOUR FIRST BONDIMAL</p><h2>Nova <span>✦</span></h2></div><span id="visibility-status" class="visibility-badge" role="status">In view</span></div><p>A curious little spirit, waiting to meet you.</p><div class="creature-traits"><span id="bond-count">0 connections this visit</span><span>Your GLB</span></div><div class="interaction-buttons"><button data-action="pet" type="button">♡ Pet</button><button data-action="feed" type="button">✦ Feed</button><button data-action="play" type="button">↻ Play</button></div><p id="reaction-note" role="status">Select an action or click Nova. Enter pets, F feeds, P plays.</p></section>
          <section class="orientation-controls"><div class="section-title"><h3>Look around</h3><span class="tiny-label">SIMULATED HEAD</span></div>
            <div class="compass" aria-hidden="true"><span class="compass-north">0°</span><span class="compass-west">−90°</span><span class="compass-east">90°</span><span class="compass-south">180°</span><div id="heading-cone"><div class="cone-fill"></div><div class="view-ray"></div></div><div id="anchor-bearing"><span>${sparkle}</span></div><div class="compass-center"></div></div>
            <div class="range-heading"><label for="yaw">Head yaw</label><output id="yaw-value" for="yaw">0.0°</output></div>
            <input id="yaw" type="range" min="-180" max="180" step="0.1" value="0" aria-label="Head yaw" />
            <div class="range-labels"><span>−180°</span><span>0°</span><span>180°</span></div>
            <div class="turn-buttons"><button id="turn-left" type="button" aria-label="Turn head left 15 degrees">← <span>Look left</span></button><button id="turn-right" type="button" aria-label="Turn head right 15 degrees"><span>Look right</span> →</button></div>
            <p class="control-hint">Or hold <kbd>←</kbd> <kbd>→</kbd> to turn your head.</p>
          </section>
          <section class="anchor-controls"><div class="section-title"><h3>Nova’s anchor</h3><span class="anchor-type">DIRECTION</span></div><div class="anchor-readout"><span>Stored heading</span><strong id="anchor-value">0.0°</strong></div><button id="place-anchor" class="primary-button" type="button">${sparkle} Place Nova here <kbd>SPACE</kbd></button><button id="return-to-anchor" class="text-button" type="button">↶ &nbsp; Look back at Nova <kbd>R</kbd></button></section>
          <details class="advanced"><summary>Fine-tune the simulation <span aria-hidden="true">+</span></summary><div class="advanced-body"><div class="range-heading"><label for="pitch">Head pitch</label><output id="pitch-value" for="pitch">0.0°</output></div><input id="pitch" type="range" min="-80" max="80" step="0.1" value="0" /><div class="range-heading"><label for="fov">Field of view</label><output id="fov-value" for="fov">60°</output></div><input id="fov" type="range" min="20" max="100" step="2" value="60" /><p>Simulation cone, not a measured hardware FOV. Use ↑ / ↓ to try pitch.</p><div class="range-heading"><label for="model-facing">Character facing</label></div><input id="model-facing" type="range" min="-180" max="180" value="0" step="15" /><button id="reset" class="secondary-button" type="button">Reset simulation <kbd>0</kbd></button></div></details>
        </aside>
      </div>
      <section class="inspector" aria-label="Anchor telemetry"><div class="inspector-label"><span class="status-dot"></span> ANCHOR TELEMETRY</div><div><span>Yaw offset</span><output id="offset-value">0.0°</output></div><div><span>Screen position</span><output id="position-value">300, 300</output></div><div><span>Confidence</span><output id="confidence-value">1.00 · simulated</output></div><div><span>Frame loop</span><output id="fps-value">— fps</output></div></section>
      <div class="bottom-notes"><p>${sparkle} Black pixels let the physical world shine through the additive display.</p><span>Interactive demo <span class="note-separator">·</span> PseudoWorldAnchor <span class="note-separator">·</span> Direction anchor only</span></div>
      <section class="activity" aria-label="Local simulation events"><h2>Session notes <span>LOCAL ONLY</span></h2><ol id="event-log" aria-live="polite" aria-relevant="additions"></ol></section>
    </main>
    <footer class="site-footer"><span>Small creatures. Shared connections.</span><span>BONDIMALS / HACKMIT</span></footer>
  </div>` : `<main class="glasses-display" aria-label="Bondimals display">${canvasMarkup}<div id="calibration-guides" aria-hidden="true"><span class="guide-center">+</span><span class="guide-left">+</span><span class="guide-bottom">+</span></div><section id="hardware-controls" aria-label="Glasses controls"><p id="tracking-note">Direction tracking needs a brief calibration.</p><button id="tracking-start" type="button">Enable head tracking</button><button id="calibrate" type="button" hidden>Confirm right turn</button><div id="hardware-actions" hidden><button data-action="pet" type="button">♡ Pet</button><button data-action="feed" type="button">✦ Feed</button><button data-action="play" type="button">↻ Play</button><button id="move-here" type="button">Move here</button></div></section></main>`;

const canvas = element<HTMLCanvasElement>('#nova-canvas');
const errorMessage = element<HTMLParagraphElement>('#render-error');
const input = simulator ? new SimulatedOrientation() : null;
const head = simulator ? null : new HeadOrientation();
const session = new CreatureSession();
const notice = element('#display-notice');
let noticeUntil = Infinity;
let hasHardwareAnchor = false;
let currentProjection: AnchorProjection = { visible: false, x: 300, y: 300, deltaYaw: 0, deltaPitch: 0, confidence: 0 };
let lastTrackingState = '';
let lastHardwareMessage = '';
let loading = true;
let anchor = placeAnchor({ yaw: 0, pitch: 0 });
let fov = 60;
let renderer: NovaRenderer | undefined;
let previousVisibility: boolean | undefined;
let animationId = 0;
let running = true;
let pageSuspended = false;
let frames = 0;
let fps = 0;
let fpsWindow = performance.now();
let previousTime = performance.now();
let elapsedSeconds = 0;
let lastUiUpdate = 0;

const ui = simulator ? {
  yaw: element<HTMLInputElement>('#yaw'), pitch: element<HTMLInputElement>('#pitch'),
  fov: element<HTMLInputElement>('#fov'), yawValue: element<HTMLOutputElement>('#yaw-value'),
  pitchValue: element<HTMLOutputElement>('#pitch-value'), fovValue: element<HTMLOutputElement>('#fov-value'),
  anchorValue: element('#anchor-value'), offset: element('#offset-value'), position: element('#position-value'),
  confidence: element('#confidence-value'), fps: element('#fps-value'), status: element('#visibility-status'),
  headingCone: element('#heading-cone'), anchorBearing: element('#anchor-bearing'), events: element('#event-log'),
} : null;

function logEvent(type: string, message: string): void {
  console.info(`[Bondimals] ${type}`, { message, anchor: { ...anchor } });
  if (!ui) return;
  const item = document.createElement('li');
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const text = document.createElement('span');
  text.textContent = message;
  item.append(time, text);
  ui.events.prepend(item);
  while (ui.events.children.length > 4) ui.events.lastElementChild?.remove();
}

function placeNova(): void {
  if (!input && head?.status !== 'live') return;
  anchor = placeAnchor(input?.current ?? head!.current);
  if (head) hasHardwareAnchor = true;
  tell('Nova’s direction is saved. Look away, then back.');
  logEvent('ANCHOR_PLACED', `Nova placed at ${anchor.yaw.toFixed(1)}° yaw, ${anchor.pitch.toFixed(1)}° pitch.`);
}

function lookBack(): void {
  input?.set({ yaw: anchor.yaw, pitch: anchor.pitch });
}

function reset(): void {
  input?.set({ yaw: 0, pitch: 0 });
  anchor = placeAnchor({ yaw: 0, pitch: 0 });
  fov = 60;
  if (ui) ui.fov.value = '60';
  logEvent('SIMULATION_RESET', 'A fresh start. Nova’s anchor is back at 0°.');
}

function onShortcut(event: KeyboardEvent): void {
  if (event.repeat || isEditingControl(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!simulator) {
    const controls = [...document.querySelectorAll<HTMLButtonElement>('#hardware-controls button')].filter(button => !button.closest('[hidden]'));
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      controls[(index + direction + controls.length) % controls.length]?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const focused = controls.includes(document.activeElement as HTMLButtonElement) ? document.activeElement as HTMLButtonElement : controls[0];
      focused?.click();
    }
    return;
  }
  const hasNativeActivation = event.target instanceof HTMLElement
    && event.target.closest('button, a, summary') !== null;
  if (event.code === 'Space' && !hasNativeActivation) { event.preventDefault(); placeNova(); }
  if (event.key.toLowerCase() === 'r') lookBack();
  if (event.key === '0') reset();
  if (!hasNativeActivation && event.key === 'Enter') { event.preventDefault(); interact('pet'); }
  if (event.key.toLowerCase() === 'f') interact('feed');
  if (event.key.toLowerCase() === 'p') interact('play');
}

if (ui && input) {
  ui.yaw.addEventListener('input', () => input.set({ ...input.current, yaw: Number(ui.yaw.value) }));
  ui.pitch.addEventListener('input', () => input.set({ ...input.current, pitch: Number(ui.pitch.value) }));
  ui.fov.addEventListener('input', () => { fov = Number(ui.fov.value); });
  element('#turn-left').addEventListener('click', () => input.set({ ...input.current, yaw: input.current.yaw - 15 }));
  element('#turn-right').addEventListener('click', () => input.set({ ...input.current, yaw: input.current.yaw + 15 }));
  element('#place-anchor').addEventListener('click', placeNova);
  element('#return-to-anchor').addEventListener('click', lookBack);
  element('#reset').addEventListener('click', reset);
  element<HTMLInputElement>('#model-facing').addEventListener('input', (event) => { if (renderer) renderer.facing = Number((event.target as HTMLInputElement).value) * Math.PI / 180; });
}

window.addEventListener('keydown', onShortcut);

function tell(message: string): void {
  notice.textContent = message;
  notice.hidden = false;
  noticeUntil = elapsedSeconds + 4;
  if (simulator) element('#reaction-note').textContent = message;
}

function interact(action: CreatureAction): void {
  if (!renderer?.ready) { tell('Your character is still loading.'); return; }
  const result = session.perform(action, elapsedSeconds, currentProjection.visible && (simulator || hasHardwareAnchor));
  tell(result.message);
  if (result.accepted) {
    logEvent('INTERACTION', `${action}: ${session.bonds} connections this visit.`);
    if (simulator) element('#bond-count').textContent = `${session.bonds} connection${session.bonds === 1 ? '' : 's'} this visit`;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  button.addEventListener('click', () => interact(button.dataset.action as CreatureAction));
}
canvas.addEventListener('click', (event) => {
  if (!simulator || !currentProjection.visible) return;
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * 600 / bounds.width;
  const y = (event.clientY - bounds.top) * 600 / bounds.height;
  if (Math.hypot(x - currentProjection.x, y - currentProjection.y) < 100) interact('pet');
});

if (head) {
  element('#tracking-start').addEventListener('click', () => {
    hasHardwareAnchor = false;
    void head.start();
    lastTrackingState = '';
  });
  element('#calibrate').addEventListener('click', () => {
    const error = head.tracker.confirm(performance.now());
    if (error) tell(error);
    else if (head.tracker.step === 'done') placeNova();
    lastTrackingState = '';
  });
  element('#move-here').addEventListener('click', placeNova);
  element('#tracking-start').focus();
}

function updateHardware(): void {
  if (!head) return;
  const status = head.status;
  const step = head.tracker.step;
  // A sensor stream may restart with a new reference frame. Never silently reuse an old anchor.
  if (status === 'stale' && hasHardwareAnchor) hasHardwareAnchor = false;
  const direction = Math.abs(currentProjection.deltaYaw) > Math.abs(currentProjection.deltaPitch) ? currentProjection.deltaYaw > 0 ? 'right' : 'left' : currentProjection.deltaPitch > 0 ? 'above' : 'below';
  const key = `${status}:${step}:${hasHardwareAnchor}:${currentProjection.visible}:${direction}`;
  if (key === lastTrackingState) return;
  lastTrackingState = key;
  const start = element<HTMLButtonElement>('#tracking-start');
  const calibrate = element<HTMLButtonElement>('#calibrate');
  const actions = element('#hardware-actions');
  element('#calibration-guides').hidden = hasHardwareAnchor || step === 'place';
  const needsRestart = step === 'done' && !hasHardwareAnchor;
  start.hidden = status === 'live' && !needsRestart || status === 'waiting';
  start.textContent = status === 'off' ? 'Enable head tracking' : 'Restart head tracking';
  calibrate.hidden = status !== 'live' || step === 'done';
  actions.hidden = status !== 'live' || !hasHardwareAnchor;
  let message = '';
  if (status === 'off') message = 'Center a fixed, distant point on the middle +. Then pinch Enable.';
  if (status === 'waiting') message = 'Waiting for head motion…';
  if (status === 'denied') message = 'Motion permission denied. Allow it in the app permissions, then retry.';
  if (status === 'unavailable') message = 'No head-motion data received. Open this on the glasses, then retry.';
  if (status === 'stale' || needsRestart) message = 'Tracking paused. Pinch Restart to calibrate again.';
  if (status === 'live' && !needsRestart) {
    if (step === 'right') { message = '1 / 3 · Turn RIGHT until that same point reaches the left +. Then pinch.'; calibrate.textContent = 'Confirm right turn'; }
    if (step === 'up') { message = '2 / 3 · Recenter that point. Tilt UP until it reaches the bottom +, then pinch.'; calibrate.textContent = 'Confirm upward tilt'; }
    if (step === 'place') { message = '3 / 3 · Look where Nova should sit, then pinch.'; calibrate.textContent = 'Place Nova here'; }
    if (hasHardwareAnchor) message = currentProjection.visible ? 'Direction saved · Swipe to choose · Pinch to interact' : `Nova is ${direction}. Look back, or choose Move here.`;
  }
  if (message !== lastHardwareMessage) { element('#tracking-note').textContent = message; lastHardwareMessage = message; }
  // Keep activation on a visible element as setup transitions into the action rail.
  if (document.activeElement === document.body || document.activeElement?.closest('[hidden]')) {
    (hasHardwareAnchor && status === 'live' ? actions.querySelector('button') : !calibrate.hidden ? calibrate : !start.hidden ? start : null)?.focus();
  }
}

function updateUi(projection: AnchorProjection): void {
  if (!ui || !input) return;
  const orientation = input.current;
  ui.yaw.value = String(orientation.yaw);
  ui.pitch.value = String(orientation.pitch);
  ui.yawValue.value = `${orientation.yaw.toFixed(1)}°`;
  ui.pitchValue.value = `${orientation.pitch.toFixed(1)}°`;
  ui.fovValue.value = `${fov}°`;
  ui.anchorValue.textContent = `${anchor.yaw.toFixed(1)}°`;
  ui.offset.textContent = `${projection.deltaYaw.toFixed(1)}°`;
  ui.position.textContent = projection.visible ? `${Math.round(projection.x)}, ${Math.round(projection.y)}` : 'Outside view';
  ui.confidence.textContent = `${anchor.confidence.toFixed(2)} · simulated`;
  ui.fps.textContent = `${fps} fps`;
  ui.headingCone.style.transform = `rotate(${orientation.yaw}deg)`;
  ui.headingCone.style.setProperty('--fov', `${fov}deg`);
  ui.anchorBearing.style.transform = `rotate(${anchor.yaw}deg)`;
  ui.status.textContent = projection.visible ? 'In view' : 'Out of view';
  ui.status.classList.toggle('out-of-view', !projection.visible);
}

function showError(message: string): void {
  running = false;
  cancelAnimationFrame(animationId);
  errorMessage.textContent = message;
  errorMessage.hidden = false;
  canvas.hidden = true;
  if (ui) { ui.status.textContent = 'Renderer unavailable'; ui.status.classList.add('out-of-view'); }
  logEvent('RENDER_ERROR', message);
}

function animate(time: number): void {
  animationId = 0;
  if (!running || !renderer) return;
  const delta = Math.min((time - previousTime) / 1000, 0.05);
  previousTime = time;
  elapsedSeconds += delta;
  input?.update(delta);
  const projection = projectAnchor(anchor, input?.current ?? head?.current ?? { yaw: 0, pitch: 0 }, head?.tracker.horizontalFov ?? fov, head?.tracker.verticalFov ?? fov);
  if (head && (!hasHardwareAnchor || head.status !== 'live')) projection.visible = false;
  currentProjection = projection;
  if (!loading && elapsedSeconds > noticeUntil) notice.hidden = true;
  if (projection.visible !== previousVisibility) {
    logEvent(projection.visible ? 'ANCHOR_VISIBLE' : 'ANCHOR_LOST', projection.visible
      ? 'Nova is in view. Same anchor, same little friend.'
      : 'Nova is out of view. Her anchor stays right where it was.');
    previousVisibility = projection.visible;
    canvas.setAttribute('aria-label', projection.visible ? 'Nova, your 3D character on a black display' : 'Black display. Nova is outside view or tracking is not ready.');
  }
  try { renderer.render(elapsedSeconds, projection, session.active(elapsedSeconds)); }
  catch (error) { console.error(error); showError('The display could not render. Reload to try again.'); return; }
  frames += 1;
  if (time - fpsWindow >= 1000) { fps = Math.round(frames * 1000 / (time - fpsWindow)); frames = 0; fpsWindow = time; }
  if (time - lastUiUpdate > 50) { updateHardware(); updateUi(projection); lastUiUpdate = time; }
  scheduleFrame();
}

function onContextLost(event: Event): void {
  event.preventDefault();
  showError('Graphics connection lost. Reload this page to bring Nova back.');
}
canvas.addEventListener('webglcontextlost', onContextLost);

function scheduleFrame(): void {
  if (running && !document.hidden && !pageSuspended && animationId === 0) {
    animationId = requestAnimationFrame(animate);
  }
}

function pauseFrames(): void {
  cancelAnimationFrame(animationId);
  animationId = 0;
  input?.stopTurning();
}

function resumeFrames(): void {
  previousTime = performance.now();
  fpsWindow = previousTime;
  frames = 0;
  scheduleFrame();
}

try {
  renderer = new NovaRenderer(canvas);
  void renderer.load().then(() => {
    if (!running) return;
    loading = false;
    tell(simulator ? 'Nova is here. Try Pet, Feed, or Play.' : 'Your character is ready. Enable head tracking to place Nova.');
    logEvent('MODEL_READY', 'Your GLB character is ready.');
  }).catch((error: unknown) => {
    if (!running) return;
    console.error(error);
    showError('The character could not load. Check your connection and reload.');
  });
  scheduleFrame();
} catch (error) {
  console.error(error);
  showError('Nova needs WebGL 2. Enable browser graphics acceleration, then reload.');
}

function onVisibilityChange(): void {
  if (document.hidden) { pauseFrames(); head?.stop(); hasHardwareAnchor = false; }
  else resumeFrames();
}
document.addEventListener('visibilitychange', onVisibilityChange);

function onPageHide(event: PageTransitionEvent): void {
  pageSuspended = true;
  head?.stop();
  hasHardwareAnchor = false;
  if (event.persisted) pauseFrames();
  else dispose();
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted) { pageSuspended = false; resumeFrames(); }
}
window.addEventListener('pagehide', onPageHide);
window.addEventListener('pageshow', onPageShow);

function dispose(): void {
  running = false;
  pauseFrames();
  canvas.removeEventListener('webglcontextlost', onContextLost);
  input?.dispose();
  head?.stop();
  renderer?.dispose();
  window.removeEventListener('keydown', onShortcut);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
  document.removeEventListener('visibilitychange', onVisibilityChange);
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
