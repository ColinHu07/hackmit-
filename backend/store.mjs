import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const DAY = 86_400_000;
const clamp = value => Math.max(0, Math.min(100, value));
const hash = value => createHash('sha256').update(value).digest('hex');
const id = () => randomUUID();
const code = () => randomBytes(5).toString('hex').toUpperCase();
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };

export function createStore(filename, now = () => Date.now()) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pets (player_id TEXT PRIMARY KEY REFERENCES players(id), happiness REAL NOT NULL, energy REAL NOT NULL, hunger REAL NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rewards (player_id TEXT PRIMARY KEY REFERENCES players(id), xp INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, interactions INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, owner_id TEXT NOT NULL REFERENCES players(id), created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (room_id TEXT NOT NULL REFERENCES rooms(id), player_id TEXT NOT NULL REFERENCES players(id), joined_at INTEGER NOT NULL, PRIMARY KEY(room_id, player_id));
    CREATE TABLE IF NOT EXISTS interactions (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), actor_id TEXT NOT NULL REFERENCES players(id), target_id TEXT NOT NULL REFERENCES players(id), kind TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(actor_id, id));
    CREATE INDEX IF NOT EXISTS interaction_pair_time ON interactions(actor_id, target_id, created_at);
    CREATE TABLE IF NOT EXISTS friendships (player_a TEXT NOT NULL REFERENCES players(id), player_b TEXT NOT NULL REFERENCES players(id), count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(player_a, player_b));
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id), type TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES players(id), payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS room_events ON events(room_id, id);
  `);

  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const player = playerId => get('SELECT id, name, created_at AS createdAt FROM players WHERE id = ?', playerId);
  const member = (roomId, playerId) => !!get('SELECT 1 FROM memberships WHERE room_id = ? AND player_id = ?', roomId, playerId);
  const requireMember = (roomId, playerId) => { if (!member(roomId, playerId)) fail(403, 'Join this room first.'); };
  const event = (roomId, type, actorId, payload) => {
    const createdAt = now();
    const result = run('INSERT INTO events (room_id, type, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?)', roomId, type, actorId, JSON.stringify(payload), createdAt);
    return { id: Number(result.lastInsertRowid), roomId, type, actorId, payload, createdAt };
  };
  const pet = playerId => {
    const row = get('SELECT * FROM pets WHERE player_id = ?', playerId);
    const current = now();
    const elapsed = Math.max(0, current - row.updated_at) / DAY;
    const state = {
      happiness: clamp(row.happiness - 12 * elapsed),
      energy: clamp(row.energy + 20 * elapsed),
      hunger: clamp(row.hunger + 18 * elapsed),
    };
    run('UPDATE pets SET happiness = ?, energy = ?, hunger = ?, updated_at = ? WHERE player_id = ?', state.happiness, state.energy, state.hunger, current, playerId);
    return { ...state, updatedAt: current, mood: state.hunger > 75 ? 'hungry' : state.energy < 25 ? 'tired' : state.happiness < 30 ? 'lonely' : 'happy' };
  };
  const changePet = (playerId, delta) => {
    const current = pet(playerId);
    const state = { happiness: clamp(current.happiness + (delta.happiness ?? 0)), energy: clamp(current.energy + (delta.energy ?? 0)), hunger: clamp(current.hunger + (delta.hunger ?? 0)) };
    run('UPDATE pets SET happiness = ?, energy = ?, hunger = ? WHERE player_id = ?', state.happiness, state.energy, state.hunger, playerId);
    return { ...state, updatedAt: current.updatedAt, mood: state.hunger > 75 ? 'hungry' : state.energy < 25 ? 'tired' : state.happiness < 30 ? 'lonely' : 'happy' };
  };

  return {
    close: () => db.close(),
    authenticate(token) {
      if (!/^[a-f0-9]{64}$/.test(token ?? '')) return null;
      const row = get('SELECT player_id FROM sessions WHERE token_hash = ?', hash(token));
      return row ? player(row.player_id) : null;
    },
    createPlayer(name) {
      if (typeof name !== 'string' || !/^[\p{L}\p{N} _-]{2,24}$/u.test(name.trim())) fail(400, 'Name must be 2–24 letters, numbers, spaces, underscores or hyphens.');
      const playerId = id(); const token = randomBytes(32).toString('hex'); const createdAt = now();
      db.transaction(() => {
        run('INSERT INTO players VALUES (?, ?, ?)', playerId, name.trim(), createdAt);
        run('INSERT INTO sessions VALUES (?, ?, ?)', hash(token), playerId, createdAt);
        run('INSERT INTO pets VALUES (?, 70, 80, 20, ?)', playerId, createdAt);
        run('INSERT INTO rewards (player_id) VALUES (?)', playerId);
      })();
      return { player: player(playerId), token };
    },
    getProfile(playerId) {
      return { player: player(playerId), pet: db.transaction(() => pet(playerId))(), rewards: get('SELECT xp, coins, interactions FROM rewards WHERE player_id = ?', playerId) };
    },
    createRoom(playerId) {
      return db.transaction(() => {
        const roomId = id(); const createdAt = now(); const inviteCode = code();
        run('INSERT INTO rooms VALUES (?, ?, ?, ?)', roomId, inviteCode, playerId, createdAt);
        run('INSERT INTO memberships VALUES (?, ?, ?)', roomId, playerId, createdAt);
        return { roomId, inviteCode, ownerId: playerId, createdAt };
      })();
    },
    linkPlayRoom(playerId, roomCode) {
      if (typeof roomCode !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode)) fail(400, 'Invalid playground room code.');
      return db.transaction(() => {
        let room = get('SELECT id FROM rooms WHERE code = ?', roomCode);
        if (!room) {
          const roomId = id();
          run('INSERT INTO rooms VALUES (?, ?, ?, ?)', roomId, roomCode, playerId, now());
          room = { id: roomId };
        }
        if (!member(room.id, playerId)) run('INSERT INTO memberships VALUES (?, ?, ?)', room.id, playerId, now());
        return room.id;
      })();
    },
    joinRoom(playerId, inviteCode) {
      if (typeof inviteCode !== 'string' || !/^[a-fA-F0-9]{10}$/.test(inviteCode)) fail(400, 'Invite code must be 10 hexadecimal characters.');
      return db.transaction(() => {
        const room = get('SELECT id, code, owner_id AS ownerId, created_at AS createdAt FROM rooms WHERE code = ?', inviteCode.toUpperCase());
        if (!room) fail(404, 'Invite code not found.');
        let joinedEvent;
        if (!member(room.id, playerId)) {
          run('INSERT INTO memberships VALUES (?, ?, ?)', room.id, playerId, now());
          joinedEvent = event(room.id, 'player_joined', playerId, { player: player(playerId) });
        }
        return { roomId: room.id, inviteCode: room.code, ownerId: room.ownerId, createdAt: room.createdAt, event: joinedEvent };
      })();
    },
    listRooms(playerId) {
      return all('SELECT r.id AS roomId, r.code AS inviteCode, r.owner_id AS ownerId, r.created_at AS createdAt FROM rooms r JOIN memberships m ON m.room_id = r.id WHERE m.player_id = ? ORDER BY m.joined_at DESC', playerId);
    },
    getRoom(roomId, playerId) {
      requireMember(roomId, playerId);
      const room = get('SELECT id AS roomId, code AS inviteCode, owner_id AS ownerId, created_at AS createdAt FROM rooms WHERE id = ?', roomId);
      return { ...room, players: all('SELECT p.id, p.name FROM memberships m JOIN players p ON p.id = m.player_id WHERE m.room_id = ? ORDER BY m.joined_at', roomId) };
    },
    listEvents(roomId, playerId, after = 0) {
      requireMember(roomId, playerId);
      return all('SELECT id, room_id AS roomId, type, actor_id AS actorId, payload, created_at AS createdAt FROM events WHERE room_id = ? AND id > ? ORDER BY id LIMIT 100', roomId, after).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
    },
    interact(roomId, actorId, targetId, kind, requestId) {
      if (!['greet', 'play', 'gift'].includes(kind)) fail(400, 'Interaction must be greet, play, or gift.');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) fail(400, 'requestId must be 8–100 URL-safe characters.');
      if (actorId === targetId) fail(400, 'Choose another player.');
      return db.transaction(() => {
        requireMember(roomId, actorId); requireMember(roomId, targetId);
        const prior = get('SELECT * FROM interactions WHERE id = ?', requestId);
        if (prior) {
          if (prior.actor_id !== actorId || prior.room_id !== roomId || prior.target_id !== targetId || prior.kind !== kind) fail(409, 'requestId was already used for a different interaction.');
          return { duplicate: true, profile: this.getProfile(actorId) };
        }
        const latest = get('SELECT created_at FROM interactions WHERE actor_id = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1', actorId, targetId);
        if (latest && now() - latest.created_at < 30_000) fail(429, 'Wait 30 seconds before interacting with this player again.');
        const since = now() - DAY;
        const daily = get('SELECT COUNT(*) AS count FROM interactions WHERE actor_id = ? AND created_at >= ?', actorId, since).count;
        if (daily >= 20) fail(429, 'Daily rewarded interaction limit reached.');
        const uniqueToday = !get('SELECT 1 FROM interactions WHERE actor_id = ? AND target_id = ? AND created_at >= ?', actorId, targetId, since);
        const xp = kind === 'gift' ? 8 : kind === 'play' ? 6 : 4;
        const bonus = uniqueToday ? 5 : 0;
        run('INSERT INTO interactions VALUES (?, ?, ?, ?, ?, ?)', requestId, roomId, actorId, targetId, kind, now());
        run('UPDATE rewards SET xp = xp + ?, coins = coins + ?, interactions = interactions + 1 WHERE player_id = ?', xp + bonus, kind === 'gift' ? 1 : 2, actorId);
        run('UPDATE rewards SET xp = xp + 2 WHERE player_id = ?', targetId);
        const [a, b] = [actorId, targetId].sort();
        run('INSERT INTO friendships VALUES (?, ?, 1) ON CONFLICT(player_a, player_b) DO UPDATE SET count = count + 1', a, b);
        const actorPet = changePet(actorId, { happiness: 8, energy: kind === 'play' ? -5 : -1, hunger: kind === 'gift' ? -5 : 0 });
        const targetPet = changePet(targetId, { happiness: 4 });
        const roomEvent = event(roomId, 'interaction', actorId, { targetId, kind, xp: xp + bonus });
        return { duplicate: false, xpEarned: xp + bonus, actorPet, targetPet, profile: this.getProfile(actorId), event: roomEvent };
      })();
    },
    care(playerId, action) {
      const changes = { pet: { happiness: 5, energy: -1 }, feed: { hunger: -25, happiness: 3 }, play: { happiness: 10, energy: -12, hunger: 5 }, rest: { energy: 25, happiness: -1 } };
      if (!Object.hasOwn(changes, action)) fail(400, 'Action must be pet, feed, play, or rest.');
      return db.transaction(() => ({ pet: changePet(playerId, changes[action]), rewards: get('SELECT xp, coins, interactions FROM rewards WHERE player_id = ?', playerId) }))();
    },
    friendships(playerId) {
      return all('SELECT CASE WHEN f.player_a = ? THEN f.player_b ELSE f.player_a END AS playerId, p.name, f.count FROM friendships f JOIN players p ON p.id = CASE WHEN f.player_a = ? THEN f.player_b ELSE f.player_a END WHERE f.player_a = ? OR f.player_b = ? ORDER BY f.count DESC, p.name LIMIT 50', playerId, playerId, playerId, playerId);
    },
  };
}
