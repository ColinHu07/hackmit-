# Kith · Phone playground

Players discover nearby pets through opt-in foreground location sharing, agree to meet, and enter a shared virtual meadow automatically. Each controls a pet; movement, greetings, treats, jumps, cooperative play, and friendship progress are synchronized by a small Node server. The meadow is an illustrative 3D view, not camera AR or measured physical pet placement.

## Share with friends on their phones

### Use the team's existing server

If a teammate already runs the multiplayer server, pass its address so every
browser joins that server's rooms:

```sh
npm run web:share -- --provider serveo --server ws://10.189.108.228:8788/play
```

The Mac running this command must stay connected to a network that can reach the
team server. Friends use the printed HTTPS link. The Mac serves the web interface
and forwards gameplay to the supplied server; it does not create another game
server. Native apps on the same Wi-Fi can use the original `ws://` address in
Server settings, or use the printed HTTPS address. All players still need the
same room code for room play, or both use nearby discovery with a fresh location within about 10 meters. These are separate spaces. If the team server stops, the app disconnects instead of falling
back to a local server. Omit `--server` only when you want a separate test server.

Friends only need Safari or Chrome. They do not need Xcode or an installed app.

From the repository root, install dependencies once with `npm ci`. On the Mac hosting the game, install Cloudflare's tunnel tool if needed (`brew install cloudflared`), then run:

```sh
npm run web:share
```

If event Wi-Fi blocks Cloudflare, use `npm run web:share -- --provider serveo` instead. Serveo uses the Mac’s built-in SSH client on port 443; friends may need to tap through its browser warning.

The command builds the phone app, starts a separate game server, and prints a public **HTTPS link** after checking it works. Send that link to your friends. The app and multiplayer connection use the same address, so friends can connect from different Wi-Fi or mobile networks without configuring a server.

1. Both web and native open on **Nearby discovery**. In the browser, tap **Find nearby pets** and allow location to meet native players nearby. For a room that works without GPS, select **Use a room code instead**, then **Start a playground**, enter your name, and tap **Let’s play together**.
2. Share the room's invite link or six-character code. Everyone in a group must join the same room.
3. Friends open the invite, enter their names, and join. With just the site link, they can select **Join a friend** and enter the code.
4. Tap the ground to move, or use **Meet in the middle**. Try **Wave**, **Treat**, **Jump**, and **Play together** when pets are close.
5. Up to **4 players fit in one room**. More friends can create additional rooms on the same server. Three or four nearby pets can also complete the squad quest and raid together.

Keep the Mac awake, connected to the internet, and the terminal running. **Ctrl+C** stops the link and its server. After restarting, share the newly printed link with friends. Rooms and progress disappear when the server stops. The launcher starts at local port 8790 and skips occupied ports, so it can run alongside the native app's server on 8788. It uses an unrestricted-origin policy for this temporary test server; normal server configuration and `.env` files are unchanged.

Open the printed `/health` link to see active rooms, connected players, and connections. To exercise several rooms with automated players:

```sh
npm run test:multiplayer
# Optional: exercise the running server behind your shared link.
npm run test:multiplayer -- --url https://YOUR-LINK.trycloudflare.com
```

The automated test verifies concurrent multiplayer behavior; it does not establish production capacity. This is a temporary friend-testing link, not permanent hosting.

## Run locally or host the app

To build and serve the app and multiplayer backend in one process:

```sh
npm run build:phone
npm run web:start
```

Open `http://localhost:8788` on the Mac, or `http://YOUR_MAC_LAN_IP:8788` on phones on the same Wi-Fi. Room-code play works over local HTTP; phone location and camera permissions require HTTPS. `web:start` serves `companion-web/dist` and all game endpoints together. Use a persistent HTTPS host for a permanent link; see [server deployment](../docs/phone-server.md).

For frontend development, start `npm run play:server` in one terminal and `npm run dev:phone` in another. Open the Vite **Network** URL (port 5217). Vite forwards game requests to the local backend on port 8788. Desktop testing also works in separate tabs.

The camera stays behind your pet as it turns, centered on its position, with forward toward screen top. On a phone browser, tap **Enable walking** to use foreground motion sensors for estimated steps (two rhythmic footfalls to begin, then each step; no GPS distance threshold). Allow motion access when requested. Tap **Enable phone compass** and allow motion to turn with the device; laptops use tap/keyboard movement. **Use my local weather** also works in room mode and sends rounded coordinates only to Open-Meteo. The canvas supports screen-relative arrow keys when focused. Dragging the page does not send a move. Reduced-motion preferences suppress decorative movement. No AI service is required for multiplayer; optional camera quest checks need a server-side model key.

