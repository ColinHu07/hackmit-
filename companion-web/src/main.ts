import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './style.css';
import { LocalWeather } from './LocalWeather';
import { beaverMoodFace } from './BeaverMoodFace';
import { readMood, moodValue, happinessState, SAD_HAPPINESS_THRESHOLD } from './PetMood';
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
import { DeviceView } from './DeviceView';
import { QUEST_REWARD, QUEST_COOLDOWN_MS } from '../../shared/quest-rewards.mjs';
import { evidenceReadiness } from './EvidenceReadiness';
import { TreatCooldown, formatTreatTime } from './TreatCooldown';
import { createInviteUrl, defaultPlayServerUrl, nativeServerSelection } from './WebConnection';
import type { LocationFix } from './LocationDiscovery';
import type { NearbyPet, MeetRequest } from '../../shared/nearby-protocol';
import type { ConnectionState, Membership, CompatibleSnapshot } from './RoomClient';
import { PLAY_TOGETHER_DISTANCE, PLAY_WORLD_LIMIT, type QuestReward, type EvidenceQuestId, type PetActionKind, type PlayerQuests } from '../../shared/play-protocol';

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
  quest: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="m10 14 4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 8a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.leaf}</svg>`;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="site-header">
    <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Kith home"><span class="brand-mark">${icon('leaf')}</span>kith</a>
    <div class="header-right"><span class="edition">A LITTLE CLOSER, TOGETHER</span><button class="icon-button" id="server-settings" aria-label="Admin control" title="Admin control">${icon('settings')}</button></div>
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
        <p id="walking-compatibility" class="room-description" role="status" hidden>Long-distance walking needs a server update. Until then, pets stop at the edge of the small playground.</p>
        <div class="roster" id="roster" aria-label="Players"></div>
        <div id="dap-quest" class="quest-card dap-card" hidden><div class="quest-header"><span class="quest-symbol">${icon('wave')}</span><div><span class="small-label">MEET IN REAL LIFE</span><h2>Dap them up</h2></div></div><p>Walk over, introduce yourselves, and share a dap, high-five, or wave.</p><button class="primary-button" id="confirm-dap">We said hello ${icon('check')}</button><p id="dap-status" role="status">Both players confirm after meeting in person.</p></div>
        <p id="server-compatibility" class="room-description" role="status" hidden>This server runs an older game version. You can meet, move, wave, feed, jump, and play together. New quests and sharing compass turns need a server update.</p><button id="meet-button" class="text-button" disabled>Meet in the middle ${icon('arrow')}</button><div class="quest-card" id="modern-quests">
          <div class="quest-header"><span class="quest-symbol">${icon('play')}</span><div><span class="small-label">YOUR QUEST BOARD</span><h2>Grow your little world</h2></div><span class="quest-count" id="quest-count">0/5</span></div>
          <ol class="quest-list"><li id="quest-touch-grass"><span class="quest-tick">${icon('check')}</span><span><strong>Solo · touch grass <em class="verification-tag" id="touch-grass-tag">PHOTO CHECK</em></strong><small>Submit a photo or clip of your hand touching natural grass.</small></span></li><li id="quest-meet-friend"><span class="quest-tick">${icon('check')}</span><span><strong>Duo · meet another user</strong><small id="duo-status">Bring a second pet into the pen, then meet nearby.</small></span></li><li id="quest-dap-handshake"><span class="quest-tick">${icon('check')}</span><span><strong>Duo · dap up</strong><small id="dap-handshake-status">Stand close to a pet and both tap Dap up within a few seconds.</small></span></li><li id="quest-squad-circle"><span class="quest-tick">${icon('check')}</span><span><strong>Squad · circle up</strong><small id="squad-status">Needs three connected pets in the pen.</small></span></li><li id="quest-raid-boss"><span class="quest-tick">${icon('check')}</span><span><strong>Raid · calm Mossback</strong><small id="raid-quest-status">Complete the squad circle to call the meadow’s tangled guardian.</small></span></li></ol>
          <button id="ready-squad" class="text-button" hidden disabled>Ready for squad circle ${icon('arrow')}</button><button id="verify-touch-grass" class="text-button" hidden>Verify touch grass photo ${icon('arrow')}</button><input id="touch-grass-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden /><p id="photo-verification-status" class="photo-verification-status" role="status" hidden></p>
        </div>
        <div class="quest-card raid-card" id="raid-card"><div class="quest-header"><span class="quest-symbol">✦</span><div><span class="small-label">SQUAD RAID · 3–4 PETS</span><h2>Mossback, Keeper of the Pen</h2></div></div><p id="raid-description">A gentle guardian’s vine magic has tangled up. Gather a completed squad close together, then calm it with your pets’ actions.</p><div class="raid-health"><span id="raid-health-label">Mossback is resting</span><meter id="raid-health-meter" min="0" max="1" value="0"></meter></div><button id="ready-raid" class="primary-button" disabled>Call Mossback ${icon('arrow')}</button></div>
        <button id="leave-button" class="leave-button">Leave playground</button>
      </div>
      <div id="error-message" class="error-message" role="alert" hidden></div>
      <details id="server-pulse" class="server-pulse" hidden><summary>Multiplayer server</summary><p id="server-pulse-status">Checking server…</p><p>Up to 4 players per room. Start more rooms to test a larger group.</p></details>
    </section>
    <section class="playground-panel" aria-label="Your local world">
      <div class="scene-topline"><div class="scene-title">${icon('leaf')} <span id="world-title">AROUND YOU</span></div><div class="scene-topline-actions"><button id="zoom-out-button" class="zoom-out-button" type="button" hidden>Zoom out</button><div id="connection-status" class="connection-status" data-state="idle"><span></span><span id="connection-label">Pet preview</span></div></div></div>
      <div class="weather-line"><span id="weather-status" role="status">Allow location for your local weather</span><button id="local-weather" class="text-button" hidden title="Uses your location once; sends rounded coordinates to Open-Meteo for weather">Use my local weather</button></div><div class="scene" id="scene"><canvas id="playground" tabindex="0" aria-label="Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move."></canvas><aside class="status-effects" aria-label="Pet status effects"><span class="status-effects-title">PET STATUS</span><div class="status-effect"><span class="status-effect-icon">${icon('heart')}</span><span><strong>Happiness</strong><small id="effect-mood">70% · Content</small></span></div><div class="status-effect"><span class="status-effect-icon">${icon('leaf')}</span><span><strong>Local sky</strong><small id="effect-weather">Weather unavailable</small></span></div><div class="status-effect" id="effect-bond-row" hidden><span class="status-effect-icon">${icon('people')}</span><span><strong>Bond</strong><small id="effect-bond">0 shared moments</small></span></div></aside><div id="treat-timer" class="treat-timer" role="img" aria-label="Treat cooldown" hidden><svg class="treat-timer-donut" viewBox="0 0 48 48" aria-hidden="true"><circle class="treat-timer-track" cx="24" cy="24" r="20"/><circle class="treat-timer-ring" cx="24" cy="24" r="20" pathLength="100"/></svg><span class="treat-timer-berry" aria-hidden="true">🫐</span><span class="treat-timer-count" aria-hidden="true"></span></div><div id="scene-loading" class="scene-loading"><span class="loading-dot"></span>Waking up Nova…</div></div>
      <div class="mood-card" id="mood-card"><div class="mood-heading"><strong>${icon('heart')} Your pet’s happiness</strong><span id="mood-label"></span></div><div id="mood-meter" class="mood-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="70" aria-label="Pet happiness" aria-describedby="mood-threshold-note mood-note" style="--sad-threshold:${SAD_HAPPINESS_THRESHOLD}%"><span class="mood-fill"><span id="mood-marker" class="mood-marker" aria-hidden="true">${beaverMoodFace(70)}</span></span><span class="mood-threshold" aria-hidden="true"></span></div><p id="mood-threshold-note" class="mood-threshold-note">Sad below ${SAD_HAPPINESS_THRESHOLD}%</p><p id="mood-note">Berries add 3% happiness over three bites. Normally, happiness drops 1% every minute.</p></div>
      <section class="berry-bag" id="survival-card" aria-label="Your treats">
        <div class="berry-bag-heading"><div class="berry-balance"><span class="berry-bag-icon" aria-hidden="true">🫐</span><div><span class="small-label">YOUR TREATS</span><strong><span id="berry-count">—</span> <span class="berry-unit">berries</span></strong></div></div><button id="health-treat" class="health-treat" data-action="feed" type="button">Give a berry</button></div>
        <p id="treat-cooldown" class="treat-cooldown" role="status"></p>
        <p class="quest-reward-preview">Verified quest: +${QUEST_REWARD.happiness}% happiness · +${QUEST_REWARD.berries} berries · +${QUEST_REWARD.points} points</p>
        <p id="quest-reward-notice" class="quest-reward-notice" role="status" hidden></p>
        <p id="treat-boost-notice" role="status" hidden></p>
        <details class="pet-stats"><summary>Pet stats · <span id="survival-points">0 points</span></summary><meter id="health-meter" min="0" max="100" value="100" aria-label="Pet health"></meter><p id="survival-stats">Connect to load your pet’s stats.</p><p id="food-inventory"></p></details>
      </section>
      <div class="scene-caption" id="scene-caption"><span class="caption-star">✳</span> Small paws. Big adventures.</div>
      <div class="play-controls" id="play-controls" hidden>
        <div class="moment-line"><span id="scene-hint">Tap the ground to move your pet.</span><span class="bond-counter">${icon('heart')}<span id="bond-count">0</span><span class="bond-word">moments</span></span></div>
        <div class="action-bar action-bar-five"><button data-action="wave">${icon('wave')}<span>Wave</span></button><button data-action="feed">${icon('treat')}<span>Treat</span></button><button data-action="jump">${icon('jump')}<span>Jump</span></button><button data-action="play" class="co-op-action">${icon('play')}<span>Play together</span></button><button id="quest-button" class="co-op-action" type="button" disabled>${icon('quest')}<span>Quests</span></button></div>
        <p class="action-notice" id="action-notice" role="status" aria-live="polite">Your little adventure starts here.</p>
      </div>
      <section id="compact-quests" class="compact-quests" aria-label="Quest board"><h2>Quests</h2><div id="quest-board-list" class="compact-quest-list"></div></section>
      <div id="native-tools" class="native-tools" hidden>
        <div class="native-walking-heading"><strong id="view-title">Walk with your pet</strong><span id="compass-reading">Compass off</span></div>
        <p id="walking-status" role="status">Your pet follows your location. Turn or tilt your device to look around.</p>
        <div class="movement-controls" aria-label="Move your pet"><button data-move="forward" aria-label="Move forward">↑</button><button data-move="left" aria-label="Move left">←</button><button data-move="back" aria-label="Move backward">↓</button><button data-move="right" aria-label="Move right">→</button><button id="recenter-view">Recenter view</button></div>
      </div>
      <div id="browser-view-tools" class="native-tools" hidden><div class="native-walking-heading"><strong>Your pet’s view</strong><span id="browser-compass-status">Facing forward</span></div><p>Your pet stays in the middle. On mobile, location moves your pet and the compass turns the view. Desktop players can use the ground or arrow keys to move.</p><p id="browser-walking-status" role="status">Walking is off · tap to move, or enable walking on your phone.</p><div class="native-buttons"><button id="enable-compass">Enable phone compass</button><button id="enable-walking">Enable walking</button></div></div>
      <section id="quest-tools" class="native-tools quest-tools" aria-label="Quest clips" hidden>
        <div class="native-walking-heading evidence-heading"><strong>Quest clip</strong></div>
        <div class="evidence-selector"><label for="evidence-quest">Quest to verify</label><select id="evidence-quest"><option value="touchGrass">Solo · touch grass</option><option value="meetFriend">Duo · say hello</option><option value="dapHandshake">Duo · handshake / dap</option><option value="squadCircle">Squad · circle and cheer</option></select></div>
        <div class="evidence-prerequisite"><p id="evidence-prerequisite-status" role="status"></p></div>
        <p id="evidence-instructions">Show your hand touching natural grass outdoors.</p>
        <div class="native-buttons"><button id="record-clip">Record clip</button><button id="retake-clip">Retake</button></div>
        <p id="recording-status" role="status">Record a 1–10 second clip.</p>
        <label class="evidence-consent"><input id="evidence-consent" type="checkbox" /> Everyone shown agrees to submit this evidence for grading.</label>
        <div class="native-buttons"><button id="submit-clip">Submit</button><button id="submit-photo">Choose photo</button></div>
        <p id="evidence-status" role="status">Submit clip for grading</p>
      </section>

    </section>
  </main>

  <details class="app-credits"><summary>Credits</summary><p>Weather data: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></p></details>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <dialog id="quest-dialog" class="quest-dialog" aria-labelledby="quest-dialog-title">
    <div class="dialog-heading"><div><span id="quest-dialog-category" class="small-label">SHARED ADVENTURES</span><h2 id="quest-dialog-title">Choose a quest</h2></div><button class="icon-button" type="button" id="close-quests" aria-label="Close quests">${icon('close')}</button></div>
    <div class="quest-dialog-body">
    <p id="quest-dialog-intro">Pick a solo adventure or a shared challenge to see what you need to do.</p>
    <div id="quest-catalog" class="quest-catalog" aria-label="Available quests"></div>
    <section id="raid-detail" hidden><button type="button" id="raid-back" class="text-button">${icon('arrow')} All quests</button><p class="quest-reward-preview">Group prize: +5 shared moments.</p></section>
    <section id="quest-detail" class="quest-detail" hidden>
      <button type="button" id="quest-back" class="text-button">${icon('arrow')} All quests</button>
      <p id="quest-detail-requirements"></p><p class="quest-reward-preview">Reward: +${QUEST_REWARD.happiness}% happiness · +${QUEST_REWARD.berries} berries · +${QUEST_REWARD.points} points. Repeat after ${QUEST_COOLDOWN_MS / 1000}s for this demo.</p>
      <p id="quest-detail-status" class="photo-verification-status" role="status">Record or submit a saved clip when your group is in the pen.</p>
    </section>
    </div>
  </dialog>
  <dialog id="zoom-dialog" class="quest-dialog zoom-dialog" aria-labelledby="zoom-dialog-title">
    <div class="dialog-heading"><div><span class="small-label">BEYOND THE PEN</span><h2 id="zoom-dialog-title">Nearby beavers</h2></div><button class="icon-button" type="button" id="close-zoom" aria-label="Close nearby view">${icon('close')}</button></div>
    <p>Zoom out to see beavers playing nearby. Distances are approximate and locations are never shown.</p>
    <label class="nearby-visibility"><input id="nearby-visibility" type="checkbox" checked /> Let nearby players find my beaver while I’m zoomed out</label>
    <p id="zoom-status" class="photo-verification-status" role="status">Nearby discovery is off until you share your location.</p>
    <div id="zoom-nearby-list" class="nearby-list" aria-label="Nearby beavers"></div>
  </dialog>
  <dialog id="settings-dialog" aria-labelledby="admin-title"><div class="dialog-heading"><h2 id="admin-title">Admin control</h2><button class="icon-button" type="button" id="close-settings" aria-label="Close admin control">${icon('close')}</button></div>
    <p class="admin-intro">Demo controls for your pet. Drag a slider to save its value.</p>
    <div id="admin-controls">
      <label class="admin-slider" for="admin-berries"><span>Berries <output id="admin-berries-value"></output></span><input id="admin-berries" type="range" min="0" max="999" step="1" data-admin="berries" /></label>
      <label class="admin-slider" for="admin-happiness"><span>Happiness <output id="admin-happiness-value"></output></span><input id="admin-happiness" type="range" min="0" max="100" step="1" data-admin="happiness" /></label>
      <label class="admin-slider" for="admin-treat"><span>Berry cooldown remaining <output id="admin-treat-value"></output></span><input id="admin-treat" type="range" min="0" max="3600" step="1" data-admin="treatCooldownMs" /></label>
      <button type="button" class="admin-reset" data-reset="admin-treat">Allow a berry now</button>
      <label class="admin-slider" for="admin-quests"><span>Quest cooldown remaining <output id="admin-quests-value"></output></span><input id="admin-quests" type="range" min="0" max="60" step="1" data-admin="questCooldownMs" /></label>
      <button type="button" class="admin-reset" data-reset="admin-quests">Reset my quest cooldowns</button>
      <p class="admin-note">Quest control applies to all four camera quests for your pet. A partner’s active cooldown still applies. New completions use the normal demo cooldown.</p>
    </div><p id="admin-status" role="status"></p>
    <details class="admin-server"><summary>Server settings</summary><form id="settings-form"><p>Both phones connect to the same multiplayer server. Use the address from your host.</p><label for="server-url">Multiplayer server URL</label><input id="server-url" type="url" spellcheck="false" autocapitalize="off" placeholder="wss://your-server.example/play" required /><p class="settings-note">On the same Wi-Fi, use your computer's network address and port 8788. A hosted HTTPS app needs a secure wss:// server.</p><p class="error-message" id="settings-error" hidden></p><button class="primary-button" type="submit">Save server ${icon('check')}</button></form></details></dialog>
