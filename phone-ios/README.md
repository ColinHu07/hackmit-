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

After installation, look for **Bondimals** with the green paw icon on your Home Screen. Allow location on first launch for automatic nearby discovery and walking, and camera/microphone when recording.

The build script produces the web bundle, copies it to the ignored `Web/` directory, and builds the native app. Generated assets and signing products are not committed. Find your team ID in Xcode → Settings → Accounts, and the device ID with `xcrun devicectl list devices`. This is a development installation, with provisioning lifetime determined by your Apple account, not an App Store release.

Start `HOST=0.0.0.0 npm run play:server` on the Mac. Both devices must be able to reach that address. A hosted server can instead use `wss://YOUR_HOST/play`. Set the server through the app's upper-right settings button if its address changes. `/play` and `/nearby` are both required. For an origin-restricted backend, the bundled page's origin is `bondimals://app`; verify the actual Origin header for your OS version. Local-network permission is needed for a LAN server.

An unsigned simulator build is available with `BONDIMALS_SERVER_URL=ws://127.0.0.1:8788/play ./scripts/build-phone-ios.sh --simulator`. Camera and compass validation require a physical device.

## Native controls

### Automatic multiplayer

Set the same URL in **Server settings** on both phones. The app automatically joins that server's shared playground with a separate pet for each device, up to four players. Room codes and squad quests are not required. **The host must run the updated server supporting automatic joining**, and both phones need the updated app bundle. An older host produces an explicit update-required message. See [server deployment instructions](../docs/phone-server.md#automatic-shared-playground).

### Play with a friend on a laptop

Use `ws://10.189.108.228:8788/play` in the native app's **Server settings** while on
the team's Wi-Fi. The browser-sharing command must use the same upstream:
`npm run web:share -- --provider serveo --server ws://10.189.108.228:8788/play`.
Give the printed HTTPS link to your laptop friend. With the updated server and
clients, both join its shared playground automatically. Location is not required.
Private rooms remain available through **Private room options**.

For a preconfigured build, set `BONDIMALS_SERVER_URL` to the LAN address and
`BONDIMALS_WEB_URL` to the printed HTTPS link when running the build script. The
phone's **Invite friends** button then opens the hosted browser app in the same
room. A new bundled server address replaces the old saved address once, clears
the old room session, and respects later manual changes in Server settings.
The server computer and web-sharing Mac must stay awake and reachable.

- **Nearby discovery starts automatically** on launch and foreground return after native While Using the App location permission. Enable **Precise Location**. It uses the approximate 10-meter discovery protocol. **Stop nearby discovery** persists your choice; use **Find nearby pets** to turn it back on. New players start as Explorer and can edit their name after stopping discovery.
- **Walking starts automatically** once the pet loads and location access is allowed. The closer camera stays centered behind the pet’s rendered heading; textured grass and fading pawprints make movement visible: the pet faces screen-top on entry and as you turn, while the meadow rotates around it. World coordinates still use geographic north as negative Z and east as positive X. Foreground Core Motion detects rhythmic footfalls: two footfalls confirm a new walk, then each detected step advances the pet. Each step uses an approximate 0.7-meter stride amplified 2.5× for gameplay (0.35 world units); hold the phone facing your walking direction. This is gameplay motion estimation, not a fitness counter. The phone’s heading changes the pet’s facing. Turning in place does not move the pet. True north is preferred; magnetic fallback is labeled. Heading updates with more than 25° reported error are ignored.
- **GPS is a fallback only** when motion data is unavailable; it never adds duplicate movement while step tracking is active. GPS movement requires accuracy of 10 meters or better and displacement greater than the larger of 2 meters or the reported accuracy of either fix. Samples older than 20 seconds, out-of-order samples, and movement above 4 m/s are rejected. Poor signals and long gaps reanchor without teleporting. This reduces jitter but cannot guarantee that GPS drift is eliminated. Indoors, small steps may not be resolved.
- Movement is scaled: 1 estimated meter equals 0.2 world units. The existing board spans -3 to +3 in X/Z. The view automatically rebases the pet to the center at its edge, preserving heading and the latest GPS anchor so subsequent steps keep working. This is a miniature world aligned to your starting direction, not AR world anchoring or measured placement of other pets. Nearby visitors still use the explicitly illustrative arrangement.
- Native walking also works with the preview pet before joining a room. In a shared room, walking destinations and stationary compass facing are synchronized through the game server. Entering or leaving a room automatically resets the GPS baseline and continues walking. Manual movement is disabled while walking.
- **Record quest clip** asks for camera and microphone access and opens the iPhone camera recorder, capped at 10 seconds. The separate **Quest clips** section contains recording, review, and deletion. Recording pauses walking/discovery; dismissing the recorder resumes walking and any enabled discovery. **Review clip** opens the native video player; **Delete clip** removes it. Only the latest accepted clip is retained, locally under `Documents/QuestClips`. Nothing is uploaded automatically. Select a quest, review the clip, check participant consent, and tap **Submit clip to Meta**. The app sends 12 sampled frames to the game server for Muse Spark verification; audio stays local.
- **Quest board:** each player has their own progress: walk one world-unit for the solo **Touch grass** quest, meet a nearby pet for the duo quest, and complete **Circle up** only when three or more connected pets are close together in the pen. A completed three- or four-pet squad can jointly ready and calm **Mossback, Keeper of the Pen**. The server owns quest gates, raid state, rewards, and reconnect-safe progress for the life of that room.

Location sensors stop when all interested features stop, and both discovery and walking stop in the background. Discovery resumes on foreground return unless explicitly stopped; walking resumes automatically. No location history is written to disk. Native privileges are exposed only to the app's bundled main frame; navigation to external pages is blocked.

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

### Local weather and happiness

The world uses rounded location coordinates (two decimal places) with [Open-Meteo](https://open-meteo.com/en/docs), refreshed from fresh location fixes at most every 10 minutes. Sunshine shows flowers; rain and snow show particles; cloudy and nighttime conditions change the gradient and lighting. Offline or denied location uses a labeled default. Weather is an area estimate, not a street map or AR reconstruction. Coordinates and weather are not persisted.

Happiness is saved on this device, starts at 70%, and decreases 2 points per hour down to a gentle floor of 20%. Each camera-approved real-world quest and completed in-game raid adds 12 points (maximum 100%). Completion IDs are retained so reconnecting/reloading cannot reward the same quest again. These use the existing server quest events; camera evidence is submitted explicitly to the server for Muse Spark verification. Happiness is a local prototype statistic, not an account-synced or tamper-proof reward system.

### Quest integration

Anant’s per-player quests, cooperative dap, and three/four-player Mossback raid are integrated. From nearby discovery, **Start a squad quest room** opens a room whose code can be shared with up to three friends. Nearby one-to-one invitations remain private two-person encounters. **Meet in the middle** works while automatic walking is enabled, so gathering for a quest does not require precise indoor GPS.

Set the Meta key on the server using [the server setup guide](../docs/phone-server.md#meta-quest-verification), then run `npm run check:meta`. The key never belongs in this iPhone app. The native build and mocked provider tests can pass without a key; live model accuracy still requires recording and submitting real examples.
