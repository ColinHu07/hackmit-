# Bondimals

A shared little creature, seen through Meta Ray-Ban Display glasses. **Milestones 0 and 1 only:** capability verification and a locally runnable glasses simulator. Nova is an original procedural Three.js creature with idle breathing, bobbing, and blinking.

**Stop point:** do not start Milestone 2 until the user confirms the simulator works.

## Run locally

Requirements: **Node.js 22+** and npm. WebGL 2 must be enabled in your browser. Dependencies are locked in `package-lock.json`; no account, environment configuration, backend, glasses, camera permission, or API key is required.

```sh
git clone https://github.com/ColinHu07/hackmit-.git
cd hackmit-
npm ci
npm run dev
```

Open **[the desktop simulator](http://127.0.0.1:5173/simulator)**. If Vite reports a different port, use that port with `/simulator`.

If you already have the repository checked out, run `npm ci` and `npm run dev` from its root. The full source repository is `ColinHu07/hackmit-`; `ColinHu07/bondimals-display` contains only the compiled GitHub Pages demo. See [the hardware-test notes](docs/glasses-hardware-test.md) for the current glasses URL.

- `/simulator`: desktop controls, 600×600 render buffer, anchor telemetry, and local transition log. On a narrow browser the preview scales visually to fit; its drawing buffer remains 600×600.
- `/display` or `/`: **only** the fixed 600×600 black canvas and Nova. No debugging controls or telemetry are mounted. In this milestone it is an idle display preview at the initial simulated orientation, not live head tracking.

The explicit simulator route prevents debugging UI from appearing on a glasses URL. No user-agent or device-size detection is used. The page and canvas are pure `#000000` in display mode; black contributes no light on an additive display. The desktop simulator's surrounding controls are outside that display surface.

## Manual test checklist

1. Open `/simulator`. Nova should be small, centered near `(300, 300)`, gently breathing/bobbing on a black square. Status: **In view**. Stored heading: **0.0°**. Most pixels remain black.
2. Click the black preview to move focus away from controls, then hold **Right arrow** (or **D**). Yaw increases; Nova moves **left**. With the default 60° simulated FOV, she disappears once yaw passes **+30°**. The stored heading stays **0.0°**. **Out of view** and `ANCHOR_LOST` appear in the desktop status/log.
3. Hold **Left arrow** (or **A**) to reverse. Nova enters from the **left**, returning to center at yaw 0°. Press **R** to look exactly at the saved anchor. Turning left from 0° instead moves Nova to the right. The buttons turn in 15° steps and the slider allows exact angles.
4. Set yaw to about **90°**, then click **Place Nova here** (or focus the preview and press **Space**). Stored heading becomes 90° and Nova appears at center. Look away, then press **R**: she returns to that saved direction. Placement is the only action that moves the anchor, apart from reset.
5. Expand **Fine-tune the simulation**. Adjust pitch: looking up moves Nova down. Change FOV to **20°**; Nova now disappears beyond ±10° relative to her anchor. Test yaw wrap by placing near +175°, then crossing +180°/−180°: she stays nearby, with no full-circle jump. Reset with **Reset simulation** or **0** while the preview has focus.
6. Open **Open display view**. It should show only the black 600×600 surface with idle Nova, without controls, telemetry, page chrome, or session notes. Return to the simulator to continue testing. Reloading starts a fresh local simulation.

Native slider keyboard behavior is retained while sliders have focus. Click the black preview before using the simulation keyboard shortcuts. If reduced motion is enabled in your OS, idle movement is intentionally disabled. If WebGL is unavailable or its context is lost, the app displays a clear error instead of silently failing.

## Verify and build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The preview command serves the production build; open its reported URL with `/simulator`. The test suite covers projection direction, unchanged-anchor re-entry, yaw wrap, pitch, inclusive FOV boundaries, low confidence, and invalid inputs. Run the manual checklist for actual rendering and input behavior.

See [the verification record](docs/milestone-1-verification.md) for the checks performed on this implementation.

The simulator uses Three.js (WebGL 2), TypeScript strict mode, Vite 6 (compatible with the workspace's Node 22.3), and Vitest. Production output is in `glasses-web/dist/`; the root build also copies it to `dist/` for static hosting. A static host must serve `index.html` as a fallback for `/simulator` and `/display`. Physical glasses testing requires HTTPS; localhost is not a glasses deployment.

## Files and component boundaries

```text
glasses-web/
  index.html                         HTML entry, black display shell
  package.json, tsconfig.json         Vite / strict TypeScript / tests
  public/favicon.svg                 Original small creature icon
  src/main.ts                        App wiring, desktop UI, transition logging
  src/style.css                      Simulator shell + isolated display styling
  src/input/SimulatedOrientation.ts   Keyboard yaw/pitch source
  src/anchor/PseudoWorldAnchor.ts     Pure placement + angular projection
  src/anchor/PseudoWorldAnchor.test.ts
  src/rendering/NovaRenderer.ts       Geometry, idle animation, WebGL lifecycle
glasses-android/README.md             Reserved for Milestone 4
companion-web/README.md               Reserved for Milestone 2
backend/README.md                     Reserved for Supabase in Milestone 3
docs/meta-capabilities.md             Official evidence + device-test gates
docs/milestone-1-verification.md       Build, test, and browser-check results
package.json, package-lock.json       npm workspace and locked dependencies
.env.example, .gitignore              No secrets needed in this milestone
```

`PseudoWorldAnchor` stores yaw, pitch, ID, and confidence independently of head orientation. Each frame derives a transient projection containing screen X/Y, angular offsets, visibility, and confidence. It uses shortest-path yaw differences and tangent projection within a configurable rectangular FOV. FOV defaults to 60° horizontally and vertically **for simulation**, not as a hardware specification. Boundary centers are visible; beyond the cone the entire creature is hidden. At the boundary its geometry naturally clips against the canvas.

This is **direction anchoring**, not 6DoF, object recognition, SLAM, or a native spatial anchor. It ignores translation and does not attach Nova to an actual object. Confidence is synthetic; no sensor is consulted. All state is ephemeral and browser-local, with no claims of multiplayer or persistence. The future backend is authoritative for persistent game state.

## Meta capability baseline

See [the capability audit](docs/meta-capabilities.md) for official source links and evidence retrieved on September 19, 2026.

- No installed Meta Wearables plugin was found in this environment. Meta's official public documentation MCP and GitHub repositories were consulted directly.
- The exact future Android DAT target is **0.9.0**; **no DAT SDK is used by Milestone 1**.
- The documented native camera path is `DeviceSession.addCamera(StreamConfiguration)` → `Camera.stream`. Removed `addStream(...)` APIs must not be used.
- Meta documents 600×600 additive display rendering and standard orientation events for Web Apps. This milestone deliberately uses simulated orientation; glasses axis mapping, drift, sensor availability, and calibration require hardware testing.
- Web App camera access is not supported in the documentation reviewed. Native DAT streaming is a separate future milestone.
- Concurrent Display Web App + native DAT camera operation: **`NEEDS_DEVICE_TEST`**. No concurrency support is assumed.
- Mock Device Kit currently does not support Display glasses. Browser rendering simulation does not verify native camera/display concurrency.

Milestones 2–8 (phone companion, Supabase, DAT camera, hands, petting, visual anchors, and shared quests) are intentionally unimplemented.
