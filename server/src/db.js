// Storage layer. Uses Postgres when DATABASE_URL is set; otherwise falls back
// to in-memory arrays so the hello-world deploy boots without a database.
// The fallback is deliberately tiny — Sprint 1 hardens this against Postgres.
import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS briefings (
  id          SERIAL PRIMARY KEY,
  sprint_id   TEXT,
  goal        TEXT,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS minutes (
  id          SERIAL PRIMARY KEY,
  briefing_id INTEGER REFERENCES briefings(id),
  outcome     TEXT,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sprints queued by a resolved meeting, drained by the local poller.
CREATE TABLE IF NOT EXISTS sprint_queue (
  id          SERIAL PRIMARY KEY,
  goal        TEXT NOT NULL,
  minutes     TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let pool = null;
const mem = { briefings: [], minutes: [], queue: [], seq: { b: 0, m: 0, q: 0 } };

export const usingPostgres = () => pool !== null;

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[db] DATABASE_URL unset — using in-memory store (data not persisted)');
    return;
  }
  pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await pool.query(SCHEMA);
  console.log('[db] Postgres connected and schema ensured');
}

export async function insertBriefing({ sprintId, goal, payload }) {
  if (pool) {
    const { rows } = await pool.query(
      'INSERT INTO briefings (sprint_id, goal, payload) VALUES ($1, $2, $3) RETURNING id',
      [sprintId ?? null, goal ?? null, payload]
    );
    return rows[0].id;
  }
  const id = ++mem.seq.b;
  mem.briefings.push({ id, sprintId, goal, payload, created_at: nowIso() });
  return id;
}

export async function listBriefings() {
  if (pool) {
    const { rows } = await pool.query(
      'SELECT id, sprint_id, goal, created_at FROM briefings ORDER BY id DESC LIMIT 50'
    );
    return rows;
  }
  return mem.briefings
    .map((b) => ({ id: b.id, sprint_id: b.sprintId, goal: b.goal, created_at: b.created_at }))
    .reverse();
}

export async function getBriefing(id) {
  if (pool) {
    const { rows } = await pool.query('SELECT * FROM briefings WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
  return mem.briefings.find((b) => b.id === Number(id)) ?? null;
}

function nowIso() {
  // Note: agents/scripts must avoid relying on client clocks for ordering;
  // the server stamps created_at. This helper is only for the memory fallback.
  return new Date().toISOString();
}
