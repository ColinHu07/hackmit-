/** Opt-in discovery: approximate distances only; coordinates never leave the server. */
export interface NearbyPet {
  id: string;
  name: string;
  distanceMeters: number;
  uncertain: boolean;
}

export interface MeetRequest {
  requestId: string;
  peerId: string;
  name: string;
  expiresAt: number;
}

export type NearbyClientMessage =
  | { type: 'discover'; name: string }
  | { type: 'location'; latitude: number; longitude: number; accuracy: number; timestamp: number }
  | { type: 'pause' }
  | { type: 'meet'; peerId: string }
  | { type: 'respond'; requestId: string; accept: boolean };

export type NearbyServerMessage =
  | { type: 'discovery_ready'; selfId: string }
  | { type: 'nearby'; peers: NearbyPet[]; accuracy: number | null; notice: string }
  | { type: 'meet_request'; requestId: string; peerId: string; name: string; expiresAt: number }
  | { type: 'meet_sent'; requestId: string; peerId: string; name: string; expiresAt: number }
  | { type: 'request_closed'; requestId: string; reason: string }
  | { type: 'matched'; roomCode: string; playerToken: string }
  | { type: 'error'; code: string; message: string };

export const NEARBY_RADIUS_METERS = 10;
export const NEARBY_MAX_ACCURACY_METERS = 25;
export const NEARBY_LOCATION_FRESH_MS = 20_000;
export const NEARBY_REQUEST_TTL_MS = 30_000;
