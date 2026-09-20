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

## Concurrent Web App and DAT camera: NEEDS_DEVICE_TEST

Queries to both official documentation tools did **not** establish explicit support for a foreground Display Web App running alongside a native DAT camera session on the same glasses.

The DAT documentation's “Sessions” section says a device supports one session at a time. Its native display section also describes exclusive display control during a display session. These statements are important constraints but do not settle the specific camera-only DAT plus standalone Web App combination. Source: [public Meta documentation MCP](https://mcp.developer.meta.com/wearables), `search_dat_docs`; the result links to [Session lifecycle](https://wearables.developer.meta.com/docs/develop/dat/lifecycle-events/).

**Status: `NEEDS_DEVICE_TEST`.** Before integrating those components, record phone OS, Meta AI version, glasses firmware, DAT version, and launch order. Test camera-first and Web-App-first; observe session/stream transitions, camera frame arrival, foreground display visibility, and interruption/recovery. Passing a desktop renderer test does not validate this combination.

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
