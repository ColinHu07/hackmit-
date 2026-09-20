# Display game and glasses camera

The display game uses a Meta Ray-Ban Display Web App. The phone camera app uses Meta DAT to read the **glasses camera**. They communicate through the existing game server. A camera pairing does not sign the camera app into a game room or expose the player's game token.


## Build and launch

- `npm run build:all` builds the phone UI and the new glasses UI into a single static root.
- `npm run web:start` serves both UIs and their game/camera endpoints from port 8788. Put that one origin behind HTTPS/WSS.
- Open `/glasses/setup.html` on the paired iPhone for the Meta Add to glasses deep link, or register `/glasses/index.html` manually in Meta AI.
- If the glasses retain an older cached launch page, use the setup link again to register `/glasses/meadow.html` (or the equivalent path under the Pages repository). It is rebuilt alongside `index.html`, with the same server and saved player. The current screen shows **Meadow 6** below Kith; **More → Connection & controls → Refresh game** reloads this entry with a fresh query string. A missing Meadow 6 label means this update has not loaded.
- For GitHub Pages, build with `VITE_PLAY_SERVER_URL=wss://YOUR_GAME_HOST/play npm run build --workspace @bondimals/glasses-web -- --base=/YOUR_REPO/`; Pages serves assets only, while gameplay and camera requests use that secure server.
- A phone's LAN address such as `ws://10.189.42.248:8788/play` is still the same backend, but the HTTPS glasses app requires a secure `wss://` gateway to it. GitHub Pages hosts the UI and cannot host the multiplayer server.
- Keep the server and tunnel alive during a temporary demo. Anonymous Serveo forwards expire and receive a new address on restart; an SSH keepalive alone does not prevent expiry. Use an authenticated, reserved hostname for a stable demo link. A replacement tunnel must also be updated in the glasses build/settings and the phone camera bridge.
- The display retries temporary transport failures during first connection as well as after joining. A rejected room is reported immediately. After retries are exhausted, use the connection panel's Join button to retry.
- After reserving a Serveo hostname and registering this Mac's dedicated public key, run `node scripts/share-game-server.mjs --hostname YOUR_NAME.serveousercontent.com --identity /absolute/path/to/key`. This forwards port 8788, verifies the existing game server, pins Serveo's host key and reconnects the same hostname after an SSH interruption. It stops if Serveo substitutes an anonymous hostname. The private key stays outside the repository. The Mac and game server must remain running.
- The native camera target is iOS 17.2+ with DAT 0.9.0. Build `glasses-ios/BondimalsCamera.xcodeproj`, scheme `BondimalsCamera`, with your signing team. This is separate from the Kith phone game.
- For a signed camera update, use `npm run build:camera -- --server https://YOUR_GAME_HOST --team YOUR_TEAM --device YOUR_DEVICE_ID` (omit `--device` to build only). This requires an explicit server, isolates build output by hostname and checks the signed app's embedded server before installing. A successful build or app launch alone does not establish that camera pairing worked.

## Controls

Swipe/arrow to focus; pinch/Enter activates once. Walk enables motion from a user gesture; Pause stops it. Wave, Berry and Quests stay in the main rail. Photo and Record 6s open a dedicated recorder. Pairing leaves the camera idle; an explicit capture starts it, records, then stops the camera and parent DAT session. The glasses may temporarily hide the Web App while DAT owns the session. Reopen Kith from the glasses app grid (or Resume in its menu) to see Review your capture, then choose **Submit to Muse** or Discard. The game also exposes **Quests → Review recent capture**. Capture never grades automatically. Up to two live preview frames per second appear only if the firmware keeps the web display active. Previously enabled movement resumes on foreground return with fresh samples; explicit Pause keeps it off.

The display prepares the local beaver first, reports download and animation preparation progress, and shares immutable animation geometry between room members while keeping their animation weights independent. Visitors are created only when present. The display uses the same grass, flowers and meadow landmarks as the phone, at 1× pixel resolution without realtime shadows or weather particles. Quest notices are brief, non-blocking hints; another player's walking milestone never asks you to submit a photo. Head steering stays live when only the accelerometer stream pauses. Foreground sensor gaps recover automatically as new samples arrive, with step detection reset so old motion cannot become catch-up steps. A brief network reconnection resumes previously enabled tracking only after the server position is resynchronized; explicit Pause still prevents automatic resumption; a foreground return reuses previously granted or pending permission without requesting it again.

The simulator is `?simulator`: select Walk, W advances a synthetic step, A/D turn; it never labels these as physical glasses measurements. Relative heading initially aligns to the server character. Recenter keeps position, and Reverse head-turn direction handles device mounting differences. Head-facing is explicitly locked on the server during walking so other clients see it too.

