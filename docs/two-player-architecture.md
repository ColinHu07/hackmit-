# Two-player architecture plan

Status: implementation in progress. The phone high-five flow and read-only glasses virtual view are implemented. Client extraction, controller handoff, and physical alignment remain proposed work.

## Goal and first release

Two people join the same session from phones, see both pets, and initiate an interaction that the other person can accept or decline. Both clients see the same result, and an accepted interaction can update persistent pet and friendship progress. A glasses client can join that same session and display its events. The first release uses the existing virtual meadow. A physically aligned AR scene is a separate capability gate.

Success means two separate players can join, move, invite, accept, reconnect, and see one authoritative outcome without duplicate rewards. A companion device may view an existing player's slot, but cannot become a third player in a two-player room.

## What exists now

- `bridge/play-server.mjs` owns two-person, in-memory rooms, 20 Hz movement snapshots, pet proximity, shared `play`, and nearby meetup confirmation. `shared/play-protocol.ts` defines the phone wire contract.
- `companion-web/src/RoomClient.ts` connects to `/play`; `Playground.ts` draws both pets in a virtual ground plane.
- `backend/server.mjs` and `backend/store.mjs` own durable guest accounts, pets, rewards, friendships, and room events. `/play` already calls this store for some rewards when both participants carry account tokens.
- The glasses app's `GameClient.ts` uses the account API and `/api/v1/live`. Its room controls are simulator-only, and `NovaRenderer.ts` draws a locally controlled Nova rather than the two `/play` participants.
- `PseudoWorldAnchor.ts` provides a direction anchor. It has no shared position, depth, or physical-space alignment.

The repository has substantial work in progress. Implement this plan in small changes without replacing the existing local glasses experience or the phone discovery flow.

## Ownership and data flow

```text
Phone A ── /nearby ──┐
Phone B ── /nearby ──┤  discovery and mutual match (temporary)
                     ▼
Phone A ── /play ──► authoritative session ◄── /play ── Phone B
Glasses ── /play ──► room membership, pet poses, invitations, outcomes
                     │
                     └── account store: durable pets, rewards, friendships
```

**One live session model.** `/play` is the authority for membership, connection state, pet position, action timing, proximity, and interaction state. Clients send intent, never final positions or earned rewards. The account store is the authority for durable player identity and progression. `/nearby` only discovers and arranges a mutually accepted match; it neither owns a second room model nor proves physical contact. The standalone account rooms and `/api/v1/live` can continue for legacy clients during migration, but new shared play should use `/play` room IDs and events. Do not create another independent glasses room implementation.

**Two identities, with distinct lifetimes.** An account token identifies the durable player. A room-scoped, random rejoin token identifies the participant slot for this encounter. Link the participant to an account ID at admission and reject use of the same account in both slots. Today a reconnect replaces the old socket. Extend the slot to support a phone controller plus an optional glasses display subscriber, with one explicit controller lease for movement and actions. A controller handoff revokes the old lease; a display subscriber can observe and accept only through a deliberate control handoff. Multiple sockets never create multiple pets. Keep account and rejoin tokens out of snapshots and invite links. Room codes admit a new participant only to public rooms; nearby matched rooms retain their private admission tokens.

**One coordinate system per room.** The server uses the current bounded X/Z meadow coordinates in world units. Every snapshot and interaction target refers to those coordinates and stable participant IDs. Phone and glasses renderers transform the same room state into their own cameras. Neither client's screen pixels, head yaw, GPS coordinate, nor camera landmarks are room coordinates. Add an explicit `space: 'virtual'` field before introducing another coordinate mode.

## Wire contract

Evolve `shared/play-protocol.ts` and its runtime parser together. Keep existing `create`, `join`, `move`, `action`, `confirm_dap`, and `leave` commands for compatibility. Add a protocol version to `welcome`; reject unsupported major versions with a clear error. Prefer additive snapshot fields for minor changes.

Proposed interaction messages:

| Direction | Message | Meaning |
| --- | --- | --- |
| Client → server | `interaction_invite { requestId, kind, targetPlayerId }` | Ask the other participant to interact. `kind` starts with `high_five`; later kinds have explicit rules. |
| Server → room | `interaction_pending { interactionId, kind, actorId, targetId, expiresAt }` | One pending invitation, visible to both clients. |
| Client → server | `interaction_respond { interactionId, accept }` | Only the targeted participant can answer. |
| Server → room | `interaction_resolved { interactionId, outcome, startedAt, duration }` | Accepted, declined, expired, canceled, or unavailable. Both clients animate only an accepted outcome. |

Use server-generated interaction IDs and epoch timestamps. `requestId` is a client-generated idempotency key scoped to the actor and room. Store recently resolved keys through the room lifetime so a retry receives the same outcome and cannot grant a second reward. Include the current pending interaction and latest resolved outcome in `welcome`/snapshots so reconnecting clients recover state. A monotonically increasing room revision lets clients ignore old snapshots or duplicate events. Do not rely on a WebSocket event being delivered exactly once.

