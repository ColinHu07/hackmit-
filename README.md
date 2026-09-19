# Bondimals

## Phone-first shared playground

The phone companion discovers opted-in nearby pets (an approximate 10-meter GPS filter), lets two players agree to meet, and opens a shared 3D meadow automatically. Both can confirm a real-world hello and play together; room codes remain a fallback. Run `HOST=0.0.0.0 npm run play:server` and `npm run dev:phone` in separate terminals. Physical-phone location requires HTTPS and WSS, with both `/play` and `/nearby` forwarded to the server. See the [phone guide](companion-web/README.md) and [server deployment guide](docs/phone-server.md), including a clearly labeled local location demo. A server URL can be entered in app settings or configured at build time. Real-world AR alignment and joining from glasses remain later work.

## Glasses prototype

A little creature for Meta Ray-Ban Display. This demo loads the supplied **GLB0 character**, adds **Pet / Feed / Play** reactions, and supports a calibrated **direction anchor** through the glasses' documented orientation events.

- [Glasses app](https://colinhu07.github.io/bondimals-display/)
- [Desktop simulator](https://colinhu07.github.io/bondimals-display/?simulator)
- [Full source repository](https://github.com/ColinHu07/hackmit-)

The original Milestone 1 simulator has been extended at the user's request. An iPhone glasses-camera bridge, calibrated hand petting, and an optional desktop camera preview are implemented; follow the [camera setup guide](docs/hand-camera-bridge.md). Physical camera/display concurrency still needs a device test. Supabase and visual object anchors remain future work.

## Run locally

Node.js 22+ and a WebGL 2 browser are required. No secrets, backend, or account are needed.

```sh
git clone https://github.com/ColinHu07/hackmit-.git
cd hackmit-
npm ci
npm run dev
```

Open the printed Vite URL with **`?simulator`** (usually `http://127.0.0.1:5173/?simulator`). `/simulator` also works on the development server. Query routing works on GitHub Pages without SPA rewrites.

- **Simulator:** hold and stroke across Nova’s head to pet her, or click Pet, Feed, Play, or the character. Hover near her head to invite a lean. Click empty ground beside her to run there, **L** / **Run around** starts a short grounded scurry, and **J** / **Jump** jumps. Enter pets, F feeds, P plays. Arrows/WASD simulate head motion. **Distance to Nova** previews approaching/receding: 1 m makes her twice the size shown at 2 m, and 4 m halves it. This slider simulates distance; it does not measure your real movement. Space / **Move Nova here** sends Nova running to the direction you are looking; R faces her current direction, 0 resets the anchor. Native control keyboard behavior is preserved.
- **Glasses (`/`):** calibrated orientation input, bright focusable buttons, and a black 600×600 surface. Swipe to choose; pinch/Enter to activate. See [hardware instructions](docs/glasses-hardware-test.md).

## Glasses calibration

1. Center a stationary, distant point on the **middle +**, keeping the glasses level. Select **Enable head tracking**; allow motion access if requested.
2. Turn your head **right** until the same point reaches the **left +**, then confirm. This measures horizontal response and sign.
3. Recenter the same point; tilt **up** until it reaches the **bottom +**, then confirm. This measures vertical response and sign.
4. Look at the direction where Nova should appear. Select **Place Nova here**.
5. Swipe between **Pet**, **Feed**, **Play**, and **Move here**. After initial placement, **Move here** makes Nova run to the direction you are looking with a smooth start and stop. A run continues while outside your view and retargets from her current position if requested again. Looking away without a move command leaves her direction unchanged.

Choose a distant reference to reduce parallax during calibration. Stay in the same physical position and keep head roll small. Calibration estimates the effective horizontal/vertical FOV from the point's angular movement to markers 16px inside the display. The simulator retains its configurable 60° default. No hardware FOV is hard-coded or claimed as measured before calibration.

Head angles are sampled at display cadence with adaptive smoothing, a short bounded motion prediction, and rejection of isolated implausible sensor jumps. Angle wrap is handled before smoothing. Calibration uses the sensor measurements directly; its sign and FOV checks are unchanged. These changes reduce sample stepping and spikes, but physical latency and sensor-axis behavior still need an on-glasses test.

No sensor API, denied permission, null readings, or a stream without updates produces a visible status instead of a falsely anchored character. A gap longer than 1.2 seconds or page suspension invalidates placement and requires explicit restart/calibration. Permission is requested only after selection; listeners stop on page exit/backgrounding.

**Scope:** this is approximate yaw/pitch direction anchoring. It does not compensate for translation or roll, reconstruct the room, recognize objects, or pin a pet to a physical table. It can drift. On-glasses optics, sensor reference frame, latency, and drift still require the user's hardware test. The separate camera pipeline uses calibrated 2D hand points; it does not add depth or room tracking. Physical walk-closer scaling therefore still needs a measured distance/position source. Head tilt and hand size are not used as substitutes for depth. Simulator scaling also scales the character’s effects, ground travel, and petting targets.

## Character and interactions

The supplied **colored** model was reduced from **1,972,568 triangles / 51.3 MB** to **69,000 triangles / 1.38 MB** with color-aware simplification. This preserves small painted features such as pupils, eye highlights, and teeth that the earlier geometry-only reduction damaged; see [model processing](docs/character-model.md). It has no rig, textures, or embedded animation clips. The renderer supersamples at 1.5–2× resolution, keeping a logical 600×600 display and unchanged input coordinates. Neutral fill lighting and a feathered contact cue replace the purple cast and hard floor disk. This improves the supplied stylized model; it does not turn it into a photoreal animal or measure the room's lighting.

Runtime animation rotates the face as a rigid region with blending at the neck, and alternates planted feet with lifted swing steps, without modifying the source. Nova gently shifts between interactions, nuzzles toward touch with hearts when petted, nods toward a treat when fed, and scurries when playing. Hand and pointer proximity invite a spring-damped lean. Procedural reactions, idle, and landings preserve body scale instead of squashing or stretching the character. Visible animation and head tracking render on every display frame without the former 30 Hz cap; hidden or unchanged reduced-motion scenes skip rendering. Reduced-motion mode keeps the character still and uses static hearts or a treat for feedback.

Running uses a 120 Hz physics step with acceleration, speed limits, braking before turns, conserved horizontal momentum during explicit jumps, gravity, and floor/stage-edge collisions. The default run stays grounded, with alternating stance and swing phases tied to distance traveled. Jumping adds a brief planted crouch, leg extension at takeoff, tucked feet in flight, and a landing bend with a delayed head nod before recovering. The torso and face keep their proportions; foot tucking does not alter the ballistic body trajectory. Foot contact accounts for the animated mesh so leaning, landings, and foot swings stay above the floor. A contact shadow shrinks in opacity during flight. Local wandering stays beneath the saved anchor and pauses out of view. Explicit **Move here** travel changes the anchor smoothly and continues offscreen until arrival; its running gait follows travel distance. Moving from a local wander transfers the current horizontal position into the anchor before starting, avoiding a snap home. Pet/feed/play interrupt anchor travel at the current location. The ground and stage bounds are simulated: there is no detected real-world floor, furniture collision, or room reconstruction.

No animation software is required for these reactions. For independently moving eyes, mouth, or limbs, use the [Blender animation workflow](docs/character-animation.md). The renderer also accepts optional embedded `Idle`, `Pet`, `Feed`, and `Play` clips, blends between them, and uses procedural reactions when a clip is missing.

Connections are local feedback for this visit, reset on reload. Actions cannot stack while a reaction is playing or target Nova when she is out of view. Petting/feed/play never alter the saved anchor. The future backend remains authoritative for persistent pet state.

## Team boundaries

```text
glasses-web/src/main.ts                      App/input/UI integration
glasses-web/src/rendering/NovaRenderer.ts     GLTF loading, effects, WebGL lifecycle
glasses-web/src/rendering/NovaMotion.ts       Spring-damped reach, procedural poses
glasses-web/src/rendering/SoftHead.ts         Rigid head rotation with neck blending
glasses-web/src/rendering/SoftGait.ts         Distance-matched stance and swing footsteps
glasses-web/src/rendering/NovaLocomotion.ts   Fixed-step movement, gravity, ground contact state
glasses-web/src/rendering/GroundContact.ts    Animated-mesh floor correction
glasses-web/src/rendering/CharacterClips.ts   Optional authored GLB animation playback
glasses-web/src/interaction/CreatureSession.ts  Typed pet/feed/play actions, temporary state
glasses-web/src/input/HeadOrientation.ts      Permissions, calibration, sensor freshness
glasses-web/src/input/SimulatedOrientation.ts  Desktop head-motion controls
glasses-web/src/anchor/PseudoWorldAnchor.ts   Placement and pure angular projection
glasses-web/public/models/nova.glb            Optimized supplied character
companion-web/                               Placeholder for phone/web companion
backend/                                     Placeholder for authoritative Supabase state
glasses-android/                             Placeholder for DAT camera bridge
```

Hand observations now reach `CreatureSession.perform()` through `HandInteraction`. The iPhone uses Apple Vision on the glasses camera stream. Android MediaPipe contributors can publish the same shared 21-point protocol; Rohan’s native Android prototype remains on `rohan`. See [camera transport, pairing, and calibration](docs/hand-camera-bridge.md). Keep camera/native transport separate from the renderer. See [Meta capability audit](docs/meta-capabilities.md), especially the unresolved native-camera/Web-App concurrency test.

## Verify and build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The tests cover projection signs, unchanged-anchor return, wraparound, invalid inputs, calibration/FOV, permissions, stale data, listener cleanup, interaction gating, pointer strokes/ground clicks, animation transitions, reduced-motion poses, generated deformation, actual-asset vertex color preservation and floor clearance, and physics invariants across frame rates. Browser checks cover the colored GLB, running, jumping, ground-click movement, and reactions. Physical glasses behavior is **not yet verified**.

The build produces `glasses-web/dist/` and stages a copy to root `dist/`. GitHub Pages publishes compiled output in the separate `ColinHu07/bondimals-display` repository. Rebuild with `--base=/bondimals-display/`; see [deployment instructions](docs/glasses-hardware-test.md).
