# Bondimals

A little creature for Meta Ray-Ban Display. This demo loads the supplied **GLB0 character**, adds **Pet / Feed / Play** reactions, and supports a calibrated **direction anchor** through the glasses' documented orientation events.

- [Glasses app](https://colinhu07.github.io/bondimals-display/)
- [Desktop simulator](https://colinhu07.github.io/bondimals-display/?simulator)
- [Full source repository](https://github.com/ColinHu07/hackmit-)

The original Milestone 1 simulator has been extended at the user's request. An iPhone glasses-camera bridge, calibrated hand petting, an optional desktop camera preview, and an optional persistent multiplayer server are implemented. Follow the [camera setup guide](docs/hand-camera-bridge.md) and [server guide](backend/README.md). Physical camera/display concurrency still needs a device test. Visual object anchors remain future work.

## Run locally

Node.js 22+ and a WebGL 2 browser are required. The local simulation runs without an account or server. To enable rooms and persistent state, follow the [server setup](backend/README.md).

```sh
git clone https://github.com/ColinHu07/hackmit-.git
cd hackmit-
npm ci
npm run dev
```

Open the printed Vite URL with **`?simulator`** (usually `http://127.0.0.1:5173/?simulator`). `/simulator` also works on the development server. Query routing works on GitHub Pages without SPA rewrites.

- **Simulator:** hold and stroke across Nova’s head to pet her, or click Pet, Feed, Play, or the character. Hover near her head to invite a lean. Click empty ground beside her to run there, **L** / **Run around** starts a short run with hops, and **J** / **Jump** jumps. Enter pets, F feeds, P plays. Arrows/WASD simulate head motion. Space places Nova, R faces the saved direction, 0 resets the anchor. Native control keyboard behavior is preserved.
- **Glasses (`/`):** calibrated orientation input, bright focusable buttons, and a black 600×600 surface. Swipe to choose; pinch/Enter to activate. See [hardware instructions](docs/glasses-hardware-test.md).

## Glasses calibration

1. Center a stationary, distant point on the **middle +**, keeping the glasses level. Select **Enable head tracking**; allow motion access if requested.
2. Turn your head **right** until the same point reaches the **left +**, then confirm. This measures horizontal response and sign.
3. Recenter the same point; tilt **up** until it reaches the **bottom +**, then confirm. This measures vertical response and sign.
4. Look at the direction where Nova should appear. Select **Place Nova here**.
5. Swipe between **Pet**, **Feed**, **Play**, and **Move here**. Looking away hides Nova; looking back should restore the same saved direction.

Choose a distant reference to reduce parallax during calibration. Stay in the same physical position and keep head roll small. Calibration estimates the effective horizontal/vertical FOV from the point's angular movement to markers 16px inside the display. The simulator retains its configurable 60° default. No hardware FOV is hard-coded or claimed as measured before calibration.

No sensor API, denied permission, null readings, or a stream without updates produces a visible status instead of a falsely anchored character. A gap longer than 1.2 seconds or page suspension invalidates placement and requires explicit restart/calibration. Permission is requested only after selection; listeners stop on page exit/backgrounding.

**Scope:** this is approximate yaw/pitch direction anchoring. It does not compensate for translation or roll, reconstruct the room, recognize objects, or pin a pet to a physical table. It can drift. On-glasses optics, sensor reference frame, latency, and drift still require the user's hardware test. The separate camera pipeline uses calibrated 2D hand points; it does not add depth or room tracking.

## Character and interactions

The supplied **colored** model was reduced from **1,972,568 triangles / 51.3 MB** to **23,670 triangles / 475 KB**, preserving its vertex colors and material; see [model processing](docs/character-model.md). It has no rig, textures, or embedded animation clips. Runtime-generated morph targets add a soft head tilt, bow, and alternating foot motion without modifying the source. Nova breathes between interactions, nuzzles with hearts when petted, nods toward a treat when fed, and runs and hops when playing. Hand and pointer proximity smoothly invite a lean. Visible animation renders at up to 30 Hz; hidden or unchanged reduced-motion scenes skip rendering. Reduced-motion mode keeps the character still and uses static hearts or a treat for feedback.

Running uses a 120 Hz physics step with acceleration, speed limits, braking before turns, conserved horizontal momentum during jumps, gravity, and floor/stage-edge collisions. Foot contact accounts for the animated mesh so leaning, landing squash, and foot swings stay above the floor. A contact shadow shrinks in opacity during flight. Movement is local to the saved anchor and pauses out of view. The ground and stage bounds are simulated: there is no detected real-world floor, furniture collision, or room reconstruction.

No animation software is required for these reactions. For independently moving eyes, mouth, or limbs, use the [Blender animation workflow](docs/character-animation.md). The renderer also accepts optional embedded `Idle`, `Pet`, `Feed`, and `Play` clips, blends between them, and uses procedural reactions when a clip is missing.

Without a server, connections are local feedback for this visit and reset on reload. With the server configured, the simulator displays persistent pet state and player interaction rewards. Actions cannot stack while a reaction is playing or target Nova when she is out of view. Petting/feed/play never alter the saved anchor.

## Team boundaries

```text
glasses-web/src/main.ts                      App/input/UI integration
glasses-web/src/rendering/NovaRenderer.ts     GLTF loading, effects, WebGL lifecycle
glasses-web/src/rendering/NovaMotion.ts       Breathing, reach smoothing, procedural poses
glasses-web/src/rendering/SoftHead.ts         Generated head morph targets for the static asset
glasses-web/src/rendering/SoftGait.ts         Speed-matched foot deformation
glasses-web/src/rendering/NovaLocomotion.ts   Fixed-step movement, gravity, ground contact state
glasses-web/src/rendering/GroundContact.ts    Animated-mesh floor correction
glasses-web/src/rendering/CharacterClips.ts   Optional authored GLB animation playback
glasses-web/src/interaction/CreatureSession.ts  Typed pet/feed/play actions, temporary state
glasses-web/src/input/HeadOrientation.ts      Permissions, calibration, sensor freshness
glasses-web/src/input/SimulatedOrientation.ts  Desktop head-motion controls
glasses-web/src/anchor/PseudoWorldAnchor.ts   Placement and pure angular projection
glasses-web/public/models/nova.glb            Optimized supplied character
companion-web/                               Placeholder for phone/web companion
backend/                                     Persistent multiplayer game server and SQLite store
glasses-android/                             Placeholder for DAT camera bridge
```

Hand observations now reach `CreatureSession.perform()` through `HandInteraction`. The iPhone uses Apple Vision on the glasses camera stream. Android MediaPipe contributors can publish the same shared 21-point protocol. See [camera transport, pairing, and calibration](docs/hand-camera-bridge.md). Keep camera/native transport separate from the renderer. See [Meta capability audit](docs/meta-capabilities.md), especially the unresolved native-camera/Web-App concurrency test.

## Verify and build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The tests cover projection signs, unchanged-anchor return, wraparound, invalid inputs, calibration/FOV, permissions, stale data, listener cleanup, interaction gating, pointer strokes/ground clicks, animation transitions, reduced-motion poses, generated deformation, actual-asset vertex color preservation and floor clearance, and physics invariants across frame rates. Browser checks cover the colored GLB, running, jumping, ground-click movement, and reactions. Physical glasses behavior is **not yet verified**.

The build produces `glasses-web/dist/` and stages a copy to root `dist/`. GitHub Pages publishes compiled output in the separate `ColinHu07/bondimals-display` repository. Rebuild with `--base=/bondimals-display/`; see [deployment instructions](docs/glasses-hardware-test.md).
