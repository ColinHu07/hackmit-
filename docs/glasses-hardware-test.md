# Glasses interaction and anchoring test — Build 002

Use **https://colinhu07.github.io/bondimals-display/** in the saved Bondimals web app. Restart the app from the glasses' web-app menu to load the update. The phone's saved URL screen is a settings page, not a launch button.

The desktop version is **https://colinhu07.github.io/bondimals-display/?simulator**. It uses simulated orientation and works without glasses.

## Device test

1. Expect a black display with calibration markers and **Enable head tracking**. Center a fixed, distant real-world point on the middle +, then select Enable. Grant orientation access if prompted.
2. Turn right until that same point reaches the left +. Select **Confirm right turn**.
3. Recenter the same point, then tilt up until it reaches the bottom +. Select **Confirm upward tilt**. Head yaw must be near the initial heading for this step.
4. Face where Nova should sit; select **Place Nova here**. The supplied white character should appear near the middle.
5. Swipe to select Pet, Feed, or Play and pinch to activate. Expect a lean/hearts, a treat/nibble, or a hop/spin respectively. The connection count is local to the visit (visible in the desktop simulator).
6. Turn slightly right: Nova should move left across the lens. Turn beyond the visible cone: Nova disappears, while the action rail shows where to look. Look back: the character returns without re-placement. Repeat vertically. **Move here** is the explicit action that changes the anchor.
7. Background/resume the app: tracking must stop and require explicit enable/calibration again. No-motion and denied-permission paths must show a message and leave Nova unanchored/hidden.

Do these tests from the same physical position, with small head roll. This is an approximate yaw/pitch direction anchor, not a physical object anchor. Walking around the reference, tilting the head sideways, or sensor drift can break alignment. Optical calibration, input gestures, real sensor cadence/axes, latency, and drift remain **NEEDS_DEVICE_TEST**. Do not report browser results as hardware validation.

## Implementation

`DeviceOrientationEvent` supplies alpha/beta as documented by [Meta's sensor guide](https://github.com/facebook/meta-wearables-webapp/blob/main/plugins/meta-wearables-webapp/skills/add-device-sensors/SKILL.md). Setup measures sign and effective FOV in each axis instead of assuming firmware sign or a published diagonal FOV. Markers are at x=16 and y=584 on a 600px square. Full FOV is `2 * atan(tan(abs(sensorDelta)) * 300 / 284)`.

Only explicit user activation starts sensor listening. Invalid/null readings are rejected. A 1.2-second gap invalidates the old reference; fresh readings cannot silently recover that old anchor. Sensor changes update projection; pet/feed/play apply local transforms beneath the saved anchor.

## Hosting

Source: [ColinHu07/hackmit-](https://github.com/ColinHu07/hackmit-). Static deployment: [ColinHu07/bondimals-display](https://github.com/ColinHu07/bondimals-display), branch `codex/display`, root `/`.

The user previously saw the saved app on the phone but not in the glasses launcher. The older ChatGPT Sites host injected a Cloudflare browser-check script absent from the working Game Pigeon GitHub Pages site. That was a possible compatibility factor, not a proven cause. The current app uses GitHub Pages and includes the documented `mrbd-web-app-capable` metadata. The old Sites host is not updated by this release.

## Deploy

From the monorepo, with the deployment repo checked out at `/tmp/bondimals-pages-preview`:

```sh
npm run typecheck
npm test
npm exec --workspace @bondimals/glasses-web -- vite build --base=/bondimals-display/ --outDir=/tmp/bondimals-pages-preview
```

Keep `.nojekyll` in the deployment checkout. Commit and push the generated `index.html`, `favicon.svg`, `models/`, and `assets/` to `codex/display`. Remove obsolete hashed assets from the deployment checkout after reviewing the generated diff. Never include credentials, dependencies, or `.env` files. Verify GitHub Pages build success and the published GLB/JS URLs.

Hardware result: awaiting user test. Software validation is recorded in the README; the Milestone 1 verification document is a historical record of the earlier procedural demo.
