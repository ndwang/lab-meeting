// Tests for POST /api/minutes. Uses app.inject() — no database, no listen.
//
// Mocking strategy: buildApp() accepts an optional `{ db }` override object that
// is spread over the real db module. We pass stub `insertMinutes` /
// `insertSprintQueue` so no real pool.query ever fires. Each stub records its
// last call so we can assert on the persisted shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

// Build an app whose db helpers are stubbed; returns the app plus a `calls`
// object capturing what the route passed to each helper.
async function buildStubbedApp() {
  const calls = { minutes: null, queue: null };
  const app = await buildApp({
    db: {
      insertMinutes: async (arg) => {
        calls.minutes = arg;
        return 11;
      },
      insertSprintQueue: async (arg) => {
        calls.queue = arg;
        return 22;
      },
    },
  });
  return { app, calls };
}

test('POST /api/minutes with a valid approve body → 201 and integer ids', async (t) => {
  const { app, calls } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve', directive: 'build X' },
  });

  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(Number.isInteger(body.minutesId), true, 'minutesId is an integer');
  assert.equal(Number.isInteger(body.queuedSprintId), true, 'queuedSprintId is an integer');

  // minutes row: briefing_id, outcome, and full body as payload.
  assert.equal(calls.minutes.briefingId, 1);
  assert.equal(calls.minutes.outcome, 'approve');
  assert.deepEqual(calls.minutes.payload, {
    briefingId: 1,
    outcome: 'approve',
    directive: 'build X',
  });

  // sprint_queue row: goal = directive; minutes text carries outcome + directive.
  assert.equal(calls.queue.goal, 'build X');
  assert.match(calls.queue.minutes, /approve/);
  assert.match(calls.queue.minutes, /build X/);
});

test('POST /api/minutes with answers → minutes text contains "Q1: A1"', async (t) => {
  const { app, calls } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: {
      briefingId: 1,
      outcome: 'approve',
      directive: 'build X',
      answers: [{ title: 'Q1', answer: 'A1' }],
    },
  });

  assert.equal(res.statusCode, 201);
  assert.match(calls.queue.minutes, /Q1: A1/);
  // Full body (including answers) persisted as the minutes payload.
  assert.deepEqual(calls.minutes.payload.answers, [{ title: 'Q1', answer: 'A1' }]);
});

test('POST /api/minutes with outcome=redirect → 201', async (t) => {
  const { app, calls } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 2, outcome: 'redirect', directive: 'focus on Y' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(calls.minutes.outcome, 'redirect');
  assert.equal(calls.queue.goal, 'focus on Y');
});

test('POST /api/minutes requires no bearer token', async (t) => {
  const { app } = await buildStubbedApp();
  t.after(() => app.close());

  // No Authorization header at all.
  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve', directive: 'build X' },
  });

  assert.equal(res.statusCode, 201);
});

test('POST /api/minutes with missing briefingId → 400', async (t) => {
  const { app } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { outcome: 'approve', directive: 'build X' },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(typeof JSON.parse(res.body).error, 'string');
});

test('POST /api/minutes with briefingId=null → 400', async (t) => {
  const { app } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: null, outcome: 'approve', directive: 'build X' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /api/minutes with missing outcome → 400', async (t) => {
  const { app } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, directive: 'build X' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /api/minutes with missing directive → 400', async (t) => {
  const { app } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /api/minutes with an invalid outcome → 400', async (t) => {
  const { app } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'maybe', directive: 'build X' },
  });

  assert.equal(res.statusCode, 400);
});

test('POST /api/minutes with answers omitted → still 201', async (t) => {
  const { app, calls } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve', directive: 'build X' },
  });

  assert.equal(res.statusCode, 201);
  // No "Answers:" section when none were supplied.
  assert.doesNotMatch(calls.queue.minutes, /Answers:/);
});

test('POST /api/minutes with answers=[] → still 201', async (t) => {
  const { app, calls } = await buildStubbedApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'POST',
    url: '/api/minutes',
    payload: { briefingId: 1, outcome: 'approve', directive: 'build X', answers: [] },
  });

  assert.equal(res.statusCode, 201);
  assert.doesNotMatch(calls.queue.minutes, /Answers:/);
});
