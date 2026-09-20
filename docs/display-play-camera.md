# Display game and glasses camera

The display game uses a Meta Ray-Ban Display Web App. The phone camera app uses Meta DAT to read the **glasses camera**. They communicate through the existing game server. A camera pairing does not sign the camera app into a game room or expose the player's game token.


## Build and launch

- `npm run build:all` builds the phone UI and the new glasses UI into a single static root.
- `npm run web:start` serves both UIs and their game/camera endpoints from port 8788. Put that one origin behind HTTPS/WSS.
- Open `/glasses/setup.html` on the paired iPhone for the Meta Add to glasses deep link, or register `/glasses/index.html` manually in Meta AI.
- For GitHub Pages, build with `VITE_PLAY_SERVER_URL=wss://YOUR_GAME_HOST/play npm run build --workspace @bondimals/glasses-web -- --base=/YOUR_REPO/`; Pages serves assets only, while gameplay and camera requests use that secure server.
- A phone's LAN address such as `ws://10.189.42.248:8788/play` is still the same backend, but the HTTPS glasses app requires a secure `wss://` gateway to it. GitHub Pages hosts the UI and cannot host the multiplayer server.
- Keep the server and tunnel alive during a temporary demo. Anonymous Serveo forwards expire and receive a new address on restart; an SSH keepalive alone does not prevent expiry. Use an authenticated, reserved hostname for a stable demo link. A replacement tunnel must also be updated in the glasses build/settings and the phone camera bridge.
- The display retries temporary transport failures during first connection as well as after joining. A rejected room is reported immediately. After retries are exhausted, use the connection panel's Join button to retry.
- After reserving a Serveo hostname and registering this Mac's dedicated public key, run `node scripts/share-game-server.mjs --hostname YOUR_NAME.serveousercontent.com --identity /absolute/path/to/key`. This forwards port 8788, verifies the existing game server, pins Serveo's host key and reconnects the same hostname after an SSH interruption. It stops if Serveo substitutes an anonymous hostname. The private key stays outside the repository. The Mac and game server must remain running.
- The native camera target is iOS 17.2+ with DAT 0.9.0. Build `glasses-ios/BondimalsCamera.xcodeproj`, scheme `BondimalsCamera`, with your signing team. This is separate from the Kith phone game.

## Controls

Swipe/arrow to focus; pinch/Enter activates once. Walk enables motion from a user gesture; Pause stops it. Wave, Berry and Quests stay in the main rail. More includes Jump, Play, Dap, recenter, camera pairing and connection controls. When sensors are unavailable, Step forward is an explicit game action. Restart motion after returning from the background.

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
| `POST /glasses/capture` | Game authentication plus `{kind: "photo" \| "clip", questId}` | `{requestId}`. Requires a camera poll within the previous five seconds. The handshake quest requires a clip. |
| `POST /glasses/result` | Camera bearer plus `{requestId, status: "ready", photoDataUrl}` or `{requestId, status: "ready", frames, durationSeconds}` or `{requestId, status: "error", error}` | `{ok: true}`. Only the current, unfinished capture can complete. |
| `POST /glasses/status` | Game authentication | `{paired, connected, requestId, status, error?, photoDataUrl?, frames?, durationSeconds?}`. `requestId` is null when idle; status is `idle`, `capturing`, `ready` or `error`. |
| `POST /glasses/discard` | Game authentication | `{ok: true}`. Clears evidence and cancels active capture. |

Commands repeat until completed or replaced. The native app must de-duplicate by `id`. Cancellation emits a **new** command ID with `{id, kind: "cancel", requestId}` targeting the old capture. Late, duplicated, canceled or timed-out results return HTTP 409. The camera should stop and clear its token on HTTP 401. A normal camera error may contain at most 200 displayed characters; control characters are stripped.

Capture times out after 30 seconds. Evidence lives in memory for at most five minutes, and is cleared on discard, re-pair, owner disconnect or server shutdown. Pairings expire after one hour without activity. Individual evidence is bounded by the existing quest validator: at most 12 images, 4 MiB combined decoded image bytes, and a 1–11 second clip containing at least three frames. JSON bodies are limited to 5.7 MB. The bridge also bounds total evidence memory, simultaneous uploads, pairings and request rates. Camera tokens are not broadcast in room snapshots.

The bridge **never** calls the quest verifier. Capturing only delivers private preview evidence to the requesting game client. The user reviews it and explicitly submits through the existing `/verify` flow; discard must remain available. Preview images are not written to SQLite or disk. The chosen HTTPS host handles the transient camera traffic.

## Device validation still required

Meta documents one DAT session per device; current sources do not explicitly establish whether a camera-only native DAT session can coexist with a foreground standalone Display Web App. This remains **NEEDS_DEVICE_TEST**. The browser, server and iOS build checks do not validate concurrency or physical sensor behavior.

1. Check glasses firmware v125+ and Meta AI v272+. To enable Developer Mode, open Meta AI Settings → App Info, tap the version five times, and enable it. Add the public HTTPS game under App Connections → Web Apps, then launch it from the glasses app grid. [Official setup](https://wearables.developer.meta.com/docs/develop/webapps/setup/).
2. Confirm directional navigation and pinch activation on every game screen. Enable walking explicitly; test walking, stopping, turns, heading wrap, background/resume and unavailable sensor data.
3. Pair the native app using the game's new eight-character code. Start the glasses camera and keep the phone app foregrounded. Confirm camera frames on the phone before capturing.
4. Test camera-first and Web-App-first launch order. Keep the Web App visible while capturing one photo and one clip. Record phone OS, Meta AI version, glasses firmware, DAT version, stream/session transitions and any interruption.
5. Review evidence in the game, discard one capture and submit another. Disconnect the owner mid-capture; the camera must stop sending results for that session. Test camera stop, stale frames, denied permission, doff, hinge close and reconnection.

If the firmware interrupts either component when the other starts, the web/native combination cannot be reported as working. Native DAT display components are another route, but they do not provide the same documented WebGL game surface. [Session lifecycle](https://wearables.developer.meta.com/docs/develop/dat/lifecycle-events/).

Run transport validation with `node --test bridge/glasses-camera.test.mjs`. These tests use explicit synthetic evidence and real local HTTP/WebSocket connections; they do not assert physical camera provenance.
