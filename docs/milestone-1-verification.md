# Milestone 1 verification

Verified locally on September 19, 2026. This is a desktop simulator result, not a physical-glasses result.

## Build and dependency checks

- Clean `npm ci` succeeded using the lockfile (the verification run used an offline populated npm cache).
- `npm test`: **51 tests passed** with Vitest 4.1.11.
- `npm run build`: strict TypeScript checking and Vite production build passed.
- Installed dependency audit: **0 known vulnerabilities** at verification time.
- Locked versions: Three.js 0.180.0, TypeScript 5.9.3, Vite 6.4.3, Vitest 4.1.11.
- Vite reports a non-blocking chunk-size warning: the application including Three.js is about 522 kB minified / 136 kB gzip. No remote asset fetches are needed during playback.

## Browser checks performed

- Original Nova geometry rendered on black, with visible idle animation.
- Yaw 0°: centered at `(300, 300)`. Turning right to 15°: projection `(161, 300)`; Nova moved left.
- Yaw 45° with 60° FOV: out of view. Reversing to 15° restored Nova at `(161, 300)` with her stored anchor still at 0°.
- Keyboard Right changed simulated yaw. Placing at 90° stored that heading and centered Nova; the return shortcut restored the saved direction.
- Narrowing FOV to 20° hid Nova at a 15° offset.
- Browser navigation to `/display` and Back left the simulator responsive.
- `/display` at a 600×600 viewport: 600×600 canvas, `rgb(0, 0, 0)` page background, 600×600 page dimensions, zero buttons/inputs/sidebars, only Nova visible.
- Simulator checked at the default narrow desktop size and at 1280 px: no horizontal page overflow; drawing buffer stayed 600×600.
- No browser errors or warnings were reported during these checks.

The unit tests additionally cover pitch direction, FOV boundaries, yaw wrap at ±180°, invalid values, confidence gating, and stable projection when an unchanged anchor is reacquired. The complete user acceptance checklist is in [README.md](../README.md#manual-test-checklist).

Real-device sensor axes/drift, on-glasses performance, optical calibration, and simultaneous Web App + native camera access remain `NEEDS_DEVICE_TEST`. Milestone 2 has not started.
