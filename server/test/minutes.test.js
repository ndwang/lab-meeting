// Tests for the minutes status-machine routes and GET /api/next-sprint. Uses
// app.inject() with an injected fake db — no Postgres, no listen. The fake db
// records calls so each route's db contract can be asserted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

// Minimal in-memory db double matching the real module's function shapes.
// Deliberately has NO enqueueSprint: the routes no longer call it directly, and
// its absence ensures a route accidentally calling it would throw.
function fakeDb(overrides = {}) {
  const calls = {
    insertMinutes: [],
    claimPendingCompose: [],
    setComposed: [],
    getMinutesForBriefing: [],
    approveMinutes: [],
    claimNextSprint: [],
  };
  return {
    calls,
    insertMinutes: async (arg) => {
      calls.insertMinutes.push(arg);
      return 11;
    },
    claimPendingCompose: async () => {
      calls.claimPendingCompose.push(true);
      return null;
    },
    setComposed: async (arg) => {
      calls.setComposed.push(arg);
      return true;
    },
    getMinutesForBriefing: async (arg) => {
      calls.getMinutesForBriefing.push(arg);
      return [];
    },
    approveMinutes: async (arg) => {
      calls.approveMinutes.push(arg);
      return 22;
    },
    claimNextSprint: async () => {
      calls.claimNextSprint.push(true);
      return null;
    },
    // Unused by these routes but present so the route table stays intact.
    insertBriefing: async () => 1,
    listBriefings: async () => [],
    getBriefing: async () => null,
    insertQuestion: async () => 1,
    claimPendingQuestion: async () => null,
    answerQuestion: async () => true,
    listQAForBriefing: async () => [],
    ...overrides,
  };
}

// ---- POST /api/minutes (record the human's decision; does NOT enqueue) ----

test('POST /api/minutes does not require a bearer token (browser-facing)', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 5, outcome: 'approve', directive: 'do the thing' },
  });

  assert.equal(res.statusCode, 201);
});

test('POST /api/minutes records a resolved row and does NOT enqueue', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: {
      briefingId: 5,
      outcome: 'redirect',
      directive: 'focus on auth',
      answers: [{ title: 'Q1', answer: 'yes' }],
    },
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(JSON.parse(res.body), { minutesId: 11 });

  // minutes row captures the decision in dedicated fields (no payload wrapper).
  assert.equal(db.calls.insertMinutes.length, 1);
  const m = db.calls.insertMinutes[0];
  assert.equal(m.briefingId, 5);
  assert.equal(m.outcome, 'redirect');
  assert.equal(m.directive, 'focus on auth');
  assert.deepEqual(m.answers, [{ title: 'Q1', answer: 'yes' }]);

  // The route must NOT enqueue here — the fake db has no enqueueSprint at all.
  assert.equal(db.enqueueSprint, undefined);
});

test('POST /api/minutes defaults answers to [] when omitted', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve', directive: 'ship it' },
  });

  assert.deepEqual(db.calls.insertMinutes[0].answers, []);
});

test('POST /api/minutes accepts an empty-string directive on approve', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve', directive: '' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(db.calls.insertMinutes[0].directive, '');
});

test('POST /api/minutes 400s on missing briefingId', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { outcome: 'approve', directive: 'x' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.insertMinutes.length, 0);
});

test('POST /api/minutes 400s on missing directive', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /api/minutes 400s on an invalid outcome', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'maybe', directive: 'x' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.insertMinutes.length, 0);
});

// ---- GET /api/compose/pending (daemon claims a resolved row) ----

test('GET /api/compose/pending requires the bearer token', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/compose/pending' });
  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.claimPendingCompose.length, 0);
});

test('GET /api/compose/pending returns 204 when no resolved rows', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/compose/pending',
    headers: { authorization: 'Bearer secret' },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
  assert.equal(db.calls.claimPendingCompose.length, 1);
});

test('GET /api/compose/pending returns the claimed row', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const claimed = {
    minutesId: 7,
    briefingId: 5,
    outcome: 'redirect',
    directive: 'focus on auth',
    answers: [{ title: 'Q1', answer: 'yes' }],
  };
  const db = fakeDb({ claimPendingCompose: async () => claimed });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/compose/pending',
    headers: { authorization: 'Bearer secret' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), claimed);
});