`;

function el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }
// Keep optional controls in Settings; the playground ends at the quest board.
const settingsExtras = document.createElement('details');
settingsExtras.className = 'settings-extras';
settingsExtras.innerHTML = '<summary>Movement controls & credits</summary>';
el('settings-dialog').append(settingsExtras);
settingsExtras.append(el('native-tools'), el('browser-view-tools'), document.querySelector('.app-credits')!);
el('quest-detail').append(el('quest-tools'));
el('raid-detail').append(el('raid-card'));
el('action-notice').hidden = true;
el('survival-card').before(el('play-controls'));

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
const mobileMovement = isNativePhone() || window.matchMedia('(pointer: coarse)').matches;
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
const deviceView = new DeviceView();
let stepSensorAvailable = false;
let browserWalkingEnabled = false;
let walkingSteps = 0;
let ready = false;
let connection: ConnectionState = 'idle';
let syncWalkingOnSnapshot = false;
let membership: Membership | null = null;
let snapshot: CompatibleSnapshot | null = null;
let playground: Playground | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let lastRoster = '';
let lastNotice = '';
let nearbyActive = false;
let zoomOutActive = false;
let zoomSharing = false;
let locationActive = false;
let discoveryConnected = false;
let nearbyPeers: NearbyPet[] = [];
let pendingMeet: (MeetRequest & { incoming: boolean }) | null = null;
let nearbyListKey = '';
const nearbyOptOutKey = 'bondimals:nearby-opt-out';
let photoVerificationPending = false;
const canvas = el<HTMLCanvasElement>('playground');
const treatTimer = new TreatCooldown(el('treat-timer'));
const nameInput = el<HTMLInputElement>('player-name');
const codeInput = el<HTMLInputElement>('room-input');
nameInput.value = stored('bondimals:name') || 'Explorer';
codeInput.value = (params.get('room') || '').toUpperCase().slice(0, 6);

let mood = readMood(stored('bondimals:mood'));
save('bondimals:mood', JSON.stringify(mood));
function renderMood(): void {
  const care = snapshot?.players.find(player => player.id === membership?.playerId)?.survival;
  const happiness = care?.happiness ?? moodValue(mood);
  const value = Math.round(happiness * 10) / 10;
  const meter = el('mood-meter');
  meter.style.setProperty('--happiness', `${happiness}%`);
  meter.setAttribute('aria-valuenow', String(value));
  const state = happinessState(happiness);
  const label = happiness < 25 ? 'Sad' : happiness < 45 ? 'A little sad' : happiness < 65 ? 'Content' : happiness < 85 ? 'Happy' : 'Joyful';
  el('mood-marker').innerHTML = beaverMoodFace(happiness);
  meter.setAttribute('aria-valuetext', `${value}% · ${label}`);
  el('effect-mood').textContent = `${value}% · ${label}`;
  el('mood-label').textContent = `${value}% · ${label}`;
  playground?.setHappiness(happiness);
  el('mood-card')?.setAttribute('data-mood-state', state);
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

let lastRewardEvent = '';
function questRewardText(reward: QuestReward): string {
  return `Rewards received: +${Math.round(reward.happiness * 100) / 100}% happiness · +${reward.berries} berries · +${reward.points} points${reward.happiness < QUEST_REWARD.happiness ? ' (happiness capped at 100%)' : ''}.`;
}
function renderQuestReward(reward: QuestReward | null | undefined, serverTime: number): void {
  const notice = el('quest-reward-notice');
  notice.hidden = !reward;
  if (!reward) return;
  const message = questRewardText(reward);
  if (notice.textContent !== message) notice.textContent = message;
  if (lastRewardEvent !== reward.eventId) {
    lastRewardEvent = reward.eventId;
    if (serverTime - reward.completedAt < 15_000) toast(message);
  }
}
function toast(message: string): void {
  clearTimeout(toastTimer);
  const notice = el('toast');
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
  notice.classList.toggle('dialog-toast', !!dialog);
  if (dialog) {
    // A modal's top layer sits above every document z-index and its backdrop.
    // Place the notice inside that layer, ahead of the scrollable body.
    const body = dialog.querySelector('.quest-dialog-body');
    dialog.insertBefore(notice, body);
  } else el('app').append(notice);
  notice.textContent = message;
  notice.hidden = false;
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
    el('home-intro').textContent = 'Use the same server on both devices. Your pets appear together automatically.';
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
  const playNear = !!local && friends.some(other => Math.hypot(local.x - other.x, local.z - other.z) <= PLAY_TOGETHER_DISTANCE);
  const connected = connection === 'connected';
  playground?.setEnabled(ready && (nearbyActive ? locationActive && discoveryConnected : connected));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    const survival = local?.survival;
    const unavailableTreat = button.dataset.action === 'feed' && !!survival && ((survival.inventory.berry ?? 0) < 1 || survival.treatCooldownMs > 0);
    button.disabled = !connected || !!local?.action || unavailableTreat || (button.dataset.action === 'play' && !playNear) || (button.dataset.action === 'dap' && !near);
  });
  el<HTMLButtonElement>('quest-button').disabled = !connected || !local;
  document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => { button.disabled = mobileMovement || !connected || !local; });
  el<HTMLButtonElement>('quest-button').disabled = !connected || !local;
  el<HTMLButtonElement>('zoom-out-button').hidden = !membership || !connected || nearbyActive;
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
    : playNear ? 'You’re close! Wave hello or play together.' : 'Walk closer to another pet to play together.';
  updateQuestDetail();
  updateEvidenceReadiness();
}
function setConnection(state: ConnectionState): void {
  connection = state;
  syncWalkingOnSnapshot = state === 'connected';
  const labels: Record<ConnectionState, string> = { idle: 'Pet preview', connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline' };
  el('connection-status').dataset.state = state;
  el('connection-label').textContent = labels[state];
  el<HTMLButtonElement>('server-settings').disabled = false;
  updateEntry();
  updateControls();
  // Local sensors and the preview keep working even when a server rejects a
  // join or disconnects. Only visibility/permission/user actions pause walking.
  startWalking();
  if (walking) playground?.setWalkingPose(walkingTracker.pose, false, state !== 'connected');
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
    walkingTracker.setWorldLimit(next.worldLimit ?? 3);
    el('walking-compatibility').hidden = (next.worldLimit ?? 3) >= PLAY_WORLD_LIMIT;
    el('server-compatibility').hidden = !next.legacyServer;
    for (const id of ['modern-quests', 'raid-card', 'quest-tools']) el(id).hidden = !!next.legacyServer;
    el<HTMLButtonElement>('quest-button').hidden = !!next.legacyServer;
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
    for (const [questId, statusId] of [['meetFriend', 'duo-status'], ['dapHandshake', 'dap-handshake-status'], ['squadCircle', 'squad-status']] as const) {
      el(statusId).textContent = evidenceReadiness(questId, next, member.playerId, true).message;
    }
    el('ready-squad').hidden = true;
    const photoStatus = quests.photoVerification.touchGrass;
    const photoButton = el<HTMLButtonElement>('verify-touch-grass');
    photoButton.hidden = photoStatus === 'approved';
    photoButton.disabled = photoVerificationPending || photoStatus === 'pending';
    photoButton.textContent = photoStatus === 'pending' || photoVerificationPending ? 'Checking photo…' : photoStatus === 'rejected' ? 'Try another grass photo →' : 'Verify touch grass photo →';
    el('touch-grass-tag').classList.toggle('verified', photoStatus === 'approved');
    const photoMessage = el('photo-verification-status');
    photoMessage.hidden = photoStatus === 'approved';
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
    renderMood();
    el('bond-count').textContent = String(next.bond);
    const survivalPlayer = next.players.find(player => player.id === member.playerId);
    const survival = survivalPlayer?.survival;
    treatTimer.update(survival?.treatCooldownMs ?? 0);
    if (survival) {
      el<HTMLMeterElement>('health-meter').value = survival.health;
      el('survival-points').textContent = `${survival.points} points · ${survival.survivalHours}h alive`;
      el('survival-stats').textContent = `Health ${survival.health}% · Hunger ${survival.hunger}% · Happiness ${survival.happiness}%`;
      el('berry-count').textContent = String(survival.inventory.berry ?? 0);
      renderQuestReward(survival.lastQuestReward, next.serverTime);
      el('food-inventory').textContent = `Food: ${Object.entries(survival.inventory).map(([food, quantity]) => `${food} ${quantity}`).join(' · ')}`;
      const cooldown = survival.treatCooldownMs;
      const cooldownLabel = formatTreatTime(cooldown);
      const boostNotice = el('treat-boost-notice');
      boostNotice.hidden = cooldown <= 0;
      const boostText = cooldown > 0 ? 'Berry boost: losing 1% happiness now takes 1.5× longer — 90 seconds instead of 60 — while the cooldown is active. You can have another berry when the timer ends.' : '';
      if (boostNotice.textContent !== boostText) boostNotice.textContent = boostText;
      const berries = survival.inventory.berry ?? 0;
      el('treat-cooldown').textContent = cooldown > 0 ? `Treat ready in ${cooldownLabel}` : berries > 0 ? 'Treat ready' : 'Out of berries';
      el<HTMLButtonElement>('health-treat').textContent = cooldown > 0 ? `Ready in ${cooldownLabel}` : 'Give a berry';
    }
    el('effect-bond').textContent = `${next.bond} shared ${next.bond === 1 ? 'moment' : 'moments'}`;
    el('effect-bond-row').hidden = false;
    if (next.notice && next.notice !== lastNotice) {
      lastNotice = next.notice;
      el('action-notice').textContent = next.notice;
    }
    playground?.update(next, member.playerId);
    if (walking) playground?.setWalkingPose(walkingTracker.pose, false, connection !== 'connected');
    if (entering) startWalking();
    // Send offline steps only after welcome confirms this is the same pet.
    // An expired session must start from its newly assigned spawn instead.
    if (syncWalkingOnSnapshot && !entering) publishWalking(true);
    syncWalkingOnSnapshot = false;
    updateControls();
    if (entering) {
      el('error-message').hidden = true;
      canvas.setAttribute('aria-label', mobileMovement ? 'Pet playground. Walk with your device to move; turn or tilt to look around.' : 'Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move.');
      if (!next.encounter) el('copy-code').focus();
    }
  },
});

function renderZoomNearby(): void {
  const list = el('zoom-nearby-list');
  list.replaceChildren();
  if (!zoomSharing) {
    const empty = document.createElement('div'); empty.className = 'nearby-empty';
    empty.innerHTML = `${icon('leaf')}<strong>You are hidden</strong><p>Turn on sharing above when you want nearby beavers to find you.</p>`;
    list.append(empty); return;
  }
  if (!nearbyPeers.length) {
    const empty = document.createElement('div'); empty.className = 'nearby-empty';
    empty.innerHTML = `${icon('leaf')}<strong>No beavers nearby yet</strong><p>Only approximate distances are shared. Keep this view open while discovery looks around.</p>`;
    list.append(empty); return;
  }
  for (const pet of nearbyPeers) {
    const item = document.createElement('div'); item.className = 'nearby-pet zoom-nearby-pet';
    const avatar = document.createElement('span'); avatar.className = 'player-avatar'; avatar.textContent = pet.name.slice(0, 1).toUpperCase();
    const text = document.createElement('span'); text.className = 'nearby-pet-text';
    const name = document.createElement('strong'); name.textContent = `${pet.name}’s beaver`;
    const distance = document.createElement('span'); distance.textContent = `${pet.distanceMeters === 0 ? 'Very close' : `About ${pet.distanceMeters} m away`}${pet.uncertain ? ' · estimated' : ''}`;
    text.append(name, distance); item.append(avatar, text); list.append(item);
  }
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
    empty.querySelector('p')!.textContent = locationActive ? 'Nearby players will appear here automatically. Both devices need nearby mode on and a fresh location.' : 'Resume when you’re ready to be discoverable again.';
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
function stopZoomOut(): void {
  if (!zoomOutActive) return;
  zoomOutActive = false; zoomSharing = false; nearbyPeers = [];
  playground?.setZoomedOut(false);
  nearbyClient.stop();
  if (!nearbyActive && !walking) locationTracker.stop();
  const dialog = el<HTMLDialogElement>('zoom-dialog'); if (dialog.open) dialog.close();
  el('zoom-nearby-list').replaceChildren();
  updateControls();
}
function startZoomOut(): void {
  if (!membership || connection !== 'connected' || nearbyActive) return;
  zoomOutActive = true;
  playground?.setZoomedOut(true);
  const optedOut = stored(nearbyOptOutKey) === 'true';
  zoomSharing = !optedOut;
  const checkbox = el<HTMLInputElement>('nearby-visibility'); checkbox.checked = zoomSharing;
  const dialog = el<HTMLDialogElement>('zoom-dialog'); if (!dialog.open) dialog.showModal();
  renderZoomNearby();
  if (!zoomSharing) {
    el('zoom-status').textContent = 'You are hidden from nearby discovery.';
    return;
  }
  el('zoom-status').textContent = 'Requesting location to find nearby beavers…';
  nearbyClient.start(serverUrl, nameInput.value.trim() || 'Explorer');
  locationTracker.start();
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
    if (zoomOutActive && !nearbyActive) {
      el('zoom-status').textContent = state === 'connected' ? 'Zoomed out · looking for nearby beavers.' : state === 'connecting' ? 'Connecting to nearby discovery…' : 'Nearby discovery is off.';
      return;
    }
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
  ready() { if (!locationActive && !zoomSharing) nearbyClient.pause(); renderNearby(); },
  nearby(peers, accuracy, notice) {
    if (zoomOutActive && !nearbyActive) {
      nearbyPeers = zoomSharing ? peers : [];
      el('zoom-status').textContent = zoomSharing ? notice : 'You are hidden from nearby discovery.';
      renderZoomNearby();
      return;
    }
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
  error(message) { if (zoomOutActive && !nearbyActive) { el('zoom-status').textContent = message; toast(message); } else if (nearbyActive) { el('location-status').textContent = message; toast(message); } },
});
const locationCallbacks = {
  fix(fix: LocationFix) { void weather.update(fix); if ((nearbyActive && locationActive) || (zoomOutActive && zoomSharing)) nearbyClient.location(fix); },
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
  canvas.setAttribute('aria-label', mobileMovement ? 'Pet playground. Walk with your device to move; turn or tilt to look around.' : 'Pet playground. Tap the ground to move your pet. When focused, use the arrow keys to move.');
  setConnection('idle');
}

el('entry-mode').addEventListener('click', () => { mode = mode === 'nearby' || mode === 'lobby' ? 'join' : 'lobby'; updateEntry(); });
el('nearby-mode').addEventListener('click', () => { mode = 'nearby'; updateEntry(); });
el('zoom-out-button').addEventListener('click', startZoomOut);
el('close-zoom').addEventListener('click', stopZoomOut);
el<HTMLDialogElement>('zoom-dialog').addEventListener('cancel', event => { event.preventDefault(); stopZoomOut(); });
el<HTMLInputElement>('nearby-visibility').addEventListener('change', event => {
  const checkbox = event.currentTarget as HTMLInputElement;
  save(nearbyOptOutKey, checkbox.checked ? 'false' : 'true');
  zoomSharing = checkbox.checked;
  if (!zoomOutActive) return;
  if (zoomSharing) {
    el('zoom-status').textContent = 'Requesting location to find nearby beavers…';
    nearbyClient.start(serverUrl, nameInput.value.trim() || 'Explorer');
    locationTracker.start();
  } else {
    nearbyClient.pause(); nearbyPeers = []; renderZoomNearby();
    el('zoom-status').textContent = 'You are hidden from nearby discovery.';
  }
});
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
  el<HTMLDialogElement>('quest-dialog').close();
  stopWalking();
  stopZoomOut();
  clearResume();
  if (snapshot?.publicLobby) save(lobbyTokenKey(), '');
  membership = null;
  snapshot = null;
  el('effect-bond-row').hidden = true;
  treatTimer.update(0);
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
    if (walking) walkingTracker.moveTo(x, z);
    client.move(x, z);
  }
});
el('ready-squad').addEventListener('click', () => { client.readySquadQuest(); });
el('ready-raid').addEventListener('click', () => { client.readyRaid(); el<HTMLDialogElement>('quest-dialog').close(); });
const touchGrassPhotoInput = el<HTMLInputElement>('touch-grass-photo');
const evidenceChoice = el<HTMLSelectElement>('evidence-quest');
const evidenceConsent = el<HTMLInputElement>('evidence-consent');
const evidenceInstructions: Record<EvidenceQuestId, string> = {
  touchGrass: 'Show your hand physically touching natural grass outdoors.',
  meetFriend: 'Show someone waving hello or a shared high-five. The other player may be behind the camera. Faces are not required.',
  dapHandshake: 'Record both hands approaching, making contact, and releasing. Use a clip, not a still photo.',
  squadCircle: 'Show everyone from your squad gathered in a circle with hands together or raised in a shared cheer.',
};
function selectedEvidence(): EvidenceQuestId { return evidenceChoice.value as EvidenceQuestId; }
function updateEvidenceChoice(): void {
  el('evidence-instructions').textContent = evidenceInstructions[selectedEvidence()];
  el<HTMLButtonElement>('submit-photo').disabled = photoVerificationPending || selectedEvidence() === 'dapHandshake';
  el('submit-photo').hidden = selectedEvidence() === 'dapHandshake';
  el('evidence-status').textContent = selectedEvidence() === 'dapHandshake' && !isNativePhone()
    ? 'Use the phone app to record and submit a handshake clip. A still photo cannot verify the motion.'
    : isNativePhone() ? 'Submit clip for grading' : 'Submit photo for grading';
  evidenceConsent.checked = false;
  updateEvidenceReadiness();
}
evidenceChoice.addEventListener('change', () => {
  updateEvidenceChoice();
  if (el<HTMLDialogElement>('quest-dialog').open) openQuestDetail(selectedEvidence());
});

const questDefinitions: { id: EvidenceQuestId; group: string; title: string; summary: string; requirements: string }[] = [
  { id: 'touchGrass', group: 'Solo', title: 'Touch grass', summary: 'Show your hand touching real grass.', requirements: 'Record a hand touching natural grass outdoors. You can submit as soon as you are connected.' },
  { id: 'meetFriend', group: 'Duo', title: 'Say hello', summary: 'Two pets in the pen; film someone waving hello.', requirements: 'Keep two players connected in the same pen, then submit someone waving hello. The other player can be behind the camera.' },
  { id: 'dapHandshake', group: 'Duo', title: 'Dap up', summary: 'Two pets in the pen; film hands meeting and releasing.', requirements: 'Keep two players connected in the same pen. Submit a clip of hands meeting and releasing.' },
  { id: 'squadCircle', group: 'Squad', title: 'Circle up', summary: 'Three or more pets; film a group circle or cheer.', requirements: 'Keep at least three players connected in the same pen, then submit the group circle or cheer.' },
];
let selectedQuest: EvidenceQuestId | null = null;
function questProgress(id: EvidenceQuestId): string {
  const local = membership && snapshot?.quests[membership.playerId];
  if (!local) return 'Join a shared pen to begin.';
  if (connection !== 'connected') return 'Reconnect to continue this quest.';
  if (local.photoVerification[id] === 'pending') return 'Grading your clip…';
  if (local.photoVerification[id] === 'rejected') return 'Evidence needs another try.';
  return evidenceReadiness(id, snapshot, membership?.playerId, connection === 'connected').message;
}
function compactQuestStatus(id: EvidenceQuestId): string {
  const local = snapshot?.players.find(player => player.id === membership?.playerId);
  if (connection !== 'connected' || !local) return 'Connect to play';
  const remaining = local.survival?.questCooldowns?.[id] ?? 0;
  if (remaining > 0) return `Again in ${formatTreatTime(remaining)}`;
  const state = snapshot?.quests[local.id]?.photoVerification[id];
  if (state === 'pending') return 'Grading…';
  if (state === 'rejected') return 'Try again';
  const readiness = evidenceReadiness(id, snapshot, local.id, true);
  if (readiness.ready) return 'Ready';
  const groupWait = /repeat this quest in (\d+)s/.exec(readiness.message);
  if (groupWait) return `Group ready in ${formatTreatTime(Number(groupWait[1]) * 1000)}`;
  return `Needs ${id === 'squadCircle' ? 3 : id === 'touchGrass' ? 1 : 2} pets`;
}
function renderQuestList(container: HTMLElement): void {
  container.replaceChildren();
  for (const quest of questDefinitions) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'compact-quest';
    const heading = document.createElement('span'); heading.className = 'compact-quest-heading';
    const title = document.createElement('strong'); title.textContent = `${quest.group} · ${quest.title}`;
    const status = document.createElement('small'); status.dataset.questStatus = quest.id;
    status.textContent = compactQuestStatus(quest.id);
    heading.append(title, status);
    const description = document.createElement('span'); description.className = 'compact-quest-description'; description.textContent = quest.summary;
    const prize = document.createElement('span'); prize.className = 'compact-quest-prize';
    prize.textContent = `+${QUEST_REWARD.happiness}% happiness · ${QUEST_REWARD.berries} berries · ${QUEST_REWARD.points} points`;
    button.append(heading, description, prize);
    button.addEventListener('click', () => openQuestDetail(quest.id)); container.append(button);
  }
  const raid = document.createElement('button'); raid.type = 'button'; raid.className = 'compact-quest';
  raid.innerHTML = '<span class="compact-quest-heading"><strong>Raid · Calm Mossback</strong><small data-raid-status></small></span><span class="compact-quest-description">Complete Circle up, then gather your squad and use pet actions to calm Mossback.</span><span class="compact-quest-prize">Group prize: +5 shared moments</span>';
  raid.addEventListener('click', openRaidDetail); container.append(raid);
}
function renderQuestCatalog(): void { renderQuestList(el('quest-catalog')); }
function openRaidDetail(): void {
  if (photoVerificationPending) { toast('Please wait for the current evidence check.'); return; }
  selectedQuest = null;
  el('quest-catalog').hidden = true; el('quest-detail').hidden = true; el('raid-detail').hidden = false;
  el('quest-dialog-category').textContent = 'SQUAD RAID'; el('quest-dialog-title').textContent = 'Calm Mossback';
  el('quest-dialog-intro').hidden = true;
  const dialog = el<HTMLDialogElement>('quest-dialog'); if (!dialog.open) dialog.showModal();
  updateQuestDetail();
}
renderQuestList(el('quest-board-list'));
function openQuestDetail(id: EvidenceQuestId): void {
  if (photoVerificationPending && id !== selectedEvidence()) { toast('Please wait for the current evidence check.'); return; }
  const quest = questDefinitions.find(item => item.id === id); if (!quest) return;
  selectedQuest = id;
  if (evidenceChoice.value !== id) { evidenceChoice.value = id; updateEvidenceChoice(); }
  el('raid-detail').hidden = true;
  el('quest-catalog').hidden = true; el('quest-detail').hidden = false;
  el('quest-dialog-category').textContent = `${quest.group} QUEST`;
  el('quest-dialog-title').textContent = quest.title;
  el('quest-dialog-intro').hidden = true;
  el('quest-detail-requirements').textContent = quest.requirements;
  const dialog = el<HTMLDialogElement>('quest-dialog'); if (!dialog.open) dialog.showModal();
  updateQuestDetail();
}
function updateQuestDetail(): void {
  document.querySelectorAll<HTMLElement>('[data-quest-status]').forEach(status => {
    status.textContent = compactQuestStatus(status.dataset.questStatus as EvidenceQuestId);
  });
  document.querySelectorAll<HTMLElement>('[data-raid-status]').forEach(status => {
    status.textContent = snapshot?.raid.state === 'defeated' ? 'Completed' : snapshot?.raid.state === 'active' ? 'In progress' : '3–4 pets';
  });
  const dialog = el<HTMLDialogElement>('quest-dialog');
  if (!dialog.open) return;
  if (!selectedQuest) return;
  el('quest-detail-status').textContent = questProgress(selectedQuest);
}

function openQuestMenu(): void {
  if (el<HTMLButtonElement>('quest-button').disabled) return;
  renderQuestCatalog(); selectedQuest = null;
  el('quest-dialog-title').textContent = 'Choose a quest';
  el('quest-dialog-category').textContent = 'SHARED ADVENTURES';
  el('quest-dialog-intro').hidden = false;
  el('quest-catalog').hidden = false; el('quest-detail').hidden = true; el('raid-detail').hidden = true;
  const dialog = el<HTMLDialogElement>('quest-dialog'); if (!dialog.open) dialog.showModal();
  updateQuestDetail();
}
el('quest-button').addEventListener('click', openQuestMenu);
el('close-quests').addEventListener('click', () => el<HTMLDialogElement>('quest-dialog').close());
el('quest-dialog').addEventListener('close', () => { selectedQuest = null; });
el('quest-back').addEventListener('click', openQuestMenu);
el('raid-back').addEventListener('click', openQuestMenu);
function currentEvidenceReadiness() {
  return evidenceReadiness(el<HTMLSelectElement>('evidence-quest').value as EvidenceQuestId,
    snapshot, membership?.playerId, connection === 'connected');
}
function updateEvidenceReadiness(): void {
  const state = currentEvidenceReadiness();
  const status = el('evidence-prerequisite-status');
  if (status.textContent !== state.message) status.textContent = state.message;
  el<HTMLButtonElement>('submit-clip').disabled = photoVerificationPending || !state.ready;
  el<HTMLButtonElement>('submit-photo').disabled = photoVerificationPending || !state.ready
    || el<HTMLSelectElement>('evidence-quest').value === 'dapHandshake';
}
function evidenceSession() {
  const state = currentEvidenceReadiness();
  if (!membership || !state.ready) throw new Error(`Not submitted: ${state.message}`);
  if (!evidenceConsent.checked) throw new Error('Ask everyone shown to agree, then check the consent box before submitting.');
  if (photoVerificationPending) throw new Error('Please wait for the current evidence check.');
  return { roomCode: membership.roomCode, playerToken: membership.playerToken, questId: selectedEvidence() };
}
async function submitEvidence(session: ReturnType<typeof evidenceSession>, evidence: object): Promise<void> {
  if (membership?.playerToken !== session.playerToken) throw new Error('Your quest session changed. Select the quest again.');
  el('evidence-status').textContent = 'Uploading your clip for grading…';
  const response = await fetch(verificationEndpoint(), {
    method: 'POST', signal: AbortSignal.timeout(40_000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...session, ...evidence }),
  });
  const result = await response.json().catch(() => ({})) as { verified?: boolean; reason?: string; error?: string; reward?: QuestReward };
  if (!response.ok) throw new Error(result.error || 'Verification is unavailable.');
  el('evidence-status').textContent = result.verified ? `Verified: ${result.reason ?? 'Quest complete!'}${result.reward ? ` ${questRewardText(result.reward)}` : ''}` : `Try again: ${result.reason ?? 'The action was not clear enough.'}`;
  toast(result.verified ? result.reward ? questRewardText(result.reward) : 'Quest verified! Your group’s progress updated.' : 'Evidence was inconclusive. Review the instructions and try again.');
}
function setEvidenceBusy(busy: boolean): void {
  photoVerificationPending = busy;
  evidenceChoice.disabled = busy;
  evidenceConsent.disabled = busy;
  updateEvidenceReadiness();
}
function evidenceError(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : 'Evidence verification is unavailable.';
  el('evidence-status').textContent = message; toast(message);
  if (/No saved clip|Record a quest clip first/.test(message)) el('recording-status').textContent = message;
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
updateEvidenceChoice();
if (!isNativePhone()) for (const id of ['record-clip', 'retake-clip']) el(id).hidden = true;
if (!isNativePhone()) {
  el('recording-status').hidden = true;
  el('evidence-status').textContent = 'Submit photo for grading';
  el('local-weather').hidden = false;
  el('browser-view-tools').hidden = false;
  el('enable-compass').hidden = !window.matchMedia('(pointer: coarse)').matches;
  el('enable-walking').hidden = mobileMovement || !window.matchMedia('(pointer: coarse)').matches;
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
  if (delta && local && connection === 'connected') {
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
  const share = { title: 'Come play in my Kith world', text: `Bring your pet! Room ${membership.roomCode}`, url };
  if (navigator.share) void navigator.share(share).catch(cause => { if (cause.name !== 'AbortError') toast('Share the room code shown on screen.'); });
  else void copy(url).then(() => toast('Invite link copied. Send it to your friend.')).catch(cause => toast(String(cause.message)));
});
function adminLabel(input: HTMLInputElement): void {
  const value = Number(input.value);
  el(`${input.id}-value`).textContent = input.dataset.admin === 'happiness' ? `${value}%`
    : input.dataset.admin?.endsWith('Ms') ? value === 0 ? 'Ready now' : formatTreatTime(value * 1000) : String(value);
}
function loadAdminControls(): void {
  const pet = snapshot?.players.find(player => player.id === membership?.playerId)?.survival;
  const values: Record<string, number> = { berries: pet?.inventory.berry ?? 0, happiness: Math.round(pet?.happiness ?? 0),
    treatCooldownMs: Math.ceil((pet?.treatCooldownMs ?? 0) / 1000),
    questCooldownMs: Math.ceil(Math.max(0, ...Object.values(pet?.questCooldowns ?? {}).map(value => value ?? 0)) / 1000) };
  document.querySelectorAll<HTMLInputElement>('[data-admin]').forEach(input => {
    if (input.dataset.admin === 'questCooldownMs') input.max = String(Math.max(60, values.questCooldownMs!));
    input.value = String(values[input.dataset.admin!] ?? 0); input.disabled = !pet || connection !== 'connected'; adminLabel(input);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(button => { button.disabled = !pet || connection !== 'connected'; });
  el('admin-status').textContent = pet && connection === 'connected' ? 'Changes save to your current pet.' : 'Connect to the playground to edit your pet.';
}
let adminSaving = false;
async function saveAdminControl(input: HTMLInputElement): Promise<void> {
  if (adminSaving || !membership || connection !== 'connected') return;
  adminSaving = true;
  const key = input.dataset.admin!;
  const value = Number(input.value) * (key.endsWith('Ms') ? 1000 : 1);
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-admin], [data-reset]').forEach(control => { control.disabled = true; });
  el('admin-status').textContent = 'Saving…';
  try {
    const response = await fetch(new URL('/api/admin/pet', verificationEndpoint()), {
      method: 'POST', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode: membership.roomCode, playerToken: membership.playerToken, changes: { [key]: value } }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || 'Could not save your pet.');
    el('admin-status').textContent = 'Saved. Your pet is updated.';
  } catch (cause) {
    loadAdminControls();
    el('admin-status').textContent = cause instanceof Error ? cause.message : 'Could not save your pet.';
  } finally {
    adminSaving = false;
    document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('[data-admin], [data-reset]').forEach(control => { control.disabled = connection !== 'connected'; });
  }
}
document.querySelectorAll<HTMLInputElement>('[data-admin]').forEach(input => {
  input.addEventListener('input', () => adminLabel(input));
  input.addEventListener('change', () => { void saveAdminControl(input); });
});
document.querySelectorAll<HTMLButtonElement>('[data-reset]').forEach(button => button.addEventListener('click', () => {
  const input = el<HTMLInputElement>(button.dataset.reset!); input.value = '0'; adminLabel(input); void saveAdminControl(input);
}));
const settings = el<HTMLDialogElement>('settings-dialog');
el('server-settings').addEventListener('click', () => {
  if (nearbyActive) stopNearby();
  el<HTMLInputElement>('server-url').value = serverUrl;
  el('settings-error').hidden = true;
  loadAdminControls();
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
    if (mobileMovement) return;
    el('error-message').hidden = true;
    if (walking) { walkingTracker.moveTo(x, z); publishWalking(true); }
    else client.move(x, z);
  });
  if (mobileMovement) { canvas.tabIndex = -1; canvas.setAttribute('aria-label', 'Pet playground. Walk with your device to move; turn or tilt to look around.'); }
  await playground.load();
  renderMood();
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

function receiveGameLocation(fix: LocationFix): void {
  if (!walking || !mobileMovement) return;
  if (fix.accuracy > 25) { el('walking-status').textContent = stepSensorAvailable ? 'GPS is weak · walking with your steps.' : 'Waiting for a clearer GPS signal.'; return; }
  if (membership && connection === 'connected') client.location(fix);
  el('walking-status').textContent = `Following your location · GPS ±${Math.ceil(fix.accuracy)} m`;
}
const browserGameLocation = new LocationDiscovery({ fix: receiveGameLocation,
  status: message => { el('browser-walking-status').textContent = message; },
  unavailable: message => { el('browser-walking-status').textContent = message; }, paused: () => {} });
function stopWalking(): void {
  if (!walking) return;
  walking = false;
  stepSensorAvailable = false; stepDetector.reset(); walkingTracker.setStepTracking(false);
  browserGameLocation.stop();
  nativeCommand('stopLocation', { purpose: 'walking' });
  playground?.setWalkingPose(null);
  playground?.setViewTilt();
  deviceView.reset();
  el('walking-status').textContent = 'Walking pauses while you’re away and resumes when you return.';
  el('compass-reading').textContent = 'Compass off';
  updateControls();
}
function startWalking(): void {
  if ((!mobileMovement && !browserWalkingEnabled) || !ready || walking || document.hidden) return;
  walking = true;
  const local = snapshot?.players.find(p => p.id === membership?.playerId);
  walkingTracker.reset(local?.targetX ?? walkingTracker.pose.x, local?.targetZ ?? walkingTracker.pose.z);
  stepDetector.reset(); walkingSteps = 0;
  deviceView.reset((Math.PI - walkingTracker.pose.yaw) * 180 / Math.PI);
  stepSensorAvailable = browserWalkingEnabled;
  walkingTracker.setStepTracking(stepSensorAvailable);
  el('walking-status').textContent = 'Aligning your pet with your device…';
  el('compass-reading').textContent = 'Reading your starting direction…';
  publishWalking();
  updateControls();
  nativeCommand('startLocation', { purpose: 'walking' });
  if (!isNativePhone() && mobileMovement) browserGameLocation.start();
}
function publishWalking(moved = false, initialHeading = false): void {
  if (!walking) return;
  playground?.setWalkingPose(walkingTracker.pose, initialHeading, connection !== 'connected');
  if (membership && connection === 'connected') {
    if (moved && !mobileMovement) client.move(walkingTracker.pose.x, walkingTracker.pose.z);
    client.heading(walkingTracker.pose.yaw);
  }
}
function receiveWalkingMotion(verticalG: number, timestamp: number): void {
  if (!walking || !stepSensorAvailable || document.hidden) return;
  const steps = stepDetector.sample(verticalG, timestamp);
  if (!walkingTracker.steps(steps)) return;
  if (mobileMovement && membership && connection === 'connected') client.steps(steps, walkingTracker.pose.yaw);
  walkingSteps += steps;
  el(isNativePhone() ? 'walking-status' : 'browser-walking-status').textContent = `Walking with you · ${walkingSteps} steps detected`;
  publishWalking(true);
}
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  button.addEventListener('click', () => {
    const directions: Record<string, [number, number]> = { forward: [0, -0.7], back: [0, 0.7], left: [-0.7, 0], right: [0.7, 0] };
    const delta = directions[button.dataset.move!];
    if (delta && connection === 'connected') playground?.moveByScreen(...delta);
  });
});
el('recenter-view').addEventListener('click', () => {
  deviceView.reset((Math.PI - walkingTracker.pose.yaw) * 180 / Math.PI);
  playground?.setViewTilt();
});
if (isNativePhone()) {
  el('native-tools').hidden = false;
  el('quest-tools').hidden = false;
  for (const [id, command] of [['record-clip', 'recordClip'], ['retake-clip', 'recordClip']] as const) {
    el(id).addEventListener('click', () => nativeCommand(command));
  }
  onNativeEvent(event => {
    if (event.type === 'active') { resumeAutomaticNearby(); startWalking(); }
    const weatherFix = nativeFix(event);
    if (weatherFix) void weather.update(weatherFix);
    if (event.type === 'recording') el('recording-status').textContent = event.message ?? '';
    if (event.type === 'paused') {
      stopWalking();
      if (event.message) el('walking-status').textContent = event.message;
    }
    if (!walking) return;
    if (event.type === 'unavailable' && event.message) el('walking-status').textContent = event.message;
    if (event.type === 'motionStatus') {
      stepSensorAvailable = event.available === true;
      stepDetector.reset(); walkingTracker.setStepTracking(stepSensorAvailable);
      el('walking-status').textContent = stepSensorAvailable ? 'Walking ready · steps follow you between GPS updates.' : 'Using GPS for walking.';
    }
    if (event.type === 'motion') receiveWalkingMotion(event.verticalG ?? NaN, event.timestamp ?? NaN);
    if (event.type === 'status' && !stepSensorAvailable && !mobileMovement) el('walking-status').textContent = event.message ?? '';
    if (event.type === 'attitude') {
      const view = deviceView.sample({ yaw: event.yaw ?? NaN, gravityX: event.gravityX ?? NaN,
        gravityY: event.gravityY ?? NaN, gravityZ: event.gravityZ ?? NaN,
        screenAngle: event.screenAngle ?? NaN, timestamp: event.timestamp ?? NaN });
      if (view) {
        const initialHeading = !walkingTracker.hasHeading;
        walkingTracker.heading(view.degrees, 0);
        playground?.setViewTilt(view.pitch, view.roll);
        el('compass-reading').textContent = `Facing ${Math.round(view.degrees)}°`;
        publishWalking(false, initialHeading);
      }
    }
    if (event.type === 'heading') {
      const initialHeading = !walkingTracker.hasHeading;
      if (walkingTracker.heading(event.degrees ?? -1, event.accuracy ?? -1)) {
        deviceView.alignHeading(event.degrees!);
        el('compass-reading').textContent = `Facing ${Math.round(event.degrees!)}° ${event.reference === 'true' ? 'true' : 'magnetic'}`;
        publishWalking(false, initialHeading);
      } else if (!walkingTracker.hasHeading) el('compass-reading').textContent = 'Waiting for motion or compass…';
    }
    const fix = nativeFix(event);
    if (fix && mobileMovement) receiveGameLocation(fix);
    else if (fix && !stepSensorAvailable) {
      const result = walkingTracker.location(fix);
      el('walking-status').textContent = result.message;
      publishWalking(result.moved);
    }
  });
  nativeCommand('ready', { sceneReady: ready });
}

resumeAutomaticNearby();
startWalking();
