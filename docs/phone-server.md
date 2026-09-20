# Phone playground server

The phone playground uses a separate Node WebSocket service from the glasses landmark relay. It supports nearby pet discovery and two real players per encounter; there is no simulated second player. Room and presence state live in memory and disappear on restart. The current playground shares a virtual space, not physical AR anchors.

## Run locally

From the repository root, install dependencies with `npm install`, then run:

```sh
npm run play:server
```

Defaults: `HOST=127.0.0.1`, `PORT=8788`. For phones on the same Wi-Fi, bind to the LAN and use your computer's LAN address in the client:

```sh
HOST=0.0.0.0 PORT=8788 npm run play:server
```

WebSocket endpoints `/`, `/play`, and `/ws` are equivalent. `GET /health` returns JSON with `ok`, `service`, and the number of rooms. A local HTTP client can use `ws://YOUR_LAN_IP:8788`; a client served over HTTPS must use `wss://`.

## Meta quest verification

Create a key in the [Meta Model API dashboard](https://dev.meta.ai/) under **API keys → Create API key**. Copy `.env.example` to `.env` (if you do not already have one) and set `MODEL_API_KEY` there. The gitignored file is loaded automatically by `npm run play:server`. Never put this key in a `VITE_*` variable, phone build, screenshot, or commit.

The documented defaults are `META_MODEL_API_BASE_URL=https://api.meta.ai/v1` and `META_MODEL_ID=muse-spark-1.3`. The adapter calls `/chat/completions` under that versioned base URL. See Meta's [image inputs](https://dev.meta.ai/docs/image-understanding), [structured output](https://dev.meta.ai/docs/structured-output), and [authentication](https://dev.meta.ai/docs/authentication) documentation.

Run `npm run check:meta` after setting the key. It makes one live vision request using a generated blank pixel, expects rejection, and prints no credentials. This is a connection/sanity check, not an accuracy evaluation of gestures. Restart the server after changing `.env`.

In **Quest clips**, select the quest, record 1–10 seconds with the native camera, review the clip, and explicitly submit after everyone shown agrees. iOS extracts 12 chronological JPEG frames at up to 720 pixels; only these frames are sent, not the clip audio. A selected photo is also supported for grass, a duo hello, and a squad circle. A handshake requires a clip because a still image cannot establish motion.

`POST /verify` authenticates the server-issued room token and requires the in-game preparation step. It derives the original participants from server state, limits evidence to 4 MB combined, prevents concurrent/replayed approvals, and rate-limits attempts. The model receives a fixed quest-specific prompt and strict JSON schema. No key, provider failure, timeout, malformed output, or unclear evidence can award completion. Participants must stay connected through submission. An accepted group check updates the original group; unrelated room members receive no reward. Already approved progress is preserved.

Solo touch-grass evidence must show a hand touching natural grass, not merely a photo of a lawn. Duo hello shows two people greeting; dap shows contact and release; squad circle shows the full group together with a shared cheer or hands in the center. The UI and happiness rewards wait for approval for these real-world quests. Mossback remains an in-game cooperative raid, unlocked by the squad's in-game gathering step, and does not pretend video proves a virtual boss action. The older nearby **We said hello** control is labeled as self-reported confirmation and does not award camera-verified quest happiness.

The server holds uploaded evidence only while processing the request and does not save or log images; the provider processes the submitted media under its own terms. Results are visual support for an action, not identity, attendance, freshness, or fraud proof. Test real positive and negative gesture clips before presenting accuracy claims.

## Host it

Use a persistent Node 22+ process/container with WebSocket support. Static hosting alone cannot run this service. Set `HOST=0.0.0.0` where your hosting platform requires it, and let the platform supply `PORT`. Start command from the repo root: `npm run play:server`.

Put HTTPS/WSS in front of the process and serve the phone app itself over HTTPS for browser location permission. The phone client's production default is the same site's `wss://YOUR_SITE/play`; proxy **both `/play` and `/nearby`** to the Node service, forwarding WebSocket upgrade headers. The client derives `/nearby` from the configured `/play` address. If the UI and backend use separate domains, configure the client's server URL to the backend's public WSS URL. Use at least a 60-second reverse proxy idle timeout; the backend sends a ping every 20 seconds. Set `ALLOWED_ORIGINS` to comma-separated exact browser origins:

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

Run one server instance for this prototype. Multiple replicas need shared discovery/room state or compatible routing. A restart or deploy loses rooms; clients should start discovery or create a fresh room if the previous one no longer exists. No database, AI key, camera, microphone, or recording service is required for multiplayer.

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
- Send `{ "type": "move", "x": 1, "z": 0 }` for a destination in the shared ground plane. X/Z are clamped to ±3. The server moves pets at 2 units/second and broadcasts authoritative snapshots at 20Hz. Throttle pointer movement to about 10 updates/second; do not send every render frame. Client rendering can interpolate positions between snapshots.
- Send `{ "type": "action", "action": "wave" }` for `wave`, `feed`, `jump`, or `play`. Action timing uses epoch milliseconds from the server. `play` requires another connected pet within 1.5 units, animates the nearby playmates, and awards one bond point with a five-second cooldown. Each snapshot includes individual quest progress: walking one world-unit unlocks camera evidence for solo `touchGrass`; meeting another nearby pet unlocks evidence for `meetFriend`; `ready_squad_quest` only completes `squadCircle` when every connected member of a three-or-four-pet clustered squad confirms.
- A squad that has all completed the in-game `squadCircle` gathering step can send `ready_raid`. All connected squad members must ready while clustered to wake Mossback. During the 45-second raid, player actions calm its server-owned meter (Play together is worth two points). If a participant disconnects or time expires, the raid safely resets; victory awards each participant's `raidBoss` quest and five shared bond points.
- Errors include `room_not_found`, `room_full`, `invalid_token`, `not_joined`, `already_joined`, `friend_too_far`, `action_busy`, `play_cooldown`, `invalid_message`, `rate_limited`, and `server_full`. Display the message; never silently create a fake companion.

The service bounds rooms, connections, message size, send buffers, and per-connection mutation rates. It expires empty rooms after ten minutes and drops nonresponsive clients using heartbeat pings. Admission limits use the actual peer IP, ignoring untrusted forwarded headers; when many users share a reverse proxy or NAT, its burst capacity is shared. For a public launch, use edge rate limits and a deliberate trusted-proxy setup. Room codes are invitations, and possession of a rejoin token permits control of its pet. Do not put tokens in public invitation URLs or logs.

## Verify

```sh
node --test bridge/play-server.test.mjs bridge/nearby-discovery.test.mjs
```

Tests open real WebSocket clients to verify multiplayer motion, cooperative quests, room capacity, token isolation and reconnection, malformed inputs, message bounds, room expiry, and origin restrictions.
