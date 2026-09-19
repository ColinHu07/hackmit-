# Phone playground server

The phone playground uses a separate Node WebSocket service from the glasses landmark relay. It supports nearby pet discovery and two real players per encounter; there is no simulated second player. `/play`, `/nearby`, and `/api/v1/*` run on one process and share player identity. Room positions and nearby presence disappear on restart; pet stats and rewards persist in SQLite. The playground shares a virtual space, not physical AR anchors.

## Run locally

From the repository root, install dependencies with `npm install`, then run:

```sh
npm run server
```

Defaults: `HOST=127.0.0.1`, `PORT=8788`. For phones on the same Wi-Fi, bind to the LAN and use your computer's LAN address in the client:

```sh
HOST=0.0.0.0 PORT=8788 npm run server
```

WebSocket endpoints `/`, `/play`, and `/ws` are equivalent. `GET /health` returns JSON with `ok`, `service`, and the number of rooms. A local HTTP client can use `ws://YOUR_LAN_IP:8788`; a client served over HTTPS must use `wss://`.

## Host it

Use a persistent Node 22+ process/container with WebSocket support and a writable directory for `BONDIMALS_DB_PATH` (default `.bondimals-data/game.sqlite`). Static hosting alone cannot run this service. Set `HOST=0.0.0.0` where your hosting platform requires it, and let the platform supply `PORT`. Start command from the repo root: `npm run server`.

Put HTTPS/WSS in front of the process and serve the phone app itself over HTTPS for browser location permission. The phone client's production default is the same site's `wss://YOUR_SITE/play`; proxy **`/play`, `/nearby`, and `/api/v1/`** to the Node service, forwarding WebSocket upgrade headers. The client derives `/nearby` and the HTTP API from the configured `/play` address. If the UI and backend use separate domains, configure the client's server URL to the backend's public WSS URL. Use at least a 60-second reverse proxy idle timeout; the backend sends a ping every 20 seconds. Set `ALLOWED_ORIGINS` to comma-separated exact browser origins:

```sh
ALLOWED_ORIGINS=https://your-site.example,https://preview.example HOST=0.0.0.0 PORT=8788 npm run server
```

When configured, absent and nonmatching `Origin` headers are rejected. When unset, any origin is allowed for local development. Origin checks supplement room tokens; they are not account authentication.

Example nginx location inside your HTTPS site configuration:

```nginx
location ~ ^/(play|nearby|api/v1/.*)$ {
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 75s;
}
```

Run one server instance for this prototype. Multiple replicas need shared discovery/room state or compatible routing. A restart or deploy loses live rooms; clients should start discovery or create a fresh room if the previous one no longer exists. SQLite keeps player, pet, friendship, and reward progress. No AI key, camera, microphone, or recording service is required for multiplayer.

## Nearby discovery and real-world quests

`/nearby` is a separate WebSocket endpoint on the same process, governed by `ALLOWED_ORIGINS`. Its typed protocol is in `shared/nearby-protocol.ts`.

- Register with `discover`, then send fresh `location` fixes only while explicitly opted in and foregrounded. Each fix includes latitude, longitude, reported accuracy, and its timestamp. `pause` immediately deletes presence and cancels pending invitations; a fresh `discover` registration is necessary before publishing again. The supplied client opens a new discovery connection on Resume.
- The server returns at most eight peers estimated within 10 meters, sorted by distance. It excludes fixes older than 20 seconds or less accurate than 25 meters. Public messages contain approximate distance rounded to 5 meters and an uncertainty flag, never coordinates or location history. This is an approximate discovery filter, not proof of physical proximity.
- `meet` requests a peer; `respond` accepts or declines. Invitations expire after 30 seconds and are canceled when either presence becomes unavailable. Acceptance rechecks both locations and reserves two private player tokens in an encounter room. Each participant receives only their own token. Both join `/play` using the matched token; code-only entry to these rooms is rejected.
- `confirm_dap` records the current participant's report of an in-person hello. Both players must be connected. Each player can confirm once; two confirmations award one shared bond, with completion exposed in optional `snapshot.encounter`. GPS does not verify a gesture. The standard pet-play quest remains separate.

Coordinates are held only in memory, discarded on pause, disconnect, match, or freshness expiry, and not logged. Client-supplied locations and confirmations are trust-based prototype inputs and are not anti-cheat or proof of attendance.

## Wire behavior

The TypeScript contract is in `shared/play-protocol.ts`; runtime input validation is in `shared/play-protocol.mjs`.

- The phone first creates or resumes a guest account through `/api/v1/players` and `/api/v1/me`. Send `{ "type": "create", "name": "Alex", "accountToken": "..." }`, or `{ "type": "join", "roomCode": "ABC234", "name": "Blair", "accountToken": "..." }`. Names are limited to 24 Unicode characters. The `welcome` response includes room code, your room player ID, your private rejoin token, and the current snapshot. Rejoins send the same account token as well.
- Save the returned token privately per room/player. To reconnect within 30 seconds of disconnection, send `join` with the saved `playerToken`. The same player resumes; a still-open old connection is replaced. Tokens are never included in public snapshots. After grace expires, join without the expired token to take an available slot.
- A second player needs the room code, not the first player's token. Explicit `leave` immediately releases the slot and invalidates its token. A disconnected player reserves their place briefly; the snapshot marks `connected: false`.
- Send `{ "type": "move", "x": 1, "z": 0 }` for a destination in the shared ground plane. X/Z are clamped to ±3. The server moves pets at 2 units/second and broadcasts authoritative snapshots at 20Hz. Throttle pointer movement to about 10 updates/second; do not send every render frame. Client rendering can interpolate positions between snapshots.
- Send `{ "type": "action", "action": "wave" }` for `wave`, `feed`, `jump`, or `play`. Action timing uses epoch milliseconds from the server. `play` requires both players connected and within 1.5 units, animates both pets, and awards one room bond point with a five-second cooldown. Verified room actions update persistent rewards and pets, subject to the reward cooldown and daily limit. Quest flags record meeting, waving near a friend, and playing together.
- Errors include `room_not_found`, `room_full`, `invalid_token`, `not_joined`, `already_joined`, `friend_too_far`, `action_busy`, `play_cooldown`, `invalid_message`, `rate_limited`, and `server_full`. Display the message; never silently create a fake companion.

The service bounds rooms, connections, message size, send buffers, and per-connection mutation rates. It expires empty rooms after ten minutes and drops nonresponsive clients using heartbeat pings. Admission limits use the actual peer IP, ignoring untrusted forwarded headers; when many users share a reverse proxy or NAT, its burst capacity is shared. For a public launch, use edge rate limits and a deliberate trusted-proxy setup. Room codes are invitations, and possession of a rejoin token permits control of its pet. Do not put tokens in public invitation URLs or logs.

## Verify

```sh
node --test bridge/play-server.test.mjs bridge/nearby-discovery.test.mjs
```

Tests open real WebSocket clients to verify multiplayer motion, cooperative quests, room capacity, token isolation and reconnection, malformed inputs, message bounds, room expiry, and origin restrictions.
