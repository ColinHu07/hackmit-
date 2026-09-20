import { FEED_DURATION_MS } from './feeding.mjs';
export const PLAY_WORLD_LIMIT = 10_000;
export const PLAY_FRIEND_DISTANCE = 1.5;
export const PLAY_TOGETHER_DISTANCE = 3; // 15 real meters in the scaled meadow.
export const PLAY_TICK_MS = 50;
export const PLAY_MAX_PLAYERS = 4;
export const PLAY_ACTIONS = Object.freeze(['wave', 'feed', 'play', 'jump', 'dap']);
export const PLAY_ACTION_DURATION = Object.freeze({ wave: 3400, feed: FEED_DURATION_MS, play: 9000, jump: 1400, dap: 1400 });
export const PLAY_ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PLAY_MAX_MESSAGE_BYTES = 1024;

/** Validate before mutation. Coordinates are destinations, never trusted positions. */
export function parsePlayMessage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = {
    lobby: ['type', 'name', 'playerToken'],
    create: ['type', 'name'], join: ['type', 'roomCode', 'name', 'playerToken'],
    steps: ['type', 'count', 'yaw'],
    location: ['type', 'latitude', 'longitude', 'accuracy', 'timestamp'],
    heading: ['type', 'yaw', 'lock'], move: ['type', 'x', 'z'], action: ['type', 'action'], leave: ['type'], confirm_dap: ['type'], ready_squad_quest: ['type'], ready_raid: ['type'],
  };
  if (typeof input.type !== 'string' || !Object.hasOwn(allowed, input.type) || Object.keys(input).some(key => !allowed[input.type].includes(key))) return null;
  if (input.type === 'leave') return { type: 'leave' };
  if (input.type === 'confirm_dap') return { type: 'confirm_dap' };
  if (input.type === 'ready_squad_quest') return { type: 'ready_squad_quest' };
  if (input.type === 'ready_raid') return { type: 'ready_raid' };
  if (input.type === 'heading') {
    if (typeof input.yaw !== 'number' || !Number.isFinite(input.yaw)) return null;
    if (input.lock !== undefined && typeof input.lock !== 'boolean') return null;
    return { type: 'heading', yaw: Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw)),
      ...(input.lock === undefined ? {} : { lock: input.lock }),
    };
  }
  if (input.type === 'steps') {
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 2 || typeof input.yaw !== 'number' || !Number.isFinite(input.yaw)) return null;
    return { type: 'steps', count: input.count, yaw: Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw)) };
  }
  if (input.type === 'location') {
    if (![input.latitude, input.longitude, input.accuracy, input.timestamp].every(value => typeof value === 'number' && Number.isFinite(value)) || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180 || input.accuracy < 0) return null;
    return { type: 'location', latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy, timestamp: input.timestamp };
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
  if (input.type === 'create') return { type: 'create', name };
  if (input.playerToken !== undefined && (typeof input.playerToken !== 'string' || !/^[a-f0-9]{48}$/.test(input.playerToken))) return null;
  if (input.type === 'lobby') return { type: 'lobby', name, ...(input.playerToken === undefined ? {} : { playerToken: input.playerToken }) };
  if (typeof input.roomCode !== 'string' || input.roomCode.length > 12) return null;
  const roomCode = input.roomCode.trim().toUpperCase();
  if (roomCode.length !== 6 || [...roomCode].some(char => !PLAY_ROOM_ALPHABET.includes(char))) return null;
  if (input.playerToken !== undefined && (typeof input.playerToken !== 'string' || !/^[a-f0-9]{48}$/.test(input.playerToken))) return null;
  return { type: 'join', roomCode, name, ...(input.playerToken === undefined ? {} : { playerToken: input.playerToken }) };
}
