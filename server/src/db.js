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

-- A resolved meeting decision and where its handoff stands. The status machine
-- runs resolved -> composing -> composed -> approved: the human resolves the
-- decision slide, the host agent composes a crisp next instruction, the human
-- approves it, and only then is a sprint enqueued.
CREATE TABLE IF NOT EXISTS minutes (
  id               SERIAL PRIMARY KEY,
  briefing_id      INTEGER REFERENCES briefings(id),
  outcome          TEXT,
  directive        TEXT,
  answers          JSONB,
  composed_goal    TEXT,
  composed_minutes TEXT,
  status           TEXT NOT NULL DEFAULT 'resolved',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The deployed DB already has a minutes table (id, briefing_id, outcome,
-- payload, created_at). These idempotent ALTERs bring an existing table
-- forward; the legacy payload column is abandoned and dropped (its NOT NULL
-- constraint would otherwise break the new insert path). DROP is a no-op on a
-- fresh DB, where payload was never created.
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS directive TEXT;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS answers JSONB;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS composed_goal TEXT;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS composed_minutes TEXT;
ALTER TABLE minutes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'resolved';
ALTER TABLE minutes DROP COLUMN IF EXISTS payload;

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

// Persist a resolved meeting's decision into dedicated columns. The row starts
// in 'resolved' status — the head of the compose/approve handoff machine. The
// host agent later claims it (claimPendingCompose), composes the next
// instruction (setComposed), and the human approves it (approveMinutes).
export async function insertMinutes({ briefingId, outcome, directive, answers }) {
  const { rows } = await pool.query(
    `INSERT INTO minutes (briefing_id, outcome, directive, answers, status)
     VALUES ($1, $2, $3, $4, 'resolved')
     RETURNING id`,
    [briefingId, outcome, directive, JSON.stringify(answers ?? [])]
  );
  return rows[0].id;
}

// Atomically claim the oldest 'resolved' minutes row for the host agent to
// compose, marking it 'composing' so it is handed off exactly once even under
// concurrent daemons. Returns { minutesId, briefingId, outcome, directive,
// answers } or null when none are pending.
export async function claimPendingCompose() {
  const { rows } = await pool.query(
    `UPDATE minutes
        SET status = 'composing'
      WHERE id = (
        SELECT id FROM minutes
         WHERE status = 'resolved'
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING id, briefing_id, outcome, directive, answers`
  );
  const row = rows[0];
  if (!row) return null;
  return {
    minutesId: row.id,
    briefingId: row.briefing_id,
    outcome: row.outcome,
    directive: row.directive,
    answers: row.answers ?? [],
  };
}

// Store the host agent's composed next instruction on a minutes row and move it
// to 'composed'. Returns true if a row was updated, false if the id is unknown.
export async function setComposed({ id, composedGoal, composedMinutes }) {
  const { rowCount } = await pool.query(
    `UPDATE minutes
        SET composed_goal = $2, composed_minutes = $3, status = 'composed'
      WHERE id = $1`,
    [id, composedGoal, composedMinutes]
  );
  return rowCount > 0;
}

// Fetch all minutes rows for a briefing, oldest-first, so the browser can poll
// for the composed instruction. camelCase keys for the client.
export async function getMinutesForBriefing(briefingId) {
  const { rows } = await pool.query(
    `SELECT id, status, outcome, directive, composed_goal, composed_minutes, created_at
       FROM minutes
      WHERE briefing_id = $1
      ORDER BY id ASC`,
    [briefingId]
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    outcome: r.outcome,
    directive: r.directive,
    composedGoal: r.composed_goal,
    composedMinutes: r.composed_minutes,
    created_at: r.created_at,
  }));
}

// Approve a composed minutes row: enqueue the next sprint and mark the row
// 'approved', atomically in one transaction. The provided goal overrides the
// composed_goal if given. Throws "not found" for an unknown id and "not
// composed" if the row is not in 'composed' status, so the routes layer can
// discriminate 404 vs 409. Returns the new sprint_queue id.
export async function approveMinutes({ id, goal }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT status, composed_goal, composed_minutes
         FROM minutes
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`minutes row id=${id} not found`);
    }
    if (row.status !== 'composed') {
      throw new Error(`minutes row id=${id} is not composed`);
    }
    const finalGoal = goal != null ? goal : row.composed_goal;
    const { rows: queued } = await client.query(
      'INSERT INTO sprint_queue (goal, minutes) VALUES ($1, $2) RETURNING id',
      [finalGoal, row.composed_minutes]
    );
    await client.query(
      "UPDATE minutes SET status = 'approved' WHERE id = $1",
      [id]
    );
    await client.query('COMMIT');
    return queued[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
