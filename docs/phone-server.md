# Phone playground server

## Automatic shared playground

The default app flow joins one shared playground automatically. Set the same server URL on both phones and open the app: each device gets its own player ID and pet, and connected pets appear on both screens. No room code, squad quest, location permission, or nearby invitation is required to join. The existing four-player limit applies; a fifth player sees a full-playground message rather than silently entering a different room. Private room links and opt-in nearby discovery remain available.

**Both the client and the host's Node server must be updated.** Older servers reject the new `lobby` message; the app explains that the host needs to update and restart. For the team server at `ws://10.189.108.228:8788/play`, the host must deploy this version and restart their existing process. For a backend-only host, run `npm ci` and `HOST=0.0.0.0 PORT=8788 npm run play:server` after updating the source. For a host serving the website too, run `npm ci && npm run build:phone`, then restart with `HOST=0.0.0.0 PORT=8788 npm run web:start`. Restarting loses existing in-memory rooms.

Native apps need a rebuilt/reinstalled bundle; browsers need the updated website. Opening Server settings and saving an address leaves the previous playground and joins the new server automatically. Leave playground pauses joining until Connect is tapped or the app is opened again. Lobby reconnect tokens are saved privately on the device per server URL; expired tokens are replaced automatically after the server's reconnect grace period or a restart. These are temporary session identities, not permanent accounts or saved avatars.

Wire protocol: send `{ "type": "lobby", "name": "Alex" }` with an optional private `playerToken` to resume. A regular `welcome` is returned, and shared-playground snapshots carry `publicLobby: true`. The server chooses the room internally; users do not select or exchange its code.

The phone playground uses a separate Node WebSocket service from the glasses landmark relay. It supports up to four real players per room, many rooms at once, and two-player nearby discovery encounters; there is no simulated second player. Room and presence state live in memory and disappear on restart. The current playground shares a virtual space, not physical AR anchors.

## Share a phone-browser link

To connect everyone to an **existing team server**, run:

```sh
npm run web:share -- --provider serveo --server ws://10.189.108.228:8788/play
```

This serves the built web app and proxies `/play`, `/nearby`, `/verify`, and `/health` to that exact server through the HTTPS link. It starts no local game server and never falls back to one. The host Mac must remain able to reach the team server. The upstream server's origin rules still apply; allow the printed public origin there if restricted. `/health` reports the upstream server's own fields, which may omit player counts on older versions. Native clients on the same network can connect directly to the original address and join the same room codes.

### Start a separate test server

From the repository root, install dependencies with `npm ci`. With `cloudflared` installed (`brew install cloudflared` on macOS), run:

```sh
npm run web:share
```

