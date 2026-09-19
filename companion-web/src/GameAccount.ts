import { normalizeServerUrl } from './RoomClient';

export interface PetProfile {
  player: { id: string; name: string };
  pet: { happiness: number; energy: number; hunger: number; mood: string };
  rewards: { xp: number; coins: number; interactions: number };
}

export function gameApiBase(playUrl: string): string {
  const url = new URL(normalizeServerUrl(playUrl));
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = url.pathname.replace(/\/(play|ws)\/?$/, '').replace(/\/$/, '');
  url.search = '';
  return url.href.replace(/\/$/, '');
}

export class GameAccount {
  private constructor(private base: string, readonly token: string) {}

  static async connect(playUrl: string): Promise<GameAccount> {
    const base = gameApiBase(playUrl);
    const key = `bondimals:account:${base}`;
    let token = localStorage.getItem(key);
    if (token) {
      const existing = new GameAccount(base, token);
      try { await existing.profile(); return existing; } catch { localStorage.removeItem(key); }
    }
    const name = `Player_${crypto.randomUUID().slice(0, 8)}`;
    const response = await fetch(`${base}/api/v1/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!response.ok) throw new Error('Could not create your player account on this server.');
    token = (await response.json() as { token: string }).token;
    localStorage.setItem(key, token);
    return new GameAccount(base, token);
  }

  async profile(): Promise<PetProfile> {
    const response = await fetch(`${this.base}/api/v1/me`, { headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error('Could not load your pet and rewards.');
    return response.json() as Promise<PetProfile>;
  }
}
