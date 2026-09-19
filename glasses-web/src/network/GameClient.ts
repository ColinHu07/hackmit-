export interface GameProfile {
  player: { id: string; name: string };
  pet: { happiness: number; energy: number; hunger: number; mood: string };
  rewards: { xp: number; coins: number; interactions: number };
}
export interface GameRoom { roomId: string; inviteCode: string; players?: { id: string; name: string }[] }

/** Optional persistent multiplayer state. The server owns all rewards and pet statistics. */
export class GameClient {
  private token: string;
  private constructor(private base: string, token: string) { this.token = token; }

  static async connect(base: string): Promise<GameClient> {
    const key = `bondimals-token:${base}`;
    let token = localStorage.getItem(key);
    if (!token) {
      const name = `Player_${Math.random().toString(36).slice(2, 8)}`;
      const response = await fetch(`${base}/api/v1/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error('Could not create a player.');
      token = (await response.json() as { token: string }).token;
      localStorage.setItem(key, token);
    }
    const client = new GameClient(base, token);
    await client.profile();
    return client;
  }

  private async request<T>(path: string, method = 'GET', body?: object): Promise<T> {
    const response = await fetch(`${this.base}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `Server error ${response.status}`);
    return result;
  }
  profile(): Promise<GameProfile> { return this.request('/api/v1/me'); }
  rooms(): Promise<{ rooms: GameRoom[] }> { return this.request('/api/v1/rooms'); }
  createRoom(): Promise<GameRoom> { return this.request('/api/v1/rooms', 'POST'); }
  joinRoom(inviteCode: string): Promise<GameRoom> { return this.request('/api/v1/rooms/join', 'POST', { inviteCode }); }
  room(roomId: string): Promise<GameRoom> { return this.request(`/api/v1/rooms/${roomId}`); }
  care(action: 'pet' | 'feed' | 'play'): Promise<{ pet: GameProfile['pet']; rewards: GameProfile['rewards'] }> { return this.request('/api/v1/me/pet/actions', 'POST', { action }); }
  interact(roomId: string, targetId: string, kind: 'greet' | 'play' | 'gift'): Promise<unknown> {
    return this.request(`/api/v1/rooms/${roomId}/interactions`, 'POST', { targetId, kind, requestId: crypto.randomUUID() });
  }
  subscribe(roomId: string, onEvent: (event: { type: string; payload?: { targetId?: string; kind?: string }; actorId?: string }) => void): WebSocket {
    const url = new URL(this.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/api/v1/live';
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ token: this.token, roomId })));
    socket.addEventListener('message', event => onEvent(JSON.parse(event.data as string)));
    return socket;
  }
}
