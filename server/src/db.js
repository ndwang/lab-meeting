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

-- Live Q&A channel. The browser posts a pending question; the host agent
-- (attendant daemon) claims it, answers grounded in the briefing, and posts
-- the answer back; the browser polls for it.
CREATE TABLE IF NOT EXISTS qa (
  id          SERIAL PRIMARY KEY,
  briefing_id INTEGER REFERENCES briefings(id),
  question    TEXT NOT NULL,
  answer      TEXT,
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

// Insert a browser-posted follow-up question as a pending Q&A row. Returns the
// new row id. created_at is server-stamped.
export async function insertQuestion({ briefingId, question }) {
  const { rows } = await pool.query(
    "INSERT INTO qa (briefing_id, question, status) VALUES ($1, $2, 'pending') RETURNING id",
    [briefingId, question]
  );
  return rows[0].id;
}

// Atomically claim the oldest pending question, marking it 'claimed' so the
// host agent picks up each question exactly once even under concurrent pollers.
// Returns { id, briefingId, question } or null when none are pending.
export async function claimPendingQuestion() {
  const { rows } = await pool.query(
    `UPDATE qa
        SET status = 'claimed'
      WHERE id = (
        SELECT id FROM qa
         WHERE status = 'pending'
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, briefing_id, question`
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, briefingId: row.briefing_id, question: row.question };
}

// Record the host agent's answer and mark the question answered. Returns true
// if a row was updated, false if the id did not match any row.
export async function answerQuestion({ id, answer }) {
  const { rowCount } = await pool.query(
    "UPDATE qa SET answer = $2, status = 'answered' WHERE id = $1",
    [id, answer]
  );
  return rowCount > 0;
}

// Fetch the full Q&A thread for a briefing, oldest-first.
export async function listQAForBriefing(briefingId) {
  const { rows } = await pool.query(
    'SELECT id, question, answer, status, created_at FROM qa WHERE briefing_id = $1 ORDER BY id ASC',
    [briefingId]
  );
  return rows;
}
