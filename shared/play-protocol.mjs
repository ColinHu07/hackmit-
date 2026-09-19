export const PLAY_WORLD_LIMIT = 3;
export const PLAY_FRIEND_DISTANCE = 1.5;
export const PLAY_TICK_MS = 50;
export const PLAY_ACTIONS = Object.freeze(['wave', 'feed', 'play', 'jump']);
export const PLAY_ACTION_DURATION = Object.freeze({ wave: 1800, feed: 2400, play: 3000, jump: 1000 });
export const PLAY_ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PLAY_MAX_MESSAGE_BYTES = 1024;

/** Validate before mutation. Coordinates are destinations, never trusted positions. */
export function parsePlayMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = {
    create: ['type', 'name', 'accountToken'], join: ['type', 'roomCode', 'name', 'playerToken', 'accountToken'],
    move: ['type', 'x', 'z'], action: ['type', 'action'], leave: ['type'], confirm_dap: ['type'],
    interaction_invite: ['type', 'requestId', 'kind', 'targetPlayerId'],
    interaction_respond: ['type', 'interactionId', 'accept'],
    device_grant: ['type'], attach_display: ['type', 'grant'],
  };
  if (typeof input.type !== 'string' || !Object.hasOwn(allowed, input.type) || Object.keys(input).some(key => !allowed[input.type].includes(key))) return null;
  if (input.type === 'leave') return { type: 'leave' };
  if (input.type === 'confirm_dap') return { type: 'confirm_dap' };
  if (input.type === 'device_grant') return { type: 'device_grant' };
  if (input.type === 'attach_display') return typeof input.grant === 'string' && /^[A-HJ-NP-Z2-9]{8}$/.test(input.grant)
    ? { type: 'attach_display', grant: input.grant } : null;
  if (input.type === 'interaction_invite') {
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
      || input.kind !== 'high_five' || typeof input.targetPlayerId !== 'string'
      || !/^[a-f0-9-]{36}$/.test(input.targetPlayerId)) return null;
    return { type: input.type, requestId: input.requestId, kind: input.kind, targetPlayerId: input.targetPlayerId };
  }
  if (input.type === 'interaction_respond') {
    if (typeof input.interactionId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.interactionId)
      || typeof input.accept !== 'boolean') return null;
    return { type: input.type, interactionId: input.interactionId, accept: input.accept };
  }
  if (input.type === 'move') {
    if (typeof input.x !== 'number' || typeof input.z !== 'number' || !Number.isFinite(input.x) || !Number.isFinite(input.z)) return null;
    const clamp = value => Math.max(-PLAY_WORLD_LIMIT, Math.min(PLAY_WORLD_LIMIT, value));
    return { type: 'move', x: clamp(input.x), z: clamp(input.z) };
  }
  if (input.type === 'action') return PLAY_ACTIONS.includes(input.action) ? { type: 'action', action: input.action } : null;
  if (typeof input.name !== 'string' || input.name.length > 80) return null;
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name || Array.from(name).length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  if (input.accountToken !== undefined && (typeof input.accountToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.accountToken))) return null;
  if (input.type === 'create') return { type: 'create', name, ...(input.accountToken === undefined ? {} : { accountToken: input.accountToken }) };
  if (typeof input.roomCode !== 'string' || input.roomCode.length > 12) return null;
  const roomCode = input.roomCode.trim().toUpperCase();
  if (roomCode.length !== 6 || [...roomCode].some(char => !PLAY_ROOM_ALPHABET.includes(char))) return null;
  if (input.playerToken !== undefined && (typeof input.playerToken !== 'string' || !/^[a-f0-9]{48}$/.test(input.playerToken))) return null;
  return { type: 'join', roomCode, name, ...(input.playerToken === undefined ? {} : { playerToken: input.playerToken }), ...(input.accountToken === undefined ? {} : { accountToken: input.accountToken }) };
}
