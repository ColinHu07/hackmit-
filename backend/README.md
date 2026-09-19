# Multiplayer game server

The game server persists players, invite based rooms, pet state, rewards, social interactions, friendships, and room events in SQLite. The phone playground mounts this API on the same port as `/play` and `/nearby`. The camera bridge remains a separate transport for hand landmarks. Run a single game server process against the database file.

## Run locally

From the repository root, run `npm install`, then start `npm run server`. In another terminal, start the phone app with `npm run dev:phone`. The glasses simulator can connect to the same API:

```sh
ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:5217 npm run server
VITE_GAME_SERVER_URL=http://127.0.0.1:8788 npm run dev
```

The phone app creates a persistent guest player before joining `/play`; both phones use their own bearer token. Room movement, waves, treats, and cooperative play travel over `/play`. Successful shared play, nearby dap confirmations, and waves near a friend update both players' persistent pets and rewards. The phone app shows each player's pet stats, interaction count, XP, and coins. Room movement and nearby presence are temporary, while account progress survives restart. Use separate browser profiles or devices for separate players. The glasses simulator can also use the API for its own rooms and pet actions; with no server URL, it remains local.

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

This is a prototype guest account system. A browser token is the account credential and is lost if local storage is cleared. Use HTTPS/WSS and a private deployment for real devices; set `ALLOWED_ORIGINS` to the exact web origins. For multiple game server instances, move the store and event fanout to a shared database and pub/sub service. `npm run api:server` still runs the standalone REST API for isolated development; the phone app needs the unified `npm run server` entry point.
