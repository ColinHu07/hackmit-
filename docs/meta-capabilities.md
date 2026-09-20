# Meta capability verification

Checked **2026-09-19**. Milestone 1 uses browser simulation only. No DAT SDK is installed or linked into this milestone, and no hardware behavior has been validated.

## Documentation and local tooling

The initial repository was empty. Inspection found no installed Meta Wearables plugin or skills in the available Codex/Claude/agents locations and no callable Meta Wearables tool in the session. The available plugin-directory search did not locate a relevant Meta plugin. Do not describe that plugin as installed.

Official public references were available from Meta's GitHub repositories. Meta also documents a public, unauthenticated [Wearables documentation MCP](https://github.com/facebook/meta-wearables-webapp#live-documentation-mcp) at `https://mcp.developer.meta.com/wearables`. Its `initialize`, `tools/list`, `search_webapps_docs`, and `search_dat_docs` requests succeeded during this audit. This was read-only documentation retrieval; it did not install or configure a plugin.

Direct Wearables Developer Center pages returned a login screen to the web reader. Current documentation content was retrieved through the official public MCP instead. The source links below identify the corresponding official guides or public repository evidence.

## Exact Android SDK target for Milestone 4

**Target: `0.9.0`**, an exact published patch version in the requested 0.9.x family. This is a future integration target, not a dependency used by the simulator.