If event Wi-Fi blocks Cloudflare, run `npm run web:share -- --provider serveo`. This uses SSH on port 443 with a pinned, verified Serveo host key and no personal SSH identities. Friends may need to continue through [Serveo’s browser warning](https://serveo.net/docs/#browser-warning).

This builds the phone app, runs one server for both the website and multiplayer endpoints, and prints a temporary public HTTPS URL after verifying `/health` responds. Friends can open it in Safari or Chrome from any network. One friend creates a playground and shares the room invite link or code; up to four players can join that room. Additional groups create their own rooms on the same server.

The Mac must stay awake and online, and the launcher must stay running. Press **Ctrl+C** to stop its server and tunnel. Each run starts fresh in-memory rooms; share the link printed by the new run. This is a temporary testing setup; use persistent hosting for a lasting address.

The launcher binds its game server to `127.0.0.1`, chooses the first free port starting at 8790, and leaves existing servers alone. Override the starting port with `npm run web:share -- --port 8890` or `WEB_PORT=8890 npm run web:share`. It builds with same-origin multiplayer configuration and allows all request origins only for its own temporary server, because the tunnel hostname changes every run. It does not modify `.env` or the normal server's origin policy.

The public `/health` endpoint reports aggregate `rooms`, `activeRooms`, `players`, and `connections`, plus `maxPlayersPerRoom`, `maxRooms`, and `maxConnections`. It does not include player identities or private room tokens. Refresh it while friends join to check that they are reaching the same server. `players` counts currently connected players; disconnected players can still reserve a room slot during the reconnect grace period.

For an automated concurrent-player check:

```sh
npm run test:multiplayer
# Run against an already-running shared or hosted server instead:
npm run test:multiplayer -- --url https://YOUR-LINK.trycloudflare.com
```

The test creates separate rooms and verifies live multiplayer behavior. Its results are a functional concurrency check, not a production capacity guarantee.

## Run locally

To serve the website and game from one process:

```sh
npm run build:phone
npm run web:start
```

`web:start` serves `companion-web/dist`, defaults to `HOST=0.0.0.0` and `PORT=8788`, and can accept phones on the same Wi-Fi at `http://YOUR_MAC_LAN_IP:8788`. `HOST`, `PORT`, and optional `WEB_ROOT` override these values. Build again and restart after updating the phone client. Browser location and camera access on physical phones need HTTPS; room-code multiplayer works over local HTTP.

For a backend-only process (for the native app or a separately hosted web client):

```sh
npm run play:server
```

Backend-only defaults are `HOST=127.0.0.1`, `PORT=8788`. To allow LAN clients:

```sh
HOST=0.0.0.0 PORT=8788 npm run play:server
```

WebSocket endpoints `/`, `/play`, and `/ws` are equivalent. The same server also handles `/nearby` and `/verify`. `GET /health` returns JSON with `ok`, `service`, and the activity counters above. A local HTTP client can use `ws://YOUR_LAN_IP:8788`; a client served over HTTPS must use `wss://`.

## Meta quest verification

Create a key in the [Meta Model API dashboard](https://dev.meta.ai/) under **API keys → Create API key**. Copy `.env.example` to `.env` (if you do not already have one) and set `MODEL_API_KEY` there. The gitignored file is loaded automatically by `npm run play:server`. Never put this key in a `VITE_*` variable, phone build, screenshot, or commit.

The documented defaults are `META_MODEL_API_BASE_URL=https://api.meta.ai/v1` and `META_MODEL_ID=muse-spark-1.3`. The adapter calls `/chat/completions` under that versioned base URL. See Meta's [image inputs](https://dev.meta.ai/docs/image-understanding), [structured output](https://dev.meta.ai/docs/structured-output), and [authentication](https://dev.meta.ai/docs/authentication) documentation.

Run `npm run check:meta` after setting the key. It creates two synthetic players in an isolated pen and submits three blank frames through the phone’s `/verify` route without movement or a dap action. It makes one live Meta vision request, expects a rejection with a reason, and prints no credentials. This is a connection/sanity check, not an accuracy evaluation of gestures. Restart the server after changing `.env`.

In **Quest clips**, select the quest, record 1–10 seconds with the native camera, review the clip, and explicitly submit after everyone shown agrees. iOS extracts 12 chronological JPEG frames at up to 720 pixels; only these frames are sent, not the clip audio. A selected photo is also supported for grass, a duo hello, and a squad circle. A handshake requires a clip because a still image cannot establish motion.

`POST /verify` authenticates the server-issued room token and requires only connected players in the same pen (one for solo, two for duo, three or four for squad). Movement, proximity, dap offers, and ready-up steps are not required. It freezes the submission participants from server state, limits evidence to 4 MB combined, prevents concurrent/replayed approvals, and rate-limits attempts. The model receives a fixed quest-specific prompt and strict JSON schema. No key, provider failure, timeout, malformed output, or unclear evidence can award completion. Participants must stay connected through submission. An accepted group check updates the submission group; unrelated room members receive no reward. Each approved participant receives 12 happiness, 2 berries, and 10 points in one saved transaction. A 60-second demo cooldown (intended later duration: 24 hours) prevents repeating that quest until it expires; the countdown and rewards survive reconnects. The same quest can then be submitted again.

Solo touch-grass evidence must show a hand touching natural grass, not merely a photo of a lawn. Duo hello accepts one visible person waving or a shared high-five; two players must be connected, but the other person may be behind the camera; dap shows contact and release; squad circle shows the full group together with a shared cheer or hands in the center. The UI and happiness rewards wait for approval for these real-world quests. Mossback remains an in-game cooperative raid, unlocked by a completed squad-circle quest, and does not pretend video proves a virtual boss action. The older nearby **We said hello** control is labeled as self-reported confirmation and does not award camera-verified quest happiness.

The server holds uploaded evidence only while processing the request and does not save or log images; the provider processes the submitted media under its own terms. Results are visual support for an action, not identity, attendance, freshness, or fraud proof. Test real positive and negative gesture clips before presenting accuracy claims.

## Host it

Use a persistent Node 22+ process/container with WebSocket support. Static hosting alone cannot run this service. Set `HOST=0.0.0.0` where your hosting platform requires it, and let the platform supply `PORT`. Build with `npm ci && npm run build:phone`, then start from the repo root with `npm run web:start` to serve both the website and backend. Use `npm run play:server` only when serving the client separately.

Put HTTPS/WSS in front of the process for browser location and camera permissions. With `web:start`, forward the whole site to this one process, including WebSocket upgrades. The phone client's production default is the same site's `wss://YOUR_SITE/play`; proxy **both `/play` and `/nearby`** to the Node service, forwarding WebSocket upgrade headers. The client derives `/nearby` from the configured `/play` address. If the UI and backend use separate domains, configure the client's server URL to the backend's public WSS URL. Use at least a 60-second reverse proxy idle timeout; the backend sends a ping every 20 seconds. Set `ALLOWED_ORIGINS` to comma-separated exact browser origins:

```sh
ALLOWED_ORIGINS=https://your-site.example,https://preview.example HOST=0.0.0.0 PORT=8788 npm run play:server
```

When configured, absent and nonmatching `Origin` headers are rejected. When unset, any origin is allowed for local development. Origin checks supplement room tokens; they are not account authentication.

Example nginx location inside your HTTPS site configuration:

```nginx
location ~ ^/(play|nearby|verify)$ {
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 75s;
}
```

Run one server instance for this prototype. The current defaults permit 500 rooms and 1,200 simultaneous play connections; these are admission limits, not measured capacity. Multiple replicas need shared discovery/room state or compatible routing. A restart or deploy loses rooms; clients should start discovery or create a fresh room if the previous one no longer exists. No database, AI key, camera, microphone, or recording service is required for multiplayer.

## Nearby discovery and real-world quests

`/nearby` is a separate WebSocket endpoint on the same process, governed by `ALLOWED_ORIGINS`. Its typed protocol is in `shared/nearby-protocol.ts`.

- Register with `discover`, then send fresh `location` fixes only while explicitly opted in and foregrounded. Each fix includes latitude, longitude, reported accuracy, and its timestamp. `pause` immediately deletes presence and cancels pending invitations; a fresh `discover` registration is necessary before publishing again. The supplied client opens a new discovery connection on Resume.
- The server returns at most eight peers estimated within 10 meters, sorted by distance. It excludes fixes older than 20 seconds or less accurate than 25 meters. Public messages contain approximate distance rounded to 5 meters and an uncertainty flag, never coordinates or location history. This is an approximate discovery filter, not proof of physical proximity.
- `meet` requests a peer; `respond` accepts or declines. Invitations expire after 30 seconds and are canceled when either presence becomes unavailable. Acceptance rechecks both locations and reserves two private player tokens in an encounter room. Each participant receives only their own token. Both join `/play` using the matched token; code-only entry to these rooms is rejected.
- `confirm_dap` records the current participant's report of an in-person hello. Both players must be connected. Each player can confirm once; two confirmations award one shared bond, with completion exposed in optional `snapshot.encounter`. GPS does not verify a gesture. The standard pet-play quest remains separate.

Coordinates are held only in memory, discarded on pause, disconnect, match, or freshness expiry, and not logged. Client-supplied locations and confirmations are trust-based prototype inputs and are not anti-cheat or proof of attendance.

## Wire behavior

The TypeScript contract is in `shared/play-protocol.ts`; runtime input validation is in `shared/play-protocol.mjs`.

- Send `{ "type": "create", "name": "Alex" }`, or `{ "type": "join", "roomCode": "ABC234", "name": "Blair" }`. Names are limited to 24 Unicode characters. The `welcome` response includes room code, your player ID, your private rejoin token, and the current snapshot.
- Save the returned token privately per room/player. To reconnect within 30 seconds of disconnection, send `join` with the saved `playerToken`. The same player resumes; a still-open old connection is replaced. Tokens are never included in public snapshots. After grace expires, join without the expired token to take an available slot.
- Up to three additional players need the room code, not another player's token. Explicit `leave` immediately releases the slot and invalidates its token. A disconnected player reserves their place briefly; the snapshot marks `connected: false`.
- Send `{ "type": "move", "x": 1, "z": 0 }` for a destination in the shared ground plane. X/Z use continuous shared coordinates with a safety bound of ±10,000, advertised as `snapshot.worldLimit`. The server moves pets at 2 units/second and broadcasts authoritative snapshots at 20Hz. Throttle pointer movement to about 10 updates/second; do not send every render frame. Connected clients interpolate server positions for both their own pet and other players. Crossing the former ±3 meadow edge never resets a pet to the origin. Older servers without `worldLimit` retain their ±3 bounds; the updated phone stops at that edge and displays an update notice instead of showing unsynchronized local travel.
- Send `{ "type": "action", "action": "wave" }` for `wave`, `feed`, `jump`, or `play`. Action timing uses epoch milliseconds from the server. `play` requires another connected pet within 1.5 units, animates the nearby playmates, and awards one bond point with a five-second cooldown. Each snapshot includes individual quest progress: camera evidence for `touchGrass`, `meetFriend`, `dapHandshake`, and `squadCircle` is available based only on the connected player count. Legacy movement/dap/ready-up actions remain compatible, but are not submission prerequisites. Camera approval marks the submitted quest complete for its participants.
- A squad that has all completed `squadCircle` can send `ready_raid`. All connected squad members must ready while clustered to wake Mossback. During the 45-second raid, player actions calm its server-owned meter (Play together is worth two points). If a participant disconnects or time expires, the raid safely resets; victory awards each participant's `raidBoss` quest and five shared bond points.
- Errors include `room_not_found`, `room_full`, `invalid_token`, `not_joined`, `already_joined`, `friend_too_far`, `action_busy`, `play_cooldown`, `invalid_message`, `rate_limited`, and `server_full`. Display the message; never silently create a fake companion.

The service bounds rooms, connections, message size, send buffers, and per-connection mutation rates. It expires empty rooms after ten minutes and drops nonresponsive clients using heartbeat pings. Admission limits use the actual peer IP, ignoring untrusted forwarded headers; when many users share a reverse proxy or NAT, its burst capacity is shared. For a public launch, use edge rate limits and a deliberate trusted-proxy setup. Room codes are invitations, and possession of a rejoin token permits control of its pet. Do not put tokens in public invitation URLs or logs.

## Verify

```sh
node --test bridge/play-server.test.mjs bridge/nearby-discovery.test.mjs
```

Tests open real WebSocket clients to verify multiplayer motion, cooperative quests, room capacity, token isolation and reconnection, malformed inputs, message bounds, room expiry, and origin restrictions.

Native recordings are copied into `Documents/QuestClips` before old clips are cleaned up. Cleanup uses a list captured before copying, so `/var` versus `/private/var` URL aliases cannot delete the new clip. A failed or empty retake keeps the prior recording. Regression check: `xcrun swiftc phone-ios/BondimalsPhone/QuestClipStore.swift scripts/phone-quest-clip-tests.swift -o /tmp/kith-quest-clip-tests && /tmp/kith-quest-clip-tests`.

### Location movement and nearby play

Native phones and tablets, and touch browsers, use geolocation for movement. Scene taps no longer create destinations on mobile; desktop pointer/keyboard movement remains available. GPS anchors the shared world, and native step detection fills in short walks between location updates, including when indoor GPS is weak. Each detected step advances the server target by an estimated 0.7 real meters. GPS updates inside their uncertainty radius do not pull the pet back over those steps. Heading and tilt still control the view.

The `location` playground message uses a shared room origin and 0.2 world units per meter, so physically nearby devices are placed nearby. Raw coordinates remain in server memory and never enter snapshots or the pet database. Fixes older than 20 seconds, accuracy worse than 25 meters, and implausible walking jumps are ignored; a small dead zone reduces stationary jitter. Play together uses a shared 3-world-unit radius (approximately 15 real meters) in both the client and server, and one tap starts the dance for the nearby group. This proximity remains approximate because GPS accuracy varies.
