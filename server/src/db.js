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

// Persist a resolved meeting's decision. The full request body (outcome,
// directive, answers) is stored as the payload for grounding/audit.
export async function insertMinutes({ briefingId, outcome, payload }) {
  const { rows } = await pool.query(
    'INSERT INTO minutes (briefing_id, outcome, payload) VALUES ($1, $2, $3) RETURNING id',
    [briefingId, outcome, payload]
  );
  return rows[0].id;
}

// Enqueue the next sprint. goal is the human's directive; minutes is the
// rendered meeting summary that becomes the next sprint's standing direction.
export async function enqueueSprint({ goal, minutes }) {
  const { rows } = await pool.query(
    'INSERT INTO sprint_queue (goal, minutes) VALUES ($1, $2) RETURNING id',
    [goal, minutes]
  );
  return rows[0].id;
}

// Atomically claim the oldest pending sprint, marking it consumed so it is
// drained exactly once even under concurrent pollers. Returns null when empty.
export async function claimNextSprint() {
  const { rows } = await pool.query(
    `UPDATE sprint_queue
        SET status = 'consumed'
      WHERE id = (
        SELECT id FROM sprint_queue
         WHERE status = 'pending'
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING goal, minutes`
  );
  return rows[0] ?? null;
}