## Connect your hosted server

On the home screen, tap the sliders button in the upper-right corner and paste the server's public URL, for example `wss://your-server.example/play`. Both players must use the same server. Invite links include its address and room code, never a player's private rejoin token.

Alternatively, set `VITE_PLAY_SERVER_URL` before building. Copy `.env.example` to `.env.local` inside `companion-web` and replace the example address, then:

```sh
npm run build:phone
```

Upload **`companion-web/dist`** to your static host. To host under a subdirectory, pass the matching Vite base, for example `npm run build --workspace @bondimals/companion-web -- --base=/phone/`. The production fallback is a same-origin WSS endpoint at `/play`. The app supports runtime server configuration, so changing hosts does not require a rebuild.

See [server deployment](../docs/phone-server.md) for its start command, environment variables, health endpoint, proxy setup, and limits. The same server needs both `/play` and `/nearby` WebSocket routes forwarded.

## Nearby discovery

1. Enter your name and tap **Find nearby pets**. The app requests browser location permission on iPhone or Android; there is no location request on page load.
2. Other opted-in players whose estimated locations are within 10 meters appear automatically. Pet cards show rounded distances and uncertainty. Tap a pet or its card to send a meet request.
3. When the other person accepts, both clients join a private encounter automatically. A room code is not needed.
4. Walk over, introduce yourselves, and share a dap, high-five, or wave. Each player taps **We said hello** afterward. Both confirmations award one shared moment. This is participant-reported completion, not automatic recognition of a physical gesture.

The browser needs **HTTPS on physical phones**, along with a secure WSS backend. Plain `http://YOUR_LAN_IP` can run the room-code playground but cannot request location. `localhost` is treated as a secure context for local development.

Location accuracy is not guaranteed to distinguish ten meters, especially indoors. The server filters by estimated center-to-center distance and requires each fix's reported accuracy to be 25 meters or better. A result is marked uncertain when the distance plus both reported error radii exceeds 10 meters. Accuracy worse than 25 meters hides nearby results with an explanation. This filter can miss truly nearby people when their fixes drift; it is not precision ranging.

Locations stay only in server memory and are never broadcast to peers. Peer responses contain names/pet IDs, approximate distances rounded to 5 meters, and uncertainty. Fixes expire after 20 seconds. Stop, disconnect, backgrounding, or accepting a match removes discovery presence; nearby mode requires an explicit resume after returning to the foreground. No location history is stored. Discovery is not automatically restored after refresh.

## Reconnect and persistence

Brief connection loss retries with the same private player token. A place is reserved for 30 seconds. Refreshing the same tab restores the room from `sessionStorage`; **Leave playground** releases the slot immediately. Expired sessions require joining again. Rooms and progress live in server memory and disappear when the server restarts. This prototype has no accounts or permanent pet inventory.

## Verify

```sh
npm run typecheck:phone
npm run test:phone
npm run build:phone
```

The tests cover actual WebSocket room creation/joining, authoritative movement, cooperative rewards, malformed inputs, origin restrictions, reconnect tokens, terminal connection replacement, and disconnected controls. Nearby tests use fictional coordinates and mocked geolocation for range/accuracy/freshness filtering, permissions, background pause, stale callbacks, mutual invitations, private token handoff, and one-time dual-confirmation rewards. Browser verification also exercises two clients, shared quest completion, refresh recovery, mobile layout, and visible 3D rendering. Actual iPhone/Android location accuracy and off-network hosting still need a physical device check.

For a repeatable local browser demo, open `http://localhost:5217/?demo=nearby&player=1` and `http://localhost:5217/?demo=nearby&player=2` in separate tabs. Each must enter a name and start nearby mode. A prominent **SIMULATED LOCATION** label identifies the fictional sensor data; the button simulates walking out of range and returning. These are real separate multiplayer clients, with no fabricated second player and no device-location request. This fixture is enabled only in Vite development and is eliminated from the production build.

## Glasses integration later

`shared/play-protocol.ts` defines destinations, actions, and snapshots independently of the renderer. A glasses client can join the same room and render those snapshots when its input/display path is ready. Correct placement against real-world surfaces while walking additionally requires verified spatial tracking; the shared protocol alone does not provide it.

## Native iPhone app

The same interface is now bundled in an installable iPhone app with native GPS, compass, walking controls, and camera recording. See [native iPhone setup](../phone-ios/README.md). Browser location and room-code play remain available.
