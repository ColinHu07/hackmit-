# Glasses camera preview and optional web petting

The iPhone now shows the glasses camera and hand skeleton directly, with **web sharing off by default**. No relay, Cloudflare account, pairing URL, or network change is required for this visualization. Register with Meta AI and start the camera. Stale images disappear after 0.6 seconds; stopping or backgrounding clears the preview.

The character continues to run in the GitHub Pages web app. For optional web petting, the iPhone app can also act as a camera bridge: Meta DAT reads the **glasses** camera, Apple Vision detects hands, and a small WebSocket relay sends landmarks to Kith. If **Allow desktop camera preview** is enabled on the phone, the desktop simulator can optionally request a 320px, up-to-4-fps camera preview with matching hand points drawn over it. The glasses viewer never subscribes to images. Turning the preview off stops image encoding once the last desktop viewer unsubscribes.

No phone camera, laptop camera, browser `getUserMedia`, recording, or native display capability is used. Frames and landmarks are forwarded in memory; pairing keys are written only to an ignored local file. TLS ends at whichever public relay/tunnel host you choose, so that host handles camera-derived traffic. Use a trusted host and keep pairing links private.

## Why iPhone code exists

Meta's [Web Apps build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) lists browser camera access as unsupported. The native [iOS camera sample](https://github.com/facebook/meta-wearables-dat-ios/tree/main/samples/CameraAccess) exposes the glasses stream through DAT. The iPhone receives it; GitHub Pages still hosts the character and desktop monitor.

Rohan's `origin/rohan` commit `807a8d0` is an Android MediaPipe prototype with a separate native display renderer. It has not been merged into this iPhone implementation. The [JARVIS-Cube reference](https://github.com/ColinHu07/JARVIS-Cube) uses Apple Vision on iPhone, which this bridge also uses; this bridge uses current DAT 0.9.0 and deliberately excludes the reference's phone-camera fallback. Android MediaPipe can produce the same 21-point protocol later without changing Nova's renderer.

## Optional: run the hand-point relay

Skip this section for phone-only visualization. Sending hand points to the web character still needs a relay. From the repository root:

```sh
npm ci
npm run bridge
```

This binds `127.0.0.1:8787`. `/health` reports readiness. For desktop-only local development, set `BONDIMALS_WEB_URL=http://127.0.0.1:5173/` before starting. The generated `.bondimals-bridge/pairing.json` holds separate publisher/viewer tokens and `phoneLink`, `glassesLink`, and `simulatorLink`. Never commit or publish that file.

Physical phones/glasses need a reachable **WSS** endpoint, not localhost. Run the relay behind your trusted HTTPS reverse proxy, or use an explicitly approved temporary tunnel. Set `BONDIMALS_RELAY_URL=wss://YOUR_HOST/ws` before starting the relay; this regenerates the links while preserving room keys. The web app stays at its existing GitHub Pages address. GitHub Pages itself cannot run the relay process. `PORT`, `BONDIMALS_BIND`, and `BONDIMALS_BRIDGE_STATE` are optional deployment settings. Do not expose a plaintext relay directly to the internet.

## Install the iPhone bridge

1. Open `glasses-ios/BondimalsCamera.xcodeproj` in Xcode. The project pins Meta DAT **0.9.0** and links only Core and Camera.
2. Connect/unlock the paired iPhone, select it as the run destination, and choose your signing team. Enable the device's developer mode if Xcode requests it. The project uses `META_APP_ID=0` / `CLIENT_TOKEN=0` for Meta developer-mode testing; configure your own Meta app credentials if using a registered production integration. Credentials do not belong in source control.
3. Build and run **BondimalsCamera**. Tap **Register with Meta AI**, complete registration, then tap **Start glasses camera** and accept the glasses-camera permission prompt. The local preview requires no pairing link. Move your hand into the glasses camera view to see the skeleton; the index fingertip is white.
4. Keep the bridge foregrounded. Backgrounding stops the stream. Change the camera rotation only while stopped; use the phone preview to check orientation, then start again.

Both the unsigned and signed iPhone builds compiled successfully with Xcode 26.6 / iOS SDK 26.5. The signed app is ready for installation, but the iPhone was unavailable to Xcode during validation. Physical iPhone/glasses streaming remains unverified.

## Optional: connect and align web petting

First, while stopped, expand **Optional web connection**, enable **Send hand points to Nova**, and paste `phoneLink`. Start the camera. A relay connection failure leaves the phone preview running and shows a separate web status. To keep video on the phone, leave **Allow desktop camera preview** off.

