// Storage layer (Postgres). Requires DATABASE_URL — fails fast if unset.
import pg from 'pg';
import { requireEnv } from './env.js';

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

let pool;

export async function initDb() {
  const url = requireEnv('DATABASE_URL');
  pool = new pg.Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await pool.query(SCHEMA);
}

export async function insertBriefing({ sprintId, goal, payload }) {
  const { rows } = await pool.query(
    'INSERT INTO briefings (sprint_id, goal, payload) VALUES ($1, $2, $3) RETURNING id',
    [sprintId ?? null, goal ?? null, payload]
  );
  return rows[0].id;
}

export async function listBriefings() {
  const { rows } = await pool.query(
    'SELECT id, sprint_id, goal, created_at FROM briefings ORDER BY id DESC LIMIT 50'
  );
  return rows;
}

export async function getBriefing(id) {
  const { rows } = await pool.query('SELECT * FROM briefings WHERE id = $1', [id]);
  return rows[0] ?? null;
}

// Atomically claim the oldest pending sprint_queue row, marking it consumed so
// it drains exactly once. FOR UPDATE SKIP LOCKED keeps concurrent pollers from
// claiming the same row. Returns { goal, minutes } or null when none pending.
export async function claimNextSprint() {
  const { rows } = await pool.query(
    `UPDATE sprint_queue
     SET    status = 'consumed'
     WHERE  id = (
              SELECT id FROM sprint_queue
              WHERE  status = 'pending'
              ORDER  BY id ASC
              LIMIT  1
              FOR UPDATE SKIP LOCKED
            )
     RETURNING goal, minutes`
  );
  return rows[0] ?? null;
}
