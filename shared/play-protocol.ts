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
  revision?: number;
  space?: 'virtual';
  players: PlayPlayer[];
  bond: number;
  quest: { met: boolean; waved: boolean; played: boolean };
  notice: string;
  interaction?: PlayInteraction | null;
  encounter?: { kind: 'nearby'; dapConfirmed: string[]; dapComplete: boolean };
}

export interface PlayInteraction {
  id: string;
  kind: 'high_five';
  actorId: string;
  targetId: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'canceled';
  expiresAt: number;
  startedAt?: number;
  duration?: number;
  rewardStatus?: 'awarded' | 'unavailable' | 'not_linked';
}

export type PlayClientMessage =
  | { type: 'create'; name: string; accountToken?: string }
  | { type: 'join'; roomCode: string; name: string; playerToken?: string; accountToken?: string }
  | { type: 'move'; x: number; z: number }
  | { type: 'action'; action: PetActionKind }
  | { type: 'confirm_dap' }
  | { type: 'interaction_invite'; requestId: string; kind: 'high_five'; targetPlayerId: string }
  | { type: 'interaction_respond'; interactionId: string; accept: boolean }
  | { type: 'device_grant' }
  | { type: 'attach_display'; grant: string }
  | { type: 'leave' };

export type PlayServerMessage =
  | { type: 'welcome'; protocolVersion?: 1; roomCode: string; playerId: string; playerToken: string; snapshot: PlaySnapshot }
  | { type: 'snapshot'; snapshot: PlaySnapshot }
  | { type: 'device_grant'; grant: string; expiresAt: number }
  | { type: 'display_welcome'; protocolVersion: 1; roomCode: string; playerId: string; snapshot: PlaySnapshot }
  | { type: 'error'; code: string; message: string };

export type ClientMessage = PlayClientMessage;
export type ServerMessage = PlayServerMessage;

export const PLAY_WORLD_LIMIT = 3;
export const PLAY_FRIEND_DISTANCE = 1.5;
export const PLAY_TICK_MS = 50;