// ---- POST /api/minutes/:id/instruction (host posts the composed result) ----

test('POST /api/minutes/:id/instruction requires the bearer token', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/7/instruction',
    payload: { goal: 'g', minutesText: 'm' },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.setComposed.length, 0);
});

test('POST /api/minutes/:id/instruction sets composed fields and returns ok', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/7/instruction',
    headers: { authorization: 'Bearer secret' },
    payload: { goal: 'wire the daemon', minutesText: 'decisions and deferrals' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(db.calls.setComposed.length, 1);
  assert.deepEqual(db.calls.setComposed[0], {
    id: '7',
    composedGoal: 'wire the daemon',
    composedMinutes: 'decisions and deferrals',
  });
});

test('POST /api/minutes/:id/instruction 404s when setComposed returns false', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb({ setComposed: async () => false });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/999/instruction',
    headers: { authorization: 'Bearer secret' },
    payload: { goal: 'g', minutesText: 'm' },
  });

  assert.equal(res.statusCode, 404);
});

test('POST /api/minutes/:id/instruction 400s on missing minutesText', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/7/instruction',
    headers: { authorization: 'Bearer secret' },
    payload: { goal: 'g' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.setComposed.length, 0);
});

// ---- GET /api/minutes?briefingId=N (browser polls the handoff) ----

test('GET /api/minutes returns the records for a briefing', async (t) => {
  const rows = [
    {
      id: 7,
      status: 'composed',
      outcome: 'redirect',
      directive: 'focus on auth',
      composedGoal: 'wire the daemon',
      composedMinutes: 'decisions',
      created_at: '2026-06-13T00:00:00.000Z',
    },
  ];
  const db = fakeDb({ getMinutesForBriefing: async () => rows });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/minutes?briefingId=5' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), rows);
});

test('GET /api/minutes 400s on missing briefingId query param', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/minutes' });
  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.getMinutesForBriefing.length, 0);
});

test('GET /api/minutes 400s on a non-integer briefingId', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/minutes?briefingId=abc' });
  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.getMinutesForBriefing.length, 0);
});

// ---- POST /api/minutes/:id/approve (browser approves; enqueues) ----

test('POST /api/minutes/:id/approve enqueues and returns the queued sprint id', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/7/approve',
    payload: { goal: 'edited goal' },
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(JSON.parse(res.body), { queuedSprintId: 22 });
  assert.equal(db.calls.approveMinutes.length, 1);
  assert.deepEqual(db.calls.approveMinutes[0], { id: '7', goal: 'edited goal' });
});

test('POST /api/minutes/:id/approve passes goal:undefined when body omits goal', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/7/approve',
    payload: {},
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(db.calls.approveMinutes[0], { id: '7', goal: undefined });
});

test('POST /api/minutes/:id/approve 409s when the row is not composed', async (t) => {
  const db = fakeDb({
    approveMinutes: async () => {
      throw new Error('minutes row id=7 is not composed');
    },
  });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/7/approve',
    payload: { goal: 'x' },
  });

  assert.equal(res.statusCode, 409);
});

test('POST /api/minutes/:id/approve 404s when the row is not found', async (t) => {
  const db = fakeDb({
    approveMinutes: async () => {
      throw new Error('minutes row id=999 not found');
    },
  });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes/999/approve',
    payload: { goal: 'x' },
  });

  assert.equal(res.statusCode, 404);
});

// ---- GET /api/next-sprint (kept unchanged from the prior contract) ----

test('GET /api/next-sprint requires the bearer token', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/next-sprint' });
  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.claimNextSprint.length, 0);
});

test('GET /api/next-sprint returns 204 when the queue is empty', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/next-sprint',
    headers: { authorization: 'Bearer secret' },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
  assert.equal(db.calls.claimNextSprint.length, 1);
});

test('GET /api/next-sprint returns the claimed sprint', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb({
    claimNextSprint: async () => ({ goal: 'next goal', minutes: 'the minutes' }),
  });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/next-sprint',
    headers: { authorization: 'Bearer secret' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { goal: 'next goal', minutes: 'the minutes' });
});
