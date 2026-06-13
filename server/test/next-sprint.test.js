// Tests for GET /api/next-sprint. Uses app.inject() — no database, no listen.
//
// Mocking strategy: buildApp() accepts an optional { claimNextSprint } override
// so the route can be exercised without a real Postgres connection. Each test
// passes its own stub. LAB_MEETING_TOKEN is set so the requireToken guard has a
// concrete value to compare against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

const TOKEN = 'test-token';
process.env.LAB_MEETING_TOKEN = TOKEN;

const auth = { authorization: `Bearer ${TOKEN}` };

test('GET /api/next-sprint without a token → 401', async (t) => {
  const app = await buildApp({ claimNextSprint: async () => ({ goal: 'g', minutes: 'm' }) });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/next-sprint' });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body), { error: 'unauthorized' });
});

test('GET /api/next-sprint with a wrong token → 401', async (t) => {
  const app = await buildApp({ claimNextSprint: async () => ({ goal: 'g', minutes: 'm' }) });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/next-sprint',
    headers: { authorization: 'Bearer wrong' },
  });
  assert.equal(res.statusCode, 401);
});

test('GET /api/next-sprint with a pending row → 200 { goal, minutes }', async (t) => {
  const app = await buildApp({
    claimNextSprint: async () => ({ goal: 'ship it', minutes: 'approved · ship it' }),
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { goal: 'ship it', minutes: 'approved · ship it' });
});

test('GET /api/next-sprint with no pending row → 204 empty body', async (t) => {
  const app = await buildApp({ claimNextSprint: async () => null });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(res.statusCode, 204);
  assert.equal(res.body, '');
});

test('two rapid claims: first returns the row, second returns 204', async (t) => {
  let calls = 0;
  const app = await buildApp({
    claimNextSprint: async () => (calls++ === 0 ? { goal: 'g1', minutes: 'm1' } : null),
  });
  t.after(() => app.close());

  const first = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(JSON.parse(first.body), { goal: 'g1', minutes: 'm1' });

  const second = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(second.statusCode, 204);
  assert.equal(second.body, '');
});

test('oldest row (lowest id) is returned first across sequential claims', async (t) => {
  // The db helper orders by id ASC; the stub mirrors that draining order.
  const queue = [
    { goal: 'oldest', minutes: 'm-old' },
    { goal: 'newer', minutes: 'm-new' },
  ];
  const app = await buildApp({ claimNextSprint: async () => queue.shift() ?? null });
  t.after(() => app.close());

  const first = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(JSON.parse(first.body).goal, 'oldest');

  const second = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(JSON.parse(second.body).goal, 'newer');

  const third = await app.inject({ method: 'GET', url: '/api/next-sprint', headers: auth });
  assert.equal(third.statusCode, 204);
});
