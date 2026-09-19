# Bondimals

A little creature for Meta Ray-Ban Display. This demo loads the supplied **GLB0 character**, adds **Pet / Feed / Play** reactions, and supports a calibrated **direction anchor** through the glasses' documented orientation events.

- [Glasses app](https://colinhu07.github.io/bondimals-display/)
- [Desktop simulator](https://colinhu07.github.io/bondimals-display/?simulator)
- [Full source repository](https://github.com/ColinHu07/hackmit-)

The original Milestone 1 simulator has been extended at the user's request. Companion, Supabase, DAT camera, MediaPipe hands, and visual object anchors remain future work.

## Run locally

Node.js 22+ and a WebGL 2 browser are required. No secrets, backend, or account are needed.

```sh
git clone https://github.com/ColinHu07/hackmit-.git
cd hackmit-
npm ci
npm run dev
```

Open the printed Vite URL with **`?simulator`** (usually `http://127.0.0.1:5173/?simulator`). `/simulator` also works on the development server. Query routing works on GitHub Pages without SPA rewrites.

- **Simulator:** click Pet, Feed, Play, or the character. Enter pets, F feeds, P plays. Arrows/WASD simulate head motion. Space places Nova, R faces the saved direction, 0 resets the anchor. Native control keyboard behavior is preserved.
- **Glasses (`/`):** calibrated orientation input, bright focusable buttons, and a black 600×600 surface. Swipe to choose; pinch/Enter to activate. See [hardware instructions](docs/glasses-hardware-test.md).

## Glasses calibration

1. Center a stationary, distant point on the **middle +**, keeping the glasses level. Select **Enable head tracking**; allow motion access if requested.
2. Turn your head **right** until the same point reaches the **left +**, then confirm. This measures horizontal response and sign.
3. Recenter the same point; tilt **up** until it reaches the **bottom +**, then confirm. This measures vertical response and sign.
4. Look at the direction where Nova should appear. Select **Place Nova here**.
5. Swipe between **Pet**, **Feed**, **Play**, and **Move here**. Looking away hides Nova; looking back should restore the same saved direction.

Choose a distant reference to reduce parallax during calibration. Stay in the same physical position and keep head roll small. Calibration estimates the effective horizontal/vertical FOV from the point's angular movement to markers 16px inside the display. The simulator retains its configurable 60° default. No hardware FOV is hard-coded or claimed as measured before calibration.

No sensor API, denied permission, null readings, or a stream without updates produces a visible status instead of a falsely anchored character. A gap longer than 1.2 seconds or page suspension invalidates placement and requires explicit restart/calibration. Permission is requested only after selection; listeners stop on page exit/backgrounding.

**Scope:** this is approximate yaw/pitch direction anchoring. It does not compensate for translation or roll, reconstruct the room, recognize objects, or pin a pet to a physical table. It can drift. On-glasses optics, sensor reference frame, latency, and drift still require the user's hardware test. Camera/MediaPipe tracking is not implemented by this update.

## Character and interactions

The supplied model was reduced from **1,972,568 triangles / 35.5 MB** to a **190 KB runtime GLB**; see [model processing](docs/character-model.md). It has no rig, textures, or animation clips. Reactions animate the mesh as a whole: a petting lean with hearts, a treat with a nibbling motion, and a happy hop/spin. Reduced-motion mode suppresses large movements. The model remains still between interactions; unchanged frames skip WebGL rendering.

Connections are local feedback for this visit, reset on reload. Actions cannot stack while a reaction is playing or target Nova when she is out of view. Petting/feed/play never alter the saved anchor. The future backend remains authoritative for persistent pet state.

## Team boundaries

```text
glasses-web/src/main.ts                      App/input/UI integration
glasses-web/src/rendering/NovaRenderer.ts     GLTF loading, reactions, WebGL lifecycle
glasses-web/src/interaction/CreatureSession.ts  Typed pet/feed/play actions, temporary state
glasses-web/src/input/HeadOrientation.ts      Permissions, calibration, sensor freshness
glasses-web/src/input/SimulatedOrientation.ts  Desktop head-motion controls
glasses-web/src/anchor/PseudoWorldAnchor.ts   Placement and pure angular projection
glasses-web/public/models/nova.glb            Optimized supplied character
companion-web/                               Placeholder for phone/web companion
backend/                                     Placeholder for authoritative Supabase state
glasses-android/                             Placeholder for DAT camera bridge
```

MediaPipe contributors can use `CreatureAction` and `CreatureSession.perform()` as the interaction boundary. Future observations must be mapped into that API through explicit app wiring; no camera/hand pipeline currently calls it. Keep camera/native transport separate from the renderer. See [Meta capability audit](docs/meta-capabilities.md), especially the unresolved native-camera/Web-App concurrency test.

## Verify and build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The **64 tests** cover projection signs, unchanged-anchor return, wraparound, invalid inputs, calibration/FOV, permissions, stale data, listener cleanup, and interaction gating. Browser checks confirm GLB rendering, all three reactions, opposite motion, re-placement/return, and the no-sensor fallback. Physical glasses behavior is **not yet verified**.

The build produces `glasses-web/dist/` and stages a copy to root `dist/`. GitHub Pages publishes compiled output in the separate `ColinHu07/bondimals-display` repository. Rebuild with `--base=/bondimals-display/`; see [deployment instructions](docs/glasses-hardware-test.md).
