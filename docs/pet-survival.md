# Pet survival and food inventory

The phone playground stores survival state in SQLite. Each room player token maps to one pet profile. The token is private to the player who owns that room slot and is not included in room snapshots.

## Point model

| Event | Points | Effect |
| --- | ---: | --- |
| Stay alive for one elapsed hour | +1 | Hunger and happiness decay first; health drops only after hunger reaches zero |
| Wave | +1 | Social action |
| Jump | +1 | Movement action |
| Dap | +2 | Mutual social action |
| Play together | +3 per participating pet | Shared play |
| Feed with a berry | +4 | Restores 18 hunger, 3 happiness, and 1 health |
| Feed with kibble | +7 | Restores 30 hunger, 4 happiness, and 3 health |
| Feed with a treat | +10 | Restores 10 hunger, 10 happiness, and 5 health |

New profiles start with 100 health, 78 hunger, 70 happiness, and zero points. Hunger falls by 8 points per hour, happiness falls by 1 point every 60 seconds, and health falls by 12 points per hour while hunger is empty. Values stay between 0 and 100. A survival hour is credited only while health is above zero. The profile advances when a snapshot, profile request, or food action reads it, so the server does not need a high frequency database timer.

## Inventory

New pets start with 3 berries, 2 kibble, and 1 treat. Feeding is transactional: the database checks quantity, decrements one item, applies stat changes, and records points in one transaction. Empty food returns a conflict response and never creates negative inventory.

The room `feed` action consumes one berry by default. The HTTP endpoint supports choosing a food item:

```sh
curl -X POST http://127.0.0.1:8788/api/inventory/feed \
  -H 'content-type: application/json' \
  -d '{"playerToken":"YOUR_PRIVATE_ROOM_TOKEN","food":"kibble"}'
```

Read a profile with `/api/pet?playerToken=...`. Room snapshots include the `survival` object for each player so the phone can render points, health, hunger, happiness, survival hours, and inventory.

## Persistence

The server runs SQLite in WAL mode and defaults to `.bondimals-data/game.sqlite`. That directory is ignored by Git. Set `BONDIMALS_DB_PATH` for a deployment volume. Point events have unique IDs, and all inventory mutations happen server-side. The current room token is the account credential for this prototype; a production account system should replace it with explicit authentication and token revocation.

Feeding consumes one item immediately, then grants happiness across the three visible bites in the 6.2-second animation. The bite fractions are shared with the animation; applied fractions are stored so repeated snapshots and server restarts cannot award them twice. The scene shows a hollow berry cooldown ring for the remaining portion of the one-hour feeding cooldown. All happiness displays use the server profile when it is available.

A known saved pet can rejoin the public lobby after its room expires or the server restarts, retaining food, points, and any unfinished bite reward. Private room admission still requires that room's live session.

Feeding slows happiness decay by 1.5× during that hour: one point is lost every 90 seconds instead of every 60 seconds. Feeding again (including via HTTP or after reconnecting) is refused until the cooldown ends. The interface shows a persistent boost notice and a minutes/seconds countdown. Decay keeps fractional progress across feeding and restarts, splits offline elapsed time at boost expiry, and never drops below zero. Existing profiles begin the faster decay clock at migration time, without a retroactive charge.
