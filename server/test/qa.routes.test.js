// Tests for the Q&A channel routes. Uses app.inject() with an injected fake db
// — no Postgres, no listen. The fake mirrors the real db function signatures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

// Minimal in-memory db double matching the real module's function shapes.
function fakeDb(overrides = {}) {
  const calls = {
    insertQuestion: [],
    claimPendingQuestion: [],
    answerQuestion: [],
    listQAForBriefing: [],
  };
  return {
    calls,
    insertQuestion: async (arg) => {
      calls.insertQuestion.push(arg);
      return 7;
    },
    claimPendingQuestion: async () => {
      calls.claimPendingQuestion.push(true);
      return null;
    },
    answerQuestion: async (arg) => {
      calls.answerQuestion.push(arg);
      return true;
    },
    listQAForBriefing: async (arg) => {
      calls.listQAForBriefing.push(arg);
      return [];
    },
    // Unused by these routes but present so the route table stays intact.
    insertBriefing: async () => 1,
    listBriefings: async () => [],
    getBriefing: async () => null,
    insertMinutes: async () => 1,
    enqueueSprint: async () => 1,
    claimNextSprint: async () => null,
    ...overrides,
  };
}

// ---- POST /api/qa (browser-facing, no token) ----

test('POST /api/qa with a valid body inserts a pending question and returns 201', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa',
    payload: { briefingId: 5, question: 'Why this approach?' },
  });

  assert.equal(res.statusCode, 201);
  assert.deepEqual(JSON.parse(res.body), { questionId: 7 });
  assert.equal(db.calls.insertQuestion.length, 1);
  assert.deepEqual(db.calls.insertQuestion[0], {
    briefingId: 5,
    question: 'Why this approach?',
  });
});

test('POST /api/qa does not require a bearer token (browser-facing)', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa',
    payload: { briefingId: 1, question: 'q' },
  });

  assert.equal(res.statusCode, 201);
});

test('POST /api/qa 400s on missing briefingId and does not call the db', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa',
    payload: { question: 'no briefing here' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.insertQuestion.length, 0);
});

test('POST /api/qa 400s on missing question', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa',
    payload: { briefingId: 1 },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.insertQuestion.length, 0);
});

test('POST /api/qa 400s on an empty-string question', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa',
    payload: { briefingId: 1, question: '' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.insertQuestion.length, 0);
});

// ---- GET /api/qa/pending (daemon, token required) ----

test('GET /api/qa/pending requires the bearer token and does not claim without it', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/qa/pending' });

  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.claimPendingQuestion.length, 0);
});

test('GET /api/qa/pending returns the claimed question with a valid token', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb({
    claimPendingQuestion: async () => ({
      id: 9,
      briefingId: 5,
      question: 'Why this approach?',
    }),
  });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/qa/pending',
    headers: { authorization: 'Bearer secret' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    id: 9,
    briefingId: 5,
    question: 'Why this approach?',
  });
});

test('GET /api/qa/pending returns 204 when no question is pending', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/qa/pending',
    headers: { authorization: 'Bearer secret' },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
  assert.equal(db.calls.claimPendingQuestion.length, 1);
});

// ---- POST /api/qa/:id/answer (daemon, token required) ----

test('POST /api/qa/:id/answer records the answer with a valid token', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa/9/answer',
    headers: { authorization: 'Bearer secret' },
    payload: { answer: 'Because it is simpler.' },
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(db.calls.answerQuestion.length, 1);
  assert.equal(db.calls.answerQuestion[0].id, '9');
  assert.equal(db.calls.answerQuestion[0].answer, 'Because it is simpler.');
});

test('POST /api/qa/:id/answer requires the bearer token', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa/9/answer',
    payload: { answer: 'x' },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(db.calls.answerQuestion.length, 0);
});

test('POST /api/qa/:id/answer 404s when the id is unknown', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb({ answerQuestion: async () => false });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa/999/answer',
    headers: { authorization: 'Bearer secret' },
    payload: { answer: 'x' },
  });

  assert.equal(res.statusCode, 404);
});

test('POST /api/qa/:id/answer 400s on a missing answer', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/qa/9/answer',
    headers: { authorization: 'Bearer secret' },
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.answerQuestion.length, 0);
});

// ---- GET /api/qa?briefingId=N (browser-facing, no token) ----

test('GET /api/qa?briefingId=5 returns the thread from listQAForBriefing(5)', async (t) => {
  const thread = [
    { id: 1, question: 'q1', answer: 'a1', status: 'answered', created_at: 't1' },
    { id: 2, question: 'q2', answer: null, status: 'pending', created_at: 't2' },
  ];
  const db = fakeDb({ listQAForBriefing: async () => thread });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/qa?briefingId=5' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), thread);
});

test('GET /api/qa passes the parsed integer briefingId to the db layer', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  await app.inject({ method: 'GET', url: '/api/qa?briefingId=5' });

  assert.equal(db.calls.listQAForBriefing.length, 1);
  assert.equal(db.calls.listQAForBriefing[0], 5);
});

test('GET /api/qa does not require a bearer token (browser-facing)', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/qa?briefingId=5' });

  assert.equal(res.statusCode, 200);
});

test('GET /api/qa 400s when briefingId is absent and does not call the db', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/qa' });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.listQAForBriefing.length, 0);
});

test('GET /api/qa 400s when briefingId is not a valid integer', async (t) => {
  const db = fakeDb();
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/qa?briefingId=abc' });

  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.listQAForBriefing.length, 0);
});

// ---- Routing: /api/qa/pending must not be shadowed by parameterized routes ----

test('GET /api/qa/pending is distinct from the parameterized answer route', async (t) => {
  process.env.LAB_MEETING_TOKEN = 'secret';
  const db = fakeDb({
    claimPendingQuestion: async () => ({ id: 1, briefingId: 2, question: 'q' }),
  });
  const app = await buildApp({ db });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/qa/pending',
    headers: { authorization: 'Bearer secret' },
  });

  // It hit the claim handler (200 + claimed row), not a 404/405 from shadowing.
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { id: 1, briefingId: 2, question: 'q' });
});
