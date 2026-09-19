# Bondimals · Phone playground

Players discover nearby pets through opt-in foreground location sharing, agree to meet, and enter a shared virtual meadow automatically. Each controls a pet; movement, greetings, treats, jumps, cooperative play, and friendship progress are synchronized by a small Node server. The meadow is an illustrative 3D view, not camera AR or measured physical pet placement.

## Nearby discovery

1. Enter your name and tap **Find nearby pets**. The app requests browser location permission on iPhone or Android; there is no location request on page load.
2. Other opted-in players whose estimated locations are within 10 meters appear automatically. Pet cards show rounded distances and uncertainty. Tap a pet or its card to send a meet request.
3. When the other person accepts, both clients join a private encounter automatically. A room code is not needed.
4. Walk over, introduce yourselves, and share a dap, high-five, or wave. Each player taps **We said hello** afterward. Both confirmations award one shared moment. This is participant-reported completion, not automatic recognition of a physical gesture.

The browser needs **HTTPS on physical phones**, along with a secure WSS backend. Plain `http://YOUR_LAN_IP` can run the room-code playground but cannot request location. `localhost` is treated as a secure context for local development.

Location accuracy is not guaranteed to distinguish ten meters, especially indoors. The server filters by estimated center-to-center distance and requires each fix's reported accuracy to be 25 meters or better. A result is marked uncertain when the distance plus both reported error radii exceeds 10 meters. Accuracy worse than 25 meters hides nearby results with an explanation. This filter can miss truly nearby people when their fixes drift; it is not precision ranging.

Locations stay only in server memory and are never broadcast to peers. Peer responses contain names/pet IDs, approximate distances rounded to 5 meters, and uncertainty. Fixes expire after 20 seconds. Stop, disconnect, backgrounding, or accepting a match removes discovery presence; nearby mode requires an explicit resume after returning to the foreground. No location history is stored. Discovery is not automatically restored after refresh.

## Try it

From the repository root, install dependencies with `npm ci`. Start the server in one terminal:

```sh
HOST=0.0.0.0 npm run server
```

Start the phone app in another:

```sh
npm run dev:phone
```

Open the Vite **Network** URL (port 5217) on both phones on the same Wi-Fi. The development client automatically uses the page's hostname with port 8788 for the multiplayer server. If the Wi-Fi isolates devices, use a publicly hosted client and WSS server instead. Desktop testing also works in two independent tabs.

For the location-free fallback, select **Use a room code instead**:

1. Enter your name and **Start a playground**.
2. Share the six-character room code or invite link with your friend.
3. Your friend selects **Join a friend**, enters the code and their own name.
4. Tap the ground to move, or use **Meet in the middle** on both phones.
5. **Wave**, then **Play together** once your pets are close. Both screens show the same animation and shared quest completion. **Treat** and **Jump** are also synchronized. Each player's pet stats and rewards appear below the shared moments counter.

The canvas supports arrow keys when focused. Dragging the page does not send a move. Reduced-motion preferences suppress decorative movement. There is no AI service dependency in this multiplayer milestone; Muse quest interpretation can be added separately.

## Connect your hosted server

On the home screen, tap the sliders button in the upper-right corner and paste the server's public URL, for example `wss://your-server.example/play`. Both players must use the same server. Invite links include its address and room code, never a player's private rejoin token.

Alternatively, set `VITE_PLAY_SERVER_URL` before building. Copy `.env.example` to `.env.local` inside `companion-web` and replace the example address, then:

```sh
npm run build:phone
```

Upload **`companion-web/dist`** to your static host. To host under a subdirectory, pass the matching Vite base, for example `npm run build --workspace @bondimals/companion-web -- --base=/phone/`. The production fallback is a same-origin WSS endpoint at `/play`. The app supports runtime server configuration, so changing hosts does not require a rebuild.

See [server deployment](../docs/phone-server.md) for its start command, environment variables, health endpoint, proxy setup, and limits. The same server needs both `/play` and `/nearby` WebSocket routes forwarded.

## Reconnect and persistence

Brief connection loss retries with the same private player token. A place is reserved for 30 seconds. Refreshing the same tab restores the room from `sessionStorage`; **Leave playground** releases the slot immediately. Expired sessions require joining again. Live rooms disappear when the server restarts; guest accounts, pet stats, and social rewards persist in SQLite. Clearing browser local storage loses access to that guest account.

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
