# Multiplayer game server

The game server persists players, invite based rooms, pet state, rewards, social interactions, friendships, and room events in SQLite. The camera bridge in `bridge/` remains a separate transport for hand landmarks. One game server process can serve many players; SQLite is configured for WAL mode. Run a single server instance against a database file.

## Run locally

From the repository root, run `npm install`, then start `npm run server`. In another terminal, start the web app with `BONDIMALS_WEB_ORIGIN=http://127.0.0.1:5173 VITE_GAME_SERVER_URL=http://127.0.0.1:8790 npm run dev` set in the appropriate server and web processes. For example:

```sh
BONDIMALS_WEB_ORIGIN=http://127.0.0.1:5173 npm run server
VITE_GAME_SERVER_URL=http://127.0.0.1:8790 npm run dev
```

Open `http://127.0.0.1:5173/?simulator`. The browser creates a player on first connection and stores its bearer token locally. Use separate browser profiles or devices for separate players. Create a room, share its invite code, and use the peer buttons to greet, play, or send a gift. These social actions update both players' pets and the sender's interaction count, XP, and coins. Local pet, feed, and play actions also save pet state when connected. With no server URL configured, the original local simulation still runs.

## API

All routes except player creation and health require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/v1/players` | Create player with `{ "name": "Alice" }`; returns token once |
| GET | `/api/v1/me` | Player, pet, rewards |
| POST | `/api/v1/me/pet/actions` | `{ "action": "pet" }`, `feed`, `play`, or `rest` |
| GET | `/api/v1/me/friends` | Friendship interaction counts |
| GET, POST | `/api/v1/rooms` | List joined rooms or create one |
| POST | `/api/v1/rooms/join` | Join via `{ "inviteCode": "..." }` |
| GET | `/api/v1/rooms/:id` | Room and members |
| POST | `/api/v1/rooms/:id/interactions` | `{ "targetId": "...", "kind": "greet|play|gift", "requestId": "unique-id" }` |
| GET | `/api/v1/rooms/:id/events?after=0` | Durable room event cursor |
| WS | `/api/v1/live` | First message `{ "token": "...", "roomId": "..." }`; streams new interactions |

The server rejects self interactions and users outside the room. It accepts at most one rewarded interaction per pair every 30 seconds and 20 per sender per rolling day. A first interaction with each peer during that day earns a bonus. `requestId` makes retries idempotent. Pet happiness decreases 12 points per day, hunger increases 18, and energy recovers 20; values are clamped to 0–100. Actions and social events adjust those values further. State is calculated from elapsed time whenever a pet is read or changed.

This is a prototype guest account system. A browser token is the account credential and is lost if local storage is cleared. Use HTTPS/WSS and a private deployment for real devices; set `BONDIMALS_WEB_ORIGIN` to the exact web origin. For multiple game server instances, move the store and event fanout to a shared database and pub/sub service.