## Verified platform capabilities — September 20, 2026

Meta documents a 600×600 Web App viewport with DOM, Canvas and WebGL rendering; the page background is black because it emits no light on the additive display. The Neural Band sends directional keys and activates the focused button with Enter/click. Motion and orientation arrive through `DeviceMotionEvent` and `DeviceOrientationEvent`. The game can use detected steps and heading for movement, but this is not measured physical position, SLAM or a 6DoF world anchor. Geolocation comes from the paired phone and has a documented typical accuracy of 5–50 meters.

The game protocol accepts `{type: "heading", yaw, lock: true}` so other players see the glasses wearer's facing direction while their pet walks. Explicit `lock: false` resumes movement-facing behavior; omitting `lock` preserves ordinary phone heading behavior. Disconnecting clears the lock. Head orientation changes do not themselves change movement destinations.

Official sources:

- [Display and rendering guidelines](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/references/display-guidelines.md)
- [Motion, orientation and location APIs](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/skills/add-device-sensors/SKILL.md)
- [Neural Band input](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/skills/add-gestures/SKILL.md)
- [Web App build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/)

The Web App documentation still lists camera and microphone as unsupported. Native DAT iOS 0.9.0 exposes `DeviceSession.addCamera(config:)`, `Camera.stream.videoFramePublisher`, `photoDataPublisher` and `capturePhoto(format: .jpeg)`. DAT 0.9.0 requires iOS 17.2 or later. Quest clips use a bounded sequence of actual stream frames, with no audio.

