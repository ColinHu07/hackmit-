# Bondimals — native iPhone app

A standalone iOS 17+ app named **Bondimals**, separate from the existing glasses camera app. Its Three.js pet interface is bundled into a WKWebView; Swift uses Core Location for native GPS/compass and UIKit's camera recorder for short quest videos. The installed app launches without a web host. Multiplayer still needs the Node server.

## Download and install

**This is the iPhone app to build and install. Distribution is currently an Xcode development build.** A source ZIP downloaded in Safari on an iPhone will not install the app. There is no public TestFlight/App Store release or generally installable IPA yet.

You need a **Mac with Xcode, Node.js 22+, an Apple development account configured in Xcode, and a paired/unlocked iPhone running iOS 17+ with Developer Mode enabled**. Sign the app with your own team for your device.

1. On your Mac, [download the repository ZIP](https://github.com/ColinHu07/hackmit-/archive/refs/heads/main.zip) and extract it, or clone the repository:

   ```sh
   git clone https://github.com/ColinHu07/hackmit-.git
   cd hackmit-
   npm ci
   ```

   If using the ZIP, open Terminal in the extracted repository and run `npm ci` there.

2. Connect and unlock your iPhone. Accept its Trust prompt if needed. Use `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl list devices` to find its device ID. Find your development team ID in Xcode → Settings → Accounts.
3. Start the multiplayer server using the instructions below, or get your team's hosted server URL. Build, install, and open the app using these commands from the repository root (replace all `YOUR_...` placeholders):

```sh
BONDIMALS_DEVELOPMENT_TEAM=YOUR_TEAM_ID \
BONDIMALS_SERVER_URL=ws://YOUR_MAC_LAN_IP:8788/play \
./scripts/build-phone-ios.sh

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device install app \
  --device YOUR_DEVICE_ID phone-ios/DerivedData/Build/Products/Debug-iphoneos/BondimalsPhone.app
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun devicectl device process launch \
  --device YOUR_DEVICE_ID com.bondimals.phone
```

After installation, look for **Bondimals** with the green paw icon on your Home Screen. Allow location when starting nearby discovery or walking, and camera/microphone when recording.

The build script produces the web bundle, copies it to the ignored `Web/` directory, and builds the native app. Generated assets and signing products are not committed. Find your team ID in Xcode → Settings → Accounts, and the device ID with `xcrun devicectl list devices`. This is a development installation, with provisioning lifetime determined by your Apple account, not an App Store release.

Start `HOST=0.0.0.0 npm run play:server` on the Mac. Both devices must be able to reach that address. A hosted server can instead use `wss://YOUR_HOST/play`. Set the server through the app's upper-right settings button if its address changes. `/play` and `/nearby` are both required. For an origin-restricted backend, the bundled page's origin is `bondimals://app`; verify the actual Origin header for your OS version. Local-network permission is needed for a LAN server.

An unsigned simulator build is available with `BONDIMALS_SERVER_URL=ws://127.0.0.1:8788/play ./scripts/build-phone-ios.sh --simulator`. Camera and compass validation require a physical device.

## Native controls

- **Find nearby pets** requests native While Using the App location permission. Enable **Precise Location**. It uses the existing approximate 10-meter discovery protocol.
- **Start walking** requests location and starts compass updates. The meadow switches to north-up: geographic north is negative Z; east is positive X. Translation uses changes in GPS, while the phone's heading changes the pet's facing. Turning in place does not move the pet. True north is preferred; magnetic fallback is labeled. Heading updates with more than 25° reported error are ignored.
- GPS movement requires accuracy of 10 meters or better and displacement greater than the larger of 2 meters or the reported accuracy of either fix. Samples older than 20 seconds, out-of-order samples, and movement above 4 m/s are rejected. Poor signals and long gaps reanchor without teleporting. This reduces jitter but cannot guarantee that GPS drift is eliminated. Indoors, small steps may not be resolved.
- Movement is scaled: 1 real meter equals 0.2 meadow units. The existing board spans -3 to +3 in X/Z. **Recenter** lets you continue at its edge. This is a north-aligned miniature meadow, not AR world anchoring or measured placement of other pets. Nearby visitors still use the explicitly illustrative arrangement.
- Native walking also works with the preview pet before joining a room. In a shared room, walking destinations and stationary compass facing are synchronized through the game server. Starting/entering/leaving a discovery or room flow resets walking; tap Start walking again when ready. Manual movement is disabled while walking.
- **Record quest clip** asks for camera and microphone access and opens the iPhone camera recorder, capped at 10 seconds. Recording pauses walking/discovery. **Review clip** opens the native video player; **Delete clip** removes it. Only the latest accepted clip is retained, locally under `Documents/QuestClips`. Nothing is uploaded or marked verified. Muse verification is a later integration.

Location sensors stop when all interested features stop, and both discovery and walking stop in the background. Foregrounding after a background transition requires an explicit restart. No location history is written to disk. Native privileges are exposed only to the app's bundled main frame; navigation to external pages is blocked.

## Verification

`npm run test:phone` includes four-direction movement, compass-only rotation, bad GPS, jumps, stale fixes, reanchoring, bounds, antimeridian handling, native bridge lifecycle, and real-WebSocket heading synchronization tests. `npm run typecheck:phone` validates the shared client. Xcode builds validate the Swift code, app resources, and signing.

The iOS 18 simulator smoke check exercised the bundled pet screen, native camera permission denial, native location permission, and northward and eastward movement from simulated Core Location walking routes. Fonts are bundled so startup does not wait for a font host.

A physical walk test is still necessary to judge GPS/compass accuracy at the event. AI gesture verification and precise shared AR alignment are not part of this version.

### Bundled-resource regression check (Mac)

The loader normalizes both the bundle directory and requested file before checking containment. This handles physical-iPhone `/private/var` → `/var` aliases while rejecting traversal and symlinks outside the bundle.

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun swiftc \
  phone-ios/BondimalsPhone/BundledResourcePath.swift scripts/phone-resource-path-tests.swift \
  -o /tmp/bondimals-resource-path-tests
/tmp/bondimals-resource-path-tests
```