An accepted `high_five` requires both participants connected, within the configured pet distance, and free of another active interaction. Check these conditions on invitation and again on acceptance. Only the target can accept. Expire unanswered invitations after a short server-side deadline, cancel when either player leaves, and bound invitations with a cooldown. The server atomically resolves the state before broadcasting and uses the interaction ID as the durable reward idempotency key. The account store records the reward once, then exposes updated profile values; its existing daily limits remain authoritative. If persistence fails, report the shared animation outcome and an explicit reward status instead of silently fabricating rewards.

Keep `wave`, `feed`, `jump`, and current cooperative pet `play` as pet actions. Define any new player interaction separately so the UI does not confuse an individual `play` button, joint pet play, and a consent-based interaction.

## Client boundaries

Extract a small shared TypeScript session client from `companion-web/src/RoomClient.ts`: connection, version validation, snapshot ordering, rejoin, command methods, and interaction state callbacks. Phone and glasses adapters can supply storage and UI messages. Keep Three.js and DOM code out of the transport. Preserve the phone's existing movement controls and `Playground` rendering, then add a target selection affordance, invitation prompt, expiry, and accepted animation tied to server timestamps.

For glasses, add `/play` membership through phone-assisted pairing. The phone should carry the account and room credentials; transfer only a short-lived, one-use, room-scoped device grant to glasses. Redeem it server-side as a display subscription to that player's slot. Start with phone-owned controls; add an explicit controller handoff before enabling glasses invite/accept controls. Avoid typing bearer tokens on glasses or putting them in URLs. On the display, show the remote pet from the same snapshot. Keep the current local `CreatureSession` as an offline mode; do not let it award network rewards or move the authoritative pet when connected.

Refactor rendering around `participantId → pet visual` and a view adapter. The phone view maps room X/Z to its overhead meadow. The glasses virtual view projects room positions relative to a chosen virtual camera/reference; it must be labeled as a virtual view. Reuse asset loading and pose code where practical, but avoid importing phone UI or treating `PseudoWorldAnchor` as a shared spatial anchor. Input targeting must select a participant ID; the server validates that ID and range.

## Physical alignment gate

Nearby GPS can suggest two people are close; it cannot align their coordinate frames or verify a high five. The current glasses orientation is yaw/pitch only, and the camera hand pipeline provides 2D landmarks. Physical AR placement requires measured device position and orientation in a shared frame, an alignment/calibration procedure, confidence and freshness bounds, and a recovery path when tracking is lost. Until that exists, keep all proximity rules in the virtual meadow and make real-world hello a two-person confirmation. Never infer physical distance from the meadow coordinates, head direction, or hand size.

Before adding `space: 'physical'`, prove on devices that both users see a static reference in the same place after moving and turning, and that translation and tracking loss are reported. Then define a versioned room transform and confidence policy. If the hardware cannot supply reliable shared poses, retain virtual play plus explicit in-person confirmation.

## Persistence and deployment

Keep frequent poses and pending invitations ephemeral. Persist only account state, completed interaction IDs, reward transactions, and any event history the product needs after a restart. For the first release, run one `/play` process, as the current in-memory rooms require. Rejoin has a 30-second grace period; a process restart ends active rooms and clients must show a recoverable "room ended" state. Multi-instance hosting later requires a shared room-state owner or sticky routing plus shared discovery/pub-sub; moving only SQLite to shared storage is insufficient.

Continue server-side message validation, rate limits, bounded rooms/buffers, origin checks, and WSS. Add limits for pending invites and responses. Account tokens remain credentials; use HTTPS/WSS and an explicit session-revocation path before broad deployment. Do not log coordinates, hand landmarks, rejoin tokens, or device grants.

## Implementation sequence

1. **Unify the contract.** Add version, room revision, participant account linkage internally, idempotent interaction state, and parser tests. Keep old phone messages working.
2. **Implement one interaction end to end on phones.** Add invite/accept/decline/expiry to `/play`, transactionally persist the reward, and add two-device UI/animation. Test crossed invites, disconnects, retries, distance changes, and duplicate delivery.
3. **Extract the shared client.** Move transport and reconnect logic out of phone UI; preserve current phone behavior with client tests and real WebSocket server tests.
4. **Join from glasses in virtual mode.** Add the device grant/pairing flow, render both pets from the room snapshot, and route focused controls through the shared client. Validate simulator first, then physical display input and connection recovery.
5. **Evaluate physical alignment.** Run the hardware measurements above. Add a physical room mode only after its pose source and failure policy are demonstrated.

## Acceptance checks

Current checkpoint: `/play` sends protocol version 1, room revisions, virtual-space snapshots, and high-five invitation state. Phones can invite, accept, decline, and animate an accepted interaction. A phone controller can issue a one-use, 60-second display code; `glasses-web/shared.html` observes both pets without taking a player slot. This view remains separate from the direction-anchored local Nova display. Durable completed interaction IDs across process restarts and shared physical alignment are not implemented.

- Two independent accounts join one room; each controls exactly one pet; a third account is rejected.
- Inviting, accepting, declining, timing out, moving apart, disconnecting, and rejoining yield the same visible state on both devices.
- Duplicate or reordered commands and reconnects produce at most one resolved interaction and one durable reward per participant.
- A glasses client sees the same participant IDs, positions, and outcome as both phones in virtual mode; local/offline petting still works when no room is joined.
- Server restart, lost network, and expired credentials produce explicit recovery UI. No screen or virtual coordinate is presented as measured physical position.
