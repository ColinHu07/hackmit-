# Raid boss: Mossback, Keeper of the Pen

Mossback is a gentle, oversized turtle-goat made of moss, flower buds, and small lanterns. It keeps the friendly tone of Bondimals: the party is not hurting an animal; it is calming a tangled guardian that has grown too much noisy vine magic around its shell.

## Party and unlock

- Requires three or four connected players in one pen. The raid card is visible earlier but locked with the exact party-size requirement.
- Every connected player must finish the squad-circle quest, gather close together, and choose **Call Mossback**. A disconnect or timeout resets the attempt safely.

## Current playable prototype

The shipped encounter is deliberately small and reliable: Mossback has `8 + 2 × party size` calm points (14 for three pets, 16 for four) and a 45-second timer. Wave, Treat, and Jump calm one point; Play together calms two. Victory marks the individual `raidBoss` quest for every participating player and grants five shared bond points. The authoritative room server, rather than any phone, validates the party, timer, meter, actions, and reward.

This keeps the first version testable on a LAN phone build. The sequence below is the designed second iteration, not behavior the current UI promises.

## Encounter loop

Mossback has **calm** points, not health. Every player receives a private cooldown, while the room server owns boss state, timers, and rewards.

| Phase | What Mossback does | What the party does | Reward |
| --- | --- | --- | --- |
| 1. Find the trail | Drops three glowing grass patches | Each player touches a different patch | 3 calm |
| 2. Echo hello | Calls a color or emote | All active players wave within 5 seconds | 4 calm |
| 3. Lantern circle | Lanterns orbit the pen | Squad gathers tightly and readies together | 5 calm and victory |

Missing a beat adds one **tangle**. At three tangles, Mossback rests and the party retries the current phase; there is no permanent loss or loss of earned personal quest progress.

## Roles without class-locking

Players can choose a different role each attempt: Trailfinder gets nearby patch hints, Greeter gets a longer wave timing window, and Gardener can clear one tangle by using a treat. A group can still win with any mix, so a friend is never excluded for choosing the "wrong" pet.

## Rewards and safety

The current build awards the Mossback quest and shared bond points. The next reward set can add a Mossback leaf badge, a shared meadow lantern cosmetic, and +24 happiness once per account/season. All rewards are server-issued and idempotent. The encounter uses only room membership and in-world movement/actions—no camera recording, precise GPS, contact information, or real-world meeting proof. If accessibility or motion settings are enabled, a stationary tap target replaces movement-heavy trail patches.

## Build notes

The initial `raid` snapshot state and `ready_raid` protocol are implemented. Add phase-specific interactions to that server-owned state rather than letting clients compute phase completion or rewards. Preserve the current four-player cap, rejoin grace period, rate limits, and per-player quest records.