- Meta's [Android changelog](https://github.com/facebook/meta-wearables-dat-android/blob/main/CHANGELOG.md) records `0.9.0` dated August 3, 2026.
- Meta's [published core package](https://github.com/facebook/meta-wearables-dat-android/packages/2759307?version=0.9.0) identifies `com.meta.wearable:mwdat-core:0.9.0` and the same publication date.
- The [official Android repository](https://github.com/facebook/meta-wearables-dat-android) specifies `mwdat = "0.9.0"`, with `mwdat-core`, `mwdat-camera`, `mwdat-display`, and `mwdat-mockdevice` artifacts under `com.meta.wearable`, distributed through Maven Central. Recheck release and firmware compatibility before implementing Milestone 4.

## Documented camera API

The documented Android flow is initialize `Wearables`, complete registration and camera permission handling, create a `DeviceSession` through `Wearables.createSession(...)`, start it, and attach the camera with `session.addCamera(StreamConfiguration(...))`. The returned `Camera` exposes `camera.stream`; collect `camera.stream.videoStream` and stream state, then call `camera.stream.start()`. Handle each `DatResult` and lifecycle error. Cleanup includes `camera.stop()`, `session.removeCamera()` when detaching, and `session.stop()` when finished. See Meta's [Android integration instructions](https://github.com/facebook/meta-wearables-dat-android/blob/main/AGENTS.md) and [DeviceSession API](https://wearables.developer.meta.com/docs/reference/android/dat/latest/com_meta_wearable_dat_core_session_devicesession).

The [0.9.0 changelog](https://github.com/facebook/meta-wearables-dat-android/blob/main/CHANGELOG.md) explicitly removes `DeviceSession.addStream(...)` and `removeStream()`. Do not use those older entry points. Camera attachment and stream startup are separate operations.

## Display Web App capabilities

| Capability | Evidence and Kith decision |
| --- | --- |
| Display | **VERIFIED:** fixed 600×600 viewport; additive waveguide; pure black contributes no light. Use `#000000` on the page and bright, small creature geometry. [Display guidelines](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/references/display-guidelines.md) |
| Rendering | **VERIFIED:** DOM, Canvas 2D, and WebGL are documented. Three.js can use the WebGL surface; its desktop simulator behavior still requires separate glasses testing. [Display guidelines](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/references/display-guidelines.md) |
| Input | **VERIFIED:** directional/selection gestures generate arrow-key and Enter events. Desktop arrows are suitable for a simulation harness. Head motion is a separate sensor input, not a directional button event. [Web Apps build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/), retrieved through MCP |
| Orientation | **VERIFIED API:** `DeviceOrientationEvent` and `DeviceMotionEvent`. Meta documents `alpha` (z rotation), `beta` (x rotation), and `gamma` (y rotation). Feature-detect; when `requestPermission()` exists, invoke it from a user gesture. Availability does not establish a calibrated camera/display transform. [Meta sensor guidance](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/skills/add-device-sensors/SKILL.md) |
| Camera and microphone | **UNSUPPORTED in the Web App documentation summary:** the official `search_webapps_docs` response lists both as unsupported. Native DAT camera access is a separate path. [Web Apps build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/), retrieved through MCP |
| Web deployment | **VERIFIED:** glasses require a public HTTPS URL. Local Vite is for desktop development; a successful localhost test is not an on-glasses test. [Web Apps setup guide](https://wearables.developer.meta.com/docs/develop/webapps/setup/), retrieved through MCP |

No documented WebXR, SLAM, depth maps, world meshes, native spatial anchors, or calibrated 6DoF API was established by this audit. Kith must not claim these capabilities. `PseudoWorldAnchor` stores a direction and performs an approximate angular projection; it does not track translation, reconstruct objects, or establish a physical world coordinate system.

## Web App and DAT camera: observed interruption, bounded capture recovery

**User-observed behavior, September 20, 2026:** starting a DAT quest capture blanks the running Kith Display Web App, while the glasses camera LED remains active. This is the user's hardware report; the phone OS, Meta AI version, firmware and SDK state transitions were not recorded with it. Treat simultaneous gameplay and DAT camera access as unsuccessful on this setup. Do not present desktop tests or a successful upload as proof that the Web App stayed visible.

Queries to Meta's official documentation tools still do **not** establish concurrent support for a standalone foreground Web App and native DAT camera. Meta documents one device session at a time, transitions when another app or system experience starts, and exclusive control for an active native display session. Session states do not report why a transition occurred, so the observed blank display does not by itself prove the exact internal cause. Sources: [Session lifecycle](https://wearables.developer.meta.com/docs/develop/dat/lifecycle-events/) and [Display API](https://wearables.developer.meta.com/docs/reference/ios_swift/dat/latest/mwdatdisplay_display), retrieved through the [official public documentation MCP](https://mcp.developer.meta.com/wearables).

The recovery approach is a bounded capture: the user requests one photo or short clip, the native app captures it and releases DAT, and the user returns to Kith to review and explicitly submit to Muse. A hidden or closed Web App must not automatically cancel that requested capture. Preserve its bounded server-side result and the same player's reconnect identity; restore the authenticated current capture on return. Keeping a camera stream running after the evidence is collected would continue holding the device session.

The supported iOS release sequence is `camera.stop()` followed by `deviceSession.stop()`. Camera teardown cascades to its stream; the parent session must also end. Observe `stateStream()`/`statePublisher`: `.stopping` is transitional, and `.stopped` is terminal. Do not report release solely because `stop()` returned. The next capture needs a new session. See the [official iOS camera and lifecycle guidance](https://github.com/facebook/meta-wearables-dat-ios/blob/main/AGENTS.md), [DeviceSession API](https://wearables.developer.meta.com/docs/reference/ios_swift/dat/latest/mwdatcore_devicesession) and [0.9.0 changelog](https://github.com/facebook/meta-wearables-dat-ios/blob/main/CHANGELOG.md). The LED is an additional physical observation, not a replacement for SDK state confirmation.

After DAT stops, the documented user navigation is **Resume** in the middle-pinch Web App menu, if that menu remains available, or select **Kith** again from the glasses app grid. **Restart** reloads the Web App. Meta does not document automatic restoration of the prior Web App on DAT stop. The inspected public iOS 0.9.0 interfaces expose no API to launch or resume a standalone Web App; `openDATGlassesAppUpdate()` is an update/install flow. Source: [Web App setup and navigation](https://wearables.developer.meta.com/docs/develop/webapps/setup/).

Native `DeviceSession.addDisplay()` is a separate rendering route with full component layouts and MP4 playback. The public API exposes both camera and display attachments, but the documentation audit did not find an explicit simultaneous camera/display guarantee or a WebView/WebGL surface in the native display API. It is not an established drop-in replacement for the current game renderer. See the [official DisplayAccess sample](https://github.com/facebook/meta-wearables-dat-ios/tree/main/samples/DisplayAccess).

**Recovery remains `NEEDS_DEVICE_TEST`.** Record OS/app/firmware versions, camera and session state transitions, LED behavior and whether Kith resumes or must be reopened. Verify that every success, failure, timeout and explicit cancellation releases DAT, then that the same player can review and manually submit the retained evidence. Re-test other launch orders separately before claiming concurrent operation on any firmware.

## Mock tooling and verification limits

Meta's [FAQ](https://developers.meta.com/wearables/faq/) explicitly says Mock Device Kit currently does not support display glasses. Its [Mock Device Kit guide](https://wearables.developer.meta.com/docs/develop/dat/mock-device-kit/) describes simulated registration, permissions, camera media, and device states. Use those for supported native camera tests; do not treat them as a Display-device emulator.

The separate [official Display Simulator Chrome extension](https://github.com/facebook/meta-wearables-webapp#display-simulator-chrome-extension) previews 600×600 rendering, additive blending, backgrounds, D-pad input, and display settings. Those features do not demonstrate native DAT concurrency, physical sensor alignment, optical calibration, or thermal/latency behavior.

Additional `NEEDS_DEVICE_TEST` items: orientation signs and reference frame while worn; heading wrap/drift; actual sensor cadence; effective visible angular field of view; camera/display offsets; bright-environment visibility; and pause/resume behavior. A configurable simulated field of view is a software parameter, not an asserted hardware specification.

Some official sources differ on newer text-input/gesture/offline capabilities: the current MCP summary still excludes features for which the current GitHub toolkit has newer guidance. None are required by Milestone 1. Re-query and verify the specific feature before a later milestone depends on it.

## Repeating the documentation audit

The MCP tools accept `query` and optional `max_results` (maximum 10). Relevant searches used here:

- `search_dat_docs`: `Android v0.9.0 DeviceSession addCamera Camera stream videoStream StreamConfiguration session state lifecycle removeCamera`
- `search_dat_docs`: `Can a native DAT camera session run concurrently with a Display Web App? Session interrupted other app foreground display camera simultaneous`
- `search_dat_docs`: `Mock Device Kit Display glasses support Display MockDeviceKit limitations`
- `search_webapps_docs`: `Web Apps build guide rendering display black transparent viewport 600 600 sensors websocket`
- `search_webapps_docs`: `DeviceOrientationEvent alpha beta gamma axes orientation compass permissions timestamp motion sensors glasses capabilities`

Milestone 1 may proceed using simulated yaw, a fixed 600×600 black WebGL surface, and a software direction anchor. Hardware integration remains gated on the checks above.

## Interactive extension — September 19, 2026

The user subsequently requested their GLB, interactions, and head-based anchoring. `HeadOrientation` now consumes the documented orientation API after explicit activation, calibrates yaw/pitch signs and effective FOV against a distant point, and rejects stale or invalid readings. The HTML includes the documented glasses capability metadata; focusable buttons support arrows/Enter. The supplied mesh is optimized and loaded with Three.js GLTFLoader.

This extends the earlier simulator without asserting 6DoF or visual anchoring. No camera, MediaPipe, translation, or roll correction is present. Direction projection remains approximate. All previously listed **NEEDS_DEVICE_TEST** items remain open until physically tested; software tests only validate the implemented math, lifecycle, and UI behavior. Full launch/calibration steps are in `glasses-hardware-test.md`.