1. Open `simulatorLink` on your computer. For an optional remote preview, enable **Allow desktop camera preview** on the phone before starting, then click **Show glasses camera** on the desktop. Both switches are required for images to leave the phone.
2. Save/open `glassesLink` as the glasses Web App. Finish head-direction calibration and place Nova.
3. Select **Hands** on the glasses. Hold the same index fingertip over each of three `+` markers, at your intended petting distance, and confirm each with the neural band's selection gesture. Keep the finger still for at least 0.3 seconds before each confirmation.
4. Gently stroke across the top of Nova's head. Nearby hand movement invites a small lean; a sustained stroke triggers the existing pet action. The saved direction anchor is unchanged.

Camera/display alignment is a three-point 2D approximation at the calibrated hand distance. It is not hand depth estimation, SLAM, or a world-space surface anchor. Re-align after moving the glasses on your face or changing petting distance. A reconnect, source dimensions change, or stream change clears hand alignment. Missing hands or frames older than 350ms stop interaction; stale/replayed network packets are rejected. A stationary hand or a head movement alone should not count as a stroke.

## Hardware gate

**Camera-only DAT + a foreground Display Web App is still `NEEDS_DEVICE_TEST`.** No native display capability is attached, but Meta's docs do not establish that this combination is supported on every firmware. Test both camera-first and Web-App-first. Record frame arrival, display visibility, interruptions, and recovery. If opening one stops the other, this web/native split cannot be claimed to work on that firmware; a supported unified native-display route would be needed.

## Team integration / tests

- `shared/hand-protocol.mjs` and `.d.mts`: versioned wire shape. Top-left unmirrored normalized points in the standard MediaPipe 21-joint order; Vision supplies `z=0`, which is not depth.
- `bridge/relay.mjs`: authenticated publisher/viewer roles, bounded payloads, no replay/storage, backpressure drops, preview subscription isolation, heartbeat cleanup.
- `glasses-web/src/hand/`: frame freshness, three-point mapping, gesture gating, optional desktop preview.
- `glasses-ios/BondimalsCamera/`: DAT lifecycle, Vision processing, optional preview encoding, and one-in-flight socket transport.

Run `npm test`, `npm run typecheck`, and `npm run build`. Relay integration tests bind a loopback port. Browser QA can use an explicitly labeled synthetic producer; those results validate transport/calibration/reactions, never physical camera provenance or optics. The `source` field is a protocol invariant, not cryptographic device attestation.

Local validation on 2026-09-19: 95 web tests and six real-WebSocket relay tests passed; TypeScript and the web production build passed; the unsigned iPhone build passed. A browser test completed all three hand-calibration points, displayed a labeled synthetic JPEG beside the GLB, triggered pet reactions with a streamed stroke, retained the `0°` / `300,300` anchor, and cleared the preview/stopped interaction after frames were paused. No real glasses camera was used in that browser test. The detected iPhone was unavailable to Xcode, and the approved Cloudflare tunnel could not connect from the current network: its TCP/UDP port 7844 checks failed. The local relay passed its health check. The tunnel was subsequently stopped at the user’s request to remain on the current network. Old tunnel links are inactive. Local phone preview replaces the need to transmit images; optional web petting still requires a reachable hand-point relay.

Phone-preview update: the signed iOS build passed. The camera starts independently of relay pairing, processes/draws image and landmarks in the same orientation, and hides stale frames. Physical streaming and overlay alignment remain unverified until the iPhone/glasses test.

## One-tap quest camera setup on iPhone

Kith Camera accepts `bondimals://quest-camera?server=ENCODED_HTTPS_ORIGIN&code=ONE_USE_CODE` on the paired **iPhone**. The code comes from the authenticated game's `/glasses/pair` endpoint and expires after five minutes. This link contains no player token or model API key. The server must match the HTTPS game server already selected in Kith Camera; credentials, extra paths, fragments, duplicate fields, unknown fields, and malformed codes are rejected before changing the current camera pairing.

Opening a valid link enables quest controls and claims that one-use code. Pairing leaves the glasses camera closed. If registration is needed, Kith opens the usual Meta flow. A later explicit photo or clip command starts the real glasses camera, including any required camera permission prompt, and waits up to twenty seconds for fresh frames. Reopening the same link while its claim is in flight does not issue a second claim, and an already-running camera is reused. Unpairing or turning off quest controls cancels any pending automatic start. Manual server/code entry remains available for recovery.

This is an iPhone setup link, not a claim that selecting a custom URL inside the glasses browser remotely launches an iPhone app. A connected-phone development install can open the link with `devicectl`; otherwise open it on the paired phone. Keep Kith Camera foregrounded while the glasses game runs. Camera/display concurrency still needs the hardware test described above.

