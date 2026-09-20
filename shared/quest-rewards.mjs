// Demo pacing. Production can use QUEST_STANDARD_COOLDOWN_MS instead.
export const QUEST_STANDARD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const QUEST_COOLDOWN_MS = 60_000;
export const QUEST_REWARD = Object.freeze({ happiness: 12, berries: 2, points: 10 });
export const REWARD_QUEST_IDS = Object.freeze(['touchGrass', 'meetFriend', 'dapHandshake', 'squadCircle']);
