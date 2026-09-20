import Database from 'better-sqlite3';
import { QUEST_COOLDOWN_MS, QUEST_REWARD, REWARD_QUEST_IDS } from '../shared/quest-rewards.mjs';
import { createHash, randomUUID } from 'node:crypto';

const HOUR = 3_600_000;
import { eatenFraction, FEED_DURATION_MS, TREAT_COOLDOWN_MS, HAPPINESS_DECAY_MS, TREAT_DECAY_MULTIPLIER, BERRY_HAPPINESS } from '../shared/feeding.mjs';
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
    CREATE TABLE IF NOT EXISTS quest_rewards (
      token_hash TEXT NOT NULL REFERENCES pets(token_hash), quest_id TEXT NOT NULL,
      event_id TEXT NOT NULL, completed_at INTEGER NOT NULL, happiness REAL NOT NULL,
      PRIMARY KEY(token_hash, quest_id)
    );
    CREATE TABLE IF NOT EXISTS quest_cooldown_overrides (
      token_hash TEXT NOT NULL REFERENCES pets(token_hash), quest_id TEXT NOT NULL,
      ready_at INTEGER NOT NULL, PRIMARY KEY(token_hash, quest_id)
    );
    CREATE INDEX IF NOT EXISTS point_events_player ON point_events(token_hash, created_at);
  `);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', 'last_feed_at')) db.exec('ALTER TABLE pets ADD COLUMN last_feed_at INTEGER NOT NULL DEFAULT 0');
  for (const column of ['feed_happiness', 'feed_happiness_applied']) {
    if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', column)) db.exec(`ALTER TABLE pets ADD COLUMN ${column} REAL NOT NULL DEFAULT 0`);
  }
  // Start the new minute-based clock at migration time; do not retroactively
  // charge existing pets for time spent under the old hourly rules.
  if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', 'happiness_updated_at')) {
    db.exec('ALTER TABLE pets ADD COLUMN happiness_updated_at INTEGER NOT NULL DEFAULT 0');
    run('UPDATE pets SET happiness_updated_at = ?', now());
  }
  if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', 'happiness_decay_progress')) {
    db.exec('ALTER TABLE pets ADD COLUMN happiness_decay_progress REAL NOT NULL DEFAULT 0');
  }
  if (!get('SELECT 1 FROM pragma_table_info(?) WHERE name = ?', 'pets', 'treat_ready_at')) {
    db.exec('ALTER TABLE pets ADD COLUMN treat_ready_at INTEGER NOT NULL DEFAULT 0');
    run('UPDATE pets SET treat_ready_at = last_feed_at + ? WHERE last_feed_at > 0', TREAT_COOLDOWN_MS);
  }
  const foodTypes = ['berry', 'kibble', 'treat'];
  function advance(token, settleDecay = false) {
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
    const elapsed = Math.max(0, current - row.happiness_updated_at);
    const boosted = row.treat_ready_at > 0 ? Math.max(0,
      Math.min(current, row.treat_ready_at) - Math.max(row.happiness_updated_at, row.last_feed_at)) : 0;
    const progress = row.happiness_decay_progress
      + (elapsed - boosted + boosted / TREAT_DECAY_MULTIPLIER) / HAPPINESS_DECAY_MS;
    const lost = Math.floor(progress + 1e-9);
    // Keep fractional minutes across requests/restarts, without writing on
    // every multiplayer frame. Feeding settles the clock before a new boost.
    if (lost > 0 || settleDecay) {
      run('UPDATE pets SET happiness = MAX(0, happiness - ?), happiness_updated_at = ?, happiness_decay_progress = ? WHERE token_hash = ?',
        lost, Math.max(current, row.happiness_updated_at), Math.max(0, progress - lost), hash);
      row = get('SELECT * FROM pets WHERE token_hash = ?', hash);
    }
    const elapsedHours = Math.max(0, current - row.updated_at) / HOUR;
    const wholeHours = Math.floor(elapsedHours);
    if (wholeHours < 1) return row;
    const hunger = clamp(row.hunger - 8 * elapsedHours);
    const health = clamp(row.health - (hunger <= 0 ? 12 * elapsedHours : 0));
    const happiness = row.happiness;
    const earned = health > 0 ? wholeHours : 0;
    const next = current;
    run('UPDATE pets SET points = points + ?, health = ?, hunger = ?, happiness = ?, survival_hours = survival_hours + ?, updated_at = ? WHERE token_hash = ?', earned, health, hunger, happiness, wholeHours, next, hash);
    if (earned) run('INSERT INTO point_events VALUES (?, ?, ?, ?, ?)', randomUUID(), hash, earned, 'survival_hour', current);
    return get('SELECT * FROM pets WHERE token_hash = ?', hash);
  }
  function questCooldown(token, questId) {
    const override = get('SELECT ready_at FROM quest_cooldown_overrides WHERE token_hash = ? AND quest_id = ?', tokenHash(token), questId);
    if (override) return Math.max(0, override.ready_at - now());
    const row = get('SELECT completed_at FROM quest_rewards WHERE token_hash = ? AND quest_id = ?', tokenHash(token), questId);
    return row ? Math.max(0, row.completed_at + QUEST_COOLDOWN_MS - now()) : 0;
  }
  function completeQuest(tokens, questId) {
    if (!REWARD_QUEST_IDS.includes(questId) || !tokens.length || new Set(tokens).size !== tokens.length) throw invalid('Invalid quest reward group.');
    return db.transaction(() => {
      // The entire group either receives rewards or receives nothing.
      for (const token of tokens) {
        if (!get('SELECT 1 FROM pets WHERE token_hash = ?', tokenHash(token))) throw invalid('Pet profile not found.');
        const remaining = questCooldown(token, questId);
        if (remaining > 0) {
          const error = new Error(`Quest ready again in ${Math.ceil(remaining / 1000)}s.`);
          error.code = 'quest_cooldown'; error.retryAfterMs = remaining; throw error;
        }
      }
      const completedAt = now();
      return tokens.map(token => {
        const row = advance(token, true);
        const happiness = Math.min(QUEST_REWARD.happiness, 100 - row.happiness);
        run('DELETE FROM quest_cooldown_overrides WHERE token_hash = ? AND quest_id = ?', row.token_hash, questId);
        const eventId = randomUUID();
        run('UPDATE pets SET happiness = MIN(100, happiness + ?), points = points + ? WHERE token_hash = ?', happiness, QUEST_REWARD.points, row.token_hash);
        run('INSERT INTO food_inventory (token_hash, food, quantity) VALUES (?, ?, ?) ON CONFLICT(token_hash, food) DO UPDATE SET quantity = quantity + excluded.quantity', row.token_hash, 'berry', QUEST_REWARD.berries);
        run('INSERT INTO point_events VALUES (?, ?, ?, ?, ?)', eventId, row.token_hash, QUEST_REWARD.points, `quest_${questId}`, completedAt);
        run('INSERT INTO quest_rewards VALUES (?, ?, ?, ?, ?) ON CONFLICT(token_hash, quest_id) DO UPDATE SET event_id = excluded.event_id, completed_at = excluded.completed_at, happiness = excluded.happiness', row.token_hash, questId, eventId, completedAt, happiness);
        return { eventId, questId, completedAt, happiness, berries: QUEST_REWARD.berries, points: QUEST_REWARD.points };
      });
    })();
  }
  function profile(token) {
    const row = advance(token);
    if (!row) return null;
    const inventory = Object.fromEntries(foodTypes.map(food => [food, get('SELECT quantity FROM food_inventory WHERE token_hash = ? AND food = ?', row.token_hash, food)?.quantity ?? 0]));
    const rewards = db.prepare('SELECT * FROM quest_rewards WHERE token_hash = ? ORDER BY completed_at DESC, rowid DESC').all(row.token_hash);
    const questCooldowns = Object.fromEntries(REWARD_QUEST_IDS.map(id => [id, questCooldown(token, id)]));
    const latest = rewards[0];
    const lastQuestReward = latest ? { eventId: latest.event_id, questId: latest.quest_id, completedAt: latest.completed_at,
      happiness: latest.happiness, berries: QUEST_REWARD.berries, points: QUEST_REWARD.points } : null;
    return { questCooldowns, lastQuestReward, points: row.points, health: Math.round(row.health), hunger: Math.round(row.hunger), happiness: Math.round(row.happiness * 100) / 100, survivalHours: row.survival_hours, inventory, treatCooldownMs: Math.max(0, row.treat_ready_at - now()), updatedAt: row.updated_at };
  }
  function ensure(token, name) {
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw invalid('Invalid pet credential.');
    const hash = tokenHash(token);
    const existing = get('SELECT token_hash FROM pets WHERE token_hash = ?', hash);
    if (!existing) {
      const timestamp = now();
      db.transaction(() => {
        run('INSERT INTO pets (token_hash, name, updated_at, happiness_updated_at) VALUES (?, ?, ?, ?)', hash, String(name).slice(0, 24), timestamp, timestamp);
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
    if (!advance(token, true)) throw invalid('Pet profile not found.');
    return db.transaction(() => {
      const cooldown = get('SELECT treat_ready_at FROM pets WHERE token_hash = ?', hash);
      const remaining = Math.max(0, cooldown.treat_ready_at - now());
      if (remaining > 0) { const error = new Error(`Treat is cooling down for ${Math.ceil(remaining / 60_000)} minutes.`); error.code = 'treat_cooldown'; error.retryAfterMs = remaining; throw error; }
      const item = get('SELECT quantity FROM food_inventory WHERE token_hash = ? AND food = ?', hash, food);
      if (!item || item.quantity < 1) { const error = new Error(`No ${food} left.`); error.code = 'food_empty'; throw error; }
      const effects = { berry: { hunger: 18, happiness: BERRY_HAPPINESS, health: 1, points: 4 }, kibble: { hunger: 30, happiness: 4, health: 3, points: 7 }, treat: { hunger: 10, happiness: 10, health: 5, points: 10 } }[food];
      run('UPDATE food_inventory SET quantity = quantity - 1 WHERE token_hash = ? AND food = ?', hash, food);
      const current = get('SELECT health, hunger, happiness FROM pets WHERE token_hash = ?', hash);
      run('UPDATE pets SET health = ?, hunger = ?, feed_happiness = ?, feed_happiness_applied = 0, points = points + ?, last_feed_at = ?, treat_ready_at = ? WHERE token_hash = ?', clamp(current.health + effects.health), clamp(current.hunger + effects.hunger), Math.min(effects.happiness, 100 - current.happiness), effects.points, now(), now() + TREAT_COOLDOWN_MS, hash);
      run('INSERT INTO point_events VALUES (?, ?, ?, ?, ?)', randomUUID(), hash, effects.points, `feed_${food}`, now());
      return profile(token);
    })();
  }
  function adminUpdate(token, changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw invalid('Choose a value to change.');
    const ranges = { berries: 999, happiness: 100, treatCooldownMs: TREAT_COOLDOWN_MS, questCooldownMs: 86_400_000 };
    for (const [key, value] of Object.entries(changes)) {
      if (!Object.hasOwn(ranges, key) || !Number.isInteger(value) || value < 0 || value > ranges[key]) throw invalid('Invalid admin value.');
    }
    return db.transaction(() => {
      const row = advance(token, true);
      if (!row) throw invalid('Pet profile not found.');
      if (changes.berries !== undefined) run('UPDATE food_inventory SET quantity = ? WHERE token_hash = ? AND food = ?', changes.berries, row.token_hash, 'berry');
      if (changes.happiness !== undefined) {
        // An explicit happiness override supersedes any still-pending bite reward.
        run('UPDATE pets SET happiness = ?, happiness_updated_at = ?, happiness_decay_progress = 0, feed_happiness = 0, feed_happiness_applied = 0 WHERE token_hash = ?', changes.happiness, now(), row.token_hash);
      }
      if (changes.treatCooldownMs !== undefined) run('UPDATE pets SET treat_ready_at = ? WHERE token_hash = ?', now() + changes.treatCooldownMs, row.token_hash);
      if (changes.questCooldownMs !== undefined) for (const id of REWARD_QUEST_IDS) {
        run('INSERT INTO quest_cooldown_overrides VALUES (?, ?, ?) ON CONFLICT(token_hash, quest_id) DO UPDATE SET ready_at = excluded.ready_at', row.token_hash, id, now() + changes.questCooldownMs);
      }
      return profile(token);
    })();
  }
  return { profile, ensure, award, feed, adminUpdate, questCooldown, completeQuest, close: () => db.close() };
}
