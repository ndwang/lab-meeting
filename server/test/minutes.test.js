// Tests for POST /api/minutes and GET /api/next-sprint. Uses app.inject() with
// an injected fake db — no Postgres, no listen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

// Minimal in-memory db double matching the real module's function shapes.
function fakeDb(overrides = {}) {
  const calls = { insertMinutes: [], enqueueSprint: [], claimNextSprint: [] };
  return {
    calls,
    insertMinutes: async (arg) => {
      calls.insertMinutes.push(arg);
      return 11;
    },
    enqueueSprint: async (arg) => {
      calls.enqueueSprint.push(arg);
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
    ...overrides,
  };
}

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

test('POST /api/minutes persists minutes and enqueues the next sprint', async (t) => {
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
  assert.deepEqual(JSON.parse(res.body), { minutesId: 11, queuedSprintId: 22 });

  // minutes row captures outcome + full payload
  assert.equal(db.calls.insertMinutes.length, 1);
  const m = db.calls.insertMinutes[0];
  assert.equal(m.briefingId, 5);
  assert.equal(m.outcome, 'redirect');
  assert.deepEqual(m.payload, {
    briefingId: 5,
    outcome: 'redirect',
    directive: 'focus on auth',
    answers: [{ title: 'Q1', answer: 'yes' }],
  });

  // queued sprint uses directive as goal + rendered minutes text
  assert.equal(db.calls.enqueueSprint.length, 1);
  const q = db.calls.enqueueSprint[0];
  assert.equal(q.goal, 'focus on auth');
  assert.match(q.minutes, /Outcome: redirect/);
  assert.match(q.minutes, /Directive: focus on auth/);
  assert.match(q.minutes, /Q1: yes/);
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

  assert.deepEqual(db.calls.insertMinutes[0].payload.answers, []);
  // No "Answers:" section when there are none.
  assert.doesNotMatch(db.calls.enqueueSprint[0].minutes, /Answers:/);
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
  assert.equal(db.calls.enqueueSprint[0].goal, '');
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
  assert.equal(db.calls.enqueueSprint.length, 0);
});

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
