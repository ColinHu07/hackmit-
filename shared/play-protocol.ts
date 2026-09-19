/** Shared wire contract for the phone playground and future glasses clients. */
export type PetActionKind = 'wave' | 'feed' | 'play' | 'jump';

export interface PetAction {
  id: string;
  kind: PetActionKind;
  startedAt: number;
  duration: number;
}

export interface PlayPlayer {
  id: string;
  name: string;
  slot: number;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  yaw: number;
  connected: boolean;
  action: PetAction | null;
}

export interface PlaySnapshot {
  roomCode: string;
  serverTime: number;
  players: PlayPlayer[];
  bond: number;
  quest: { met: boolean; waved: boolean; played: boolean };
  notice: string;
  encounter?: { kind: 'nearby'; dapConfirmed: string[]; dapComplete: boolean };
}

export type PlayClientMessage =
  | { type: 'create'; name: string }
  | { type: 'join'; roomCode: string; name: string; playerToken?: string }
  | { type: 'heading'; yaw: number }
  | { type: 'move'; x: number; z: number }
  | { type: 'action'; action: PetActionKind }
  | { type: 'confirm_dap' }
  | { type: 'leave' };

export type PlayServerMessage =
  | { type: 'welcome'; roomCode: string; playerId: string; playerToken: string; snapshot: PlaySnapshot }
  | { type: 'snapshot'; snapshot: PlaySnapshot }
  | { type: 'error'; code: string; message: string };

export type ClientMessage = PlayClientMessage;
export type ServerMessage = PlayServerMessage;

export const PLAY_WORLD_LIMIT = 3;
export const PLAY_FRIEND_DISTANCE = 1.5;
export const PLAY_TICK_MS = 50;
