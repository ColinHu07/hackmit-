/** Shared wire contract for the phone playground and future glasses clients. */
export type PetActionKind = 'wave' | 'feed' | 'play' | 'jump' | 'dap';
export type EvidenceQuestId = 'touchGrass' | 'meetFriend' | 'dapHandshake' | 'squadCircle';
export type PhotoVerificationStatus = 'required' | 'pending' | 'approved' | 'rejected';

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

/** Progress belongs to a player, not to the browser that happens to be open. */
export interface PlayerQuests {
  touchGrass: boolean;
  meetFriend: boolean;
  squadCircle: boolean;
  /** Earned by each participant when their squad calms Mossback. */
  raidBoss: boolean;
  dapHandshake: boolean;
  /** Paired in-game preparation; completion requires camera approval. */
  dapHandshakeReady: boolean;
  /** Photo checks are opt-in uploads and are only kept as a decision, never as image data. */
  photoVerification: Partial<Record<EvidenceQuestId, PhotoVerificationStatus>>;
}

export interface RaidBossState {
  /** Waiting is safe to render even before a squad is present. */
  state: 'waiting' | 'active' | 'defeated';
  ready: string[];
  participants: string[];
  minPlayers: number;
  health: number;
  maxHealth: number;
  endsAt: number | null;
}

export interface PlaySnapshot {
  roomCode: string;
  serverTime: number;
  players: PlayPlayer[];
  bond: number;
  /** Individual quests are keyed by the stable, server-issued player id. */
  quests: Record<string, PlayerQuests>;
  squad: { ready: string[]; minPlayers: number };
  raid: RaidBossState;
  /** A short-lived, server-owned invitation for a nearby virtual dap. */
  dap: { pending: { from: string; to: string; expiresAt: number }[] };
  /** Kept for older clients while they move to the individual quest view. */
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
  | { type: 'ready_squad_quest' }
  | { type: 'ready_raid' }
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
export const PLAY_MAX_PLAYERS = 4;
