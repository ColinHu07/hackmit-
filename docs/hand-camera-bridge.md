# Glasses camera preview and optional web petting

The iPhone now shows the glasses camera and hand skeleton directly, with **web sharing off by default**. No relay, Cloudflare account, pairing URL, or network change is required for this visualization. Register with Meta AI and start the camera. Stale images disappear after 0.6 seconds; stopping or backgrounding clears the preview.

The character continues to run in the GitHub Pages web app. For optional web petting, the iPhone app can also act as a camera bridge: Meta DAT reads the **glasses** camera, Apple Vision detects hands, and a small WebSocket relay sends landmarks to Bondimals. If **Allow desktop camera preview** is enabled on the phone, the desktop simulator can optionally request a 320px, up-to-4-fps camera preview with matching hand points drawn over it. The glasses viewer never subscribes to images. Turning the preview off stops image encoding once the last desktop viewer unsubscribes.

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