From the glasses, an explicit photo or clip action captures glasses-camera evidence. After the camera closes, reopen Kith on the glasses to review the evidence and choose **Submit to Muse**; that action submits through `/verify` to Muse Spark. No phone camera or clip audio is substituted. The native bridge only captures and uploads evidence; the server still verifies current game membership and applies quest rewards after grading.

Parser regression check:

```sh
xcrun swiftc glasses-ios/BondimalsCamera/QuestCameraSetupLink.swift scripts/glasses-camera-setup-tests.swift -o /tmp/kith-camera-setup-tests
/tmp/kith-camera-setup-tests
```

Camera 6 shows its build number and actual camera readiness at the top of the phone screen. Manual pairing and setup links arm quest controls without holding the camera open. The camera bearer and matching server origin are saved in this phone's non-synchronizing, unlocked-only Keychain; opening the app checks that saved authorization with the server before resuming command polling; it does not start the camera. Unpairing, changing servers, or a server 401 clears it. Pairing codes, game-player tokens, and media are not persisted. A server restart or expired game membership still requires a new code.

The bridge sends `/glasses/heartbeat` about once per second with `onDemandCapture: true`, so the server can accept an explicit capture while this connected camera is idle. Ready requires an active phone app, a streaming DAT camera and an image younger than two seconds. During an explicitly requested clip only, `/glasses/progress` sends at most two 320px previews per second, each below 100 KiB; at most one upload is in flight and slow networks drop previews without blocking evidence collection. Canceling, backgrounding, stopping the camera, or finishing the clip stops preview uploads. After a photo or twelve-frame clip is captured, the bridge stops both the camera and parent DAT session, waits up to four seconds for the session to report stopped, then uploads the retained evidence. Cancellation and errors also release the session. A release timeout is reported as unconfirmed, not idle; another capture is blocked until that session actually stops. Pairing and the result upload survive this cleanup. The phone retains a thumbnail and directs the user back to glasses review and submission. These previews are separate from optional desktop hand-tracking preview.

For device troubleshooting the app also writes `Library/Caches/kith-camera-status.json` inside its private container. This records setup stages, server origin, registration state, pairing/running/readiness flags, camera status and last-frame time; it excludes camera images, pairing codes, tokens and device identifiers. Read it with `xcrun devicectl device copy from --device DEVICE_ID --domain-type appDataContainer --domain-identifier com.bondimals.camera --source Library/Caches/kith-camera-status.json --destination /tmp/kith-camera-status.json`. Confirm the build and server plus fresh camera frames; a successful process launch does not prove camera setup succeeded.

Camera 5 automatically starts the glasses camera after manual pairing as well as a setup link. It reports fresh-frame readiness to the game and sends bounded previews only while an explicit clip command is active. Its camera bearer and origin are stored in this-device-only, when-unlocked Keychain storage; a restored binding must be accepted by the server before it can start the camera, and Unpair, an expired binding or changing server clears it. The visible camera app stays awake through setup and recording; backgrounding still pauses capture.

Camera 6 responds to observed hardware behavior where camera mode hides the glasses Web App. No automatic Web App resume API is used or promised. Manual continuous preview is separately labeled because it keeps camera mode open; a subsequent quest capture closes that preview too. Physical capture, LED shutoff, manual game return, retained review, and Muse submission must be checked on the connected glasses.

Session-release regression check:

```sh
xcrun swiftc glasses-ios/BondimalsCamera/CameraSessionRelease.swift scripts/glasses-camera-release-tests.swift -o /tmp/kith-camera-release-tests
/tmp/kith-camera-release-tests
```

Camera 7 retains completed photo/clip evidence in memory while retrying a transient result-upload failure for at most twenty seconds. Every attempt has a hard timeout of at most six seconds; retries back off by 0.5, 1, then 2 seconds. They reuse the same request and evidence without reopening the camera or calling Muse. Cancellation, replacement, revocation and terminal HTTP errors stop retries. The server acknowledges an identical already-saved result without replacing it or extending its expiry, which covers a lost upload acknowledgment.

The phone and private diagnostics now expose `lastCaptureStage`, `lastCaptureOutcome` and `lastCaptureAt` separately from connection-poll status. `uploaded` means the game server acknowledged the result; an exhausted upload reports that receipt could not be confirmed. These fields contain no media, tokens, pairing codes or device identifiers.

Upload regression check:

```sh
xcrun swiftc glasses-ios/BondimalsCamera/CameraResultUpload.swift scripts/glasses-camera-upload-tests.swift -o /tmp/kith-camera-upload-tests
/tmp/kith-camera-upload-tests
```
