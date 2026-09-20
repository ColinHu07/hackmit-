import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';

const HOUR = 3_600_000;
import { eatenFraction, FEED_DURATION_MS, TREAT_COOLDOWN_MS } from '../shared/feeding.mjs';
const clamp = value => Math.max(0, Math.min(100, value));
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const invalid = message => { const error = new Error(message); error.code = 'invalid_pet_state'; return error; };

/** Durable survival score and food inventory. The room token is the credential for this prototype. */
export function createPetStore(filename = process.env.BONDIMALS_DB_PATH || '.bondimals-data/game.sqlite', now = () => Date.now()) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS pets (
      token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
      health REAL NOT NULL DEFAULT 100, hunger REAL NOT NULL DEFAULT 78, happiness REAL NOT NULL DEFAULT 70,
      survival_hours INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
      , last_feed_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS food_inventory (
      token_hash TEXT NOT NULL REFERENCES pets(token_hash) ON DELETE CASCADE,
      food TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0), PRIMARY KEY(token_hash, food)
    );
    CREATE TABLE IF NOT EXISTS point_events (
      event_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL REFERENCES pets(token_hash), points INTEGER NOT NULL,
      reason TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS point_events_player ON point_events(token_hash, created_at);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', 'last_feed_at')) db.exec('ALTER TABLE pets ADD COLUMN last_feed_at INTEGER NOT NULL DEFAULT 0');
  for (const column of ['feed_happiness', 'feed_happiness_applied']) {
    if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', column)) db.exec(`ALTER TABLE pets ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
  }
  const foodTypes = ['berry', 'kibble', 'treat'];
  function advance(token) {
    const hash = tokenHash(token);
    let row = get('SELECT * FROM pets WHERE token_hash = ?', hash);
    if (!row) return null;
    const current = now();
    // Settle only newly eaten fractions. Persisting the applied amount makes
    // repeated snapshots, reconnects, and restarts unable to duplicate a bite.
    if (row.feed_happiness > row.feed_happiness_applied) {
      const earned = row.feed_happiness * eatenFraction((current - row.last_feed_at) / FEED_DURATION_MS);
      const gain = Math.max(0, earned - row.feed_happiness_applied);
      if (gain > 0) {
        run('UPDATE pets SET happiness = MIN(100, happiness + ?), feed_happiness_applied = ? WHERE token_hash = ?', gain, earned, hash);
        row = get('SELECT * FROM pets WHERE token_hash = ?', hash);
      }
    }
    const elapsedHours = Math.max(0, current - row.updated_at) / HOUR;
    const wholeHours = Math.floor(elapsedHours);
    if (wholeHours < 1) return row;
    const hunger = clamp(row.hunger - 8 * elapsedHours);
    const health = clamp(row.health - (hunger <= 0 ? 12 * elapsedHours : 0));
    const happiness = clamp(row.happiness - 3 * elapsedHours);
    const earned = health > 0 ? wholeHours : 0;
    const next = current;
    run('UPDATE pets SET points = points + ?, health = ?, hunger = ?, happiness = ?, survival_hours = survival_hours + ?, updated_at = ? WHERE token_hash = ?', earned, health, hunger, happiness, wholeHours, next, hash);
    if (earned) run('INSERT INTO point_events VALUES (?, ?, ?, ?, ?)', randomUUID(), hash, earned, 'survival_hour', current);
    return get('SELECT * FROM pets WHERE token_hash = ?', hash);
  }
  function profile(token) {
    const row = advance(token);
    if (!row) return null;
    const inventory = Object.fromEntries(foodTypes.map(food => [food, get('SELECT quantity FROM food_inventory WHERE token_hash = ? AND food = ?', row.token_hash, food)?.quantity ?? 0]));
    return { points: row.points, health: Math.round(row.health), hunger: Math.round(row.hunger), happiness: Math.round(row.happiness * 100) / 100, survivalHours: row.survival_hours, inventory, treatCooldownMs: Math.max(0, TREAT_COOLDOWN_MS - (now() - row.last_feed_at)), updatedAt: row.updated_at };
  }
  function ensure(token, name) {
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw invalid('Invalid pet credential.');
    const hash = tokenHash(token);
    const existing = get('SELECT token_hash FROM pets WHERE token_hash = ?', hash);
    if (!existing) {
      const timestamp = now();
      db.transaction(() => {
        run('INSERT INTO pets (token_hash, name, updated_at) VALUES (?, ?, ?)', hash, String(name).slice(0, 24), timestamp);
        run('INSERT INTO food_inventory VALUES (?, ?, ?)', hash, 'berry', 3);
        run('INSERT INTO food_inventory VALUES (?, ?, ?)', hash, 'kibble', 2);
        run('INSERT INTO food_inventory VALUES (?, ?, ?)', hash, 'treat', 1);
      })();
    } else run('UPDATE pets SET name = ? WHERE token_hash = ?', String(name).slice(0, 24), hash);
    return profile(token);
  }
  function award(token, eventId, points, reason) {
    const hash = tokenHash(token);
    advance(token);
    return db.transaction(() => {
      const prior = get('SELECT points FROM point_events WHERE event_id = ?', eventId);
      if (prior) return false;
      run('INSERT INTO point_events VALUES (?, ?, ?, ?, ?)', eventId, hash, points, reason, now());
      run('UPDATE pets SET points = points + ? WHERE token_hash = ?', points, hash);
      return true;
    })();
  }
  function feed(token, food = 'berry') {
    if (!foodTypes.includes(food)) throw invalid('Food must be berry, kibble, or treat.');
    const hash = tokenHash(token);
    if (!advance(token)) throw invalid('Pet profile not found.');
    return db.transaction(() => {
      const cooldown = get('SELECT last_feed_at FROM pets WHERE token_hash = ?', hash);
      const remaining = TREAT_COOLDOWN_MS - (now() - cooldown.last_feed_at);
      if (remaining > 0) { const error = new Error(`Treat is cooling down for ${Math.ceil(remaining / 1000)} seconds.`); error.code = 'treat_cooldown'; error.retryAfterMs = remaining; throw error; }
      const item = get('SELECT quantity FROM food_inventory WHERE token_hash = ? AND food = ?', hash, food);
      if (!item || item.quantity < 1) { const error = new Error(`No ${food} left.`); error.code = 'food_empty'; throw error; }
      const effects = { berry: { hunger: 18, happiness: 2, health: 1, points: 4 }, kibble: { hunger: 30, happiness: 4, health: 3, points: 7 }, treat: { hunger: 10, happiness: 10, health: 5, points: 10 } }[food];
      run('UPDATE food_inventory SET quantity = quantity - 1 WHERE token_hash = ? AND food = ?', hash, food);
      const current = get('SELECT health, hunger, happiness FROM pets WHERE token_hash = ?', hash);
      run('UPDATE pets SET health = ?, hunger = ?, feed_happiness = ?, feed_happiness_applied = 0, points = points + ?, last_feed_at = ? WHERE token_hash = ?', clamp(current.health + effects.health), clamp(current.hunger + effects.hunger), Math.min(effects.happiness, 100 - current.happiness), effects.points, now(), hash);
      run('INSERT INTO point_events VALUES (?, ?, ?, ?, ?)', randomUUID(), hash, effects.points, `feed_${food}`, now());
      return profile(token);
    })();
  }
  return { profile, ensure, award, feed, close: () => db.close() };
}