- [DAT 0.9.0 changelog and minimum iOS version](https://github.com/facebook/meta-wearables-dat-ios/blob/main/CHANGELOG.md)
- [Camera integration and lifecycle](https://github.com/facebook/meta-wearables-dat-ios/blob/main/AGENTS.md)
- [Stream/photo API reference](https://wearables.developer.meta.com/docs/reference/ios_swift/dat/latest/mwdatcamera_stream)
- [Official native video recording sample](https://github.com/facebook/meta-wearables-dat-ios/blob/main/samples/CameraAccess/CameraAccess/Media/VideoRecorder.swift)

Direct developer-guide pages require login in the web reader. Their current text was retrieved through Meta's public, unauthenticated documentation MCP, `https://mcp.developer.meta.com/wearables`, using `search_webapps_docs` and `search_dat_docs`. GitHub toolkit guidance has newer text-input/drag/offline information than the MCP summary; those differences do not establish browser camera support.

## HTTP camera bridge

All routes are under the game server's public HTTPS origin. Requests and responses are JSON and are not cached. Game requests carry `{roomCode, playerToken}` in the POST body; camera requests use `Authorization: Bearer <cameraToken>`. Never put either token in a URL. The camera token is unrelated to the game reconnect token.

| Route | Request | Response |
| --- | --- | --- |
| `POST /glasses/pair` | Game authentication | `{code, expiresAt}`; eight-character, single-use code valid for five minutes. Re-pairing revokes the previous camera and clears its evidence. |
| `POST /glasses/claim` | `{code}` | `{cameraToken}`. The owner must still be connected. |
| `GET /glasses/command` | Camera bearer | `{command: null}` or `{command: {id, kind: "photo" \| "clip", questId}}`. Poll about once per second. |
| `POST /glasses/heartbeat` | Camera bearer plus `{cameraReady, cameraState, onDemandCapture?, message?}` | Reports actual camera readiness: `ready`, `starting`, `permission`, `paused`, `error` or `idle`. Readiness expires after five seconds. `onDemandCapture: true` advertises native Camera 7 ability to start a camera for a command without keeping DAT active. |
| `POST /glasses/progress` | Camera bearer plus `{requestId, sequence, elapsedSeconds, previewDataUrl}` | Latest bounded JPEG/PNG preview for the active requested clip only, at most twice per second. Preview expires after three seconds. |
| `POST /glasses/capture` | Game authentication plus `{kind: "photo" \| "clip", questId}` | `{requestId}`. Requires a fresh camera poll and heartbeat. The camera must already be ready, or explicitly support on-demand capture while idle/starting. Polling or pairing alone is insufficient. The handshake quest requires a clip. |
| `POST /glasses/result` | Camera bearer plus `{requestId, status: "ready", photoDataUrl}` or `{requestId, status: "ready", frames, durationSeconds}` or `{requestId, status: "error", error}` | `{ok: true}`. Only the current, unfinished capture can complete. |
| `POST /glasses/status` | Game authentication | `{paired, connected, cameraReady, captureAvailable, cameraState, cameraMessage?, requestId, questId?, kind?, captureAt?, status, previewDataUrl?, previewAt?, sequence?, elapsedSeconds?, error?, photoDataUrl?, frames?, durationSeconds?}`. `requestId` is null when idle; status is `idle`, `capturing`, `ready` or `error`. |
| `POST /glasses/discard` | Game authentication | `{ok: true}`. Clears evidence and cancels active capture. |

Commands repeat until completed or replaced. The native app must de-duplicate by `id`. Cancellation emits a **new** command ID with `{id, kind: "cancel", requestId}` targeting the old capture. Late, duplicated, canceled or timed-out results return HTTP 409. The camera should stop and clear its token on HTTP 401. A normal camera error may contain at most 200 displayed characters; control characters are stripped.

Capture times out after 60 seconds. Evidence stays in memory for at most five minutes. A temporary game disconnect retains only the same authenticated owner's active request or ready evidence for up to two minutes, including preserving that player's room reservation beyond its normal 30-second grace. The matching native result can complete during that interval; live preview is cleared while disconnected. A same-token reload can recover a pending capture even if the old socket is still open. Idle/failed/expired active-session replacement, explicit leave, re-pairing, membership expiry and server shutdown revoke the binding. Discard clears evidence and cancels capture. Pairings also expire after one hour without activity. Live preview keeps only the newest frame, at most 100 KiB decoded, and clears it on cancellation, disconnect, stale readiness, error or completion. It is never graded or persisted; final quest evidence remains a separate upload. Individual evidence is bounded by the existing quest validator: at most 12 images, 4 MiB combined decoded image bytes, and a 1–11 second clip containing at least three frames. JSON bodies are limited to 5.7 MB. The bridge also bounds total evidence memory, simultaneous uploads, pairings and request rates. Camera tokens are not broadcast in room snapshots.

The bridge **never** calls the quest verifier. Capturing delivers private evidence to the authenticated game client; only the explicit **Submit to Muse** button sends it through `/verify`. Status returns the current request's quest and kind so a recreated display page can restore review. Stale responses cannot restore a discarded or replaced request. Generic transport failures preserve evidence for recovery; explicit Cancel/Discard erase it. Preview images are not written to SQLite or disk. The chosen HTTPS host handles transient camera traffic.

## Device validation still required

Physical testing on this device showed that recording can blank the standalone Web App while the camera remains active. Camera 7 releases both camera and DAT session after every bounded capture, and Meadow 6 restores the result after reconnect/reload. Automatic display return is not promised; use the Web App menu's Resume action or select Kith again from the glasses app grid. [Official setup](https://wearables.developer.meta.com/docs/develop/webapps/setup/) and [session lifecycle](https://wearables.developer.meta.com/docs/develop/dat/lifecycle-events/).

1. Pair Camera 7 and confirm it reports ready for quests with the stream closed.
2. Select Record 6s. If Kith disappears, let recording finish, then reopen Kith promptly.
3. Confirm the camera/session stops, review appears with the clip, and no grade occurs before Submit to Muse.
4. Submit once; confirm the quest result. Repeat using Discard and verify there is no grading/reward.
5. Check denied permission, doff/hinge close, temporary network loss, expired capture and Cancel. Confirm an old request never stops a new recording.

Synthetic HTTP/WebSocket and browser tests validate retention, recovery and explicit submission, not hardware display/session arbitration.

Run transport validation with `node --test bridge/glasses-camera.test.mjs`. These tests use explicit synthetic evidence and real local HTTP/WebSocket connections; they do not assert physical camera provenance.

## Interrupted capture connections

Meadow 6 retries authenticated status/evidence reads for up to 90 seconds after returning to the display, with up to 45 seconds per download bounded by the remaining deadline. Network interruption, timeout, interrupted response bodies, and temporary gateway failures are recoverable; authorization and invalid-data errors remain actionable. Capture, discard and Muse submission are never automatically repeated. A Review recent capture action immediately reports progress or errors inside the quest menu. Leaving that view, changing player/session, or starting Submit/Discard prevents an older status response from repainting the interface.

Camera 7 retains the same encoded capture for up to 20 seconds while retrying transient result-upload failures, with at most six seconds per attempt. The server acknowledges an identical upload for the same current request without replacing evidence, extending retention, or grading again. Changed, discarded, expired, replaced or unauthorized results remain rejected. Separate sanitized last-capture diagnostics record recording, upload, acknowledgment and failure without including media or credentials.
