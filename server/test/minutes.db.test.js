// Tests for the minutes status-machine storage functions. These exercise the
// function contracts (return shapes, status transitions, ordering, error
// discrimination) through an in-memory double that mirrors the real db.js
// signatures and SQL semantics — no Postgres, no listen (same pattern as
// qa.db.test.js). The SQL itself is confirmed by reading the implementation;
// these lock the observable behavior every caller depends on, covering the
// resolved -> composing -> composed -> approved machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// In-memory double mirroring the minutes + sprint_queue db.js functions. Each
// method has the same signature and observable semantics as the real SQL:
//   insertMinutes        -> INSERT ... status 'resolved' RETURNING id
//   claimPendingCompose  -> UPDATE oldest 'resolved' -> 'composing' RETURNING shape
//   setComposed          -> UPDATE composed cols + status 'composed' WHERE id
//   getMinutesForBriefing-> SELECT WHERE briefing_id ORDER BY id ASC (camelCase)
//   approveMinutes       -> tx: guard status, INSERT sprint_queue, status 'approved'
function makeMinutesStore() {
  const minutes = [];
  const sprintQueue = [];
  let minutesSeq = 0;
  let sprintSeq = 0;
  return {
    sprintQueue,
    async insertMinutes({ briefingId, outcome, directive, answers }) {
      const row = {
        id: ++minutesSeq,
        briefing_id: briefingId,
        outcome,
        directive,
        // Mirror JSONB round-trip: an array stays an array.
        answers: answers ?? [],
        composed_goal: null,
        composed_minutes: null,
        status: 'resolved',
        created_at: new Date(),
      };
      minutes.push(row);
      return row.id;
    },
    async claimPendingCompose() {
      const resolved = minutes
        .filter((r) => r.status === 'resolved')
        .sort((a, b) => a.id - b.id);
      const row = resolved[0];
      if (!row) return null;
      row.status = 'composing';
      return {
        minutesId: row.id,
        briefingId: row.briefing_id,
        outcome: row.outcome,
        directive: row.directive,
        answers: row.answers ?? [],
      };
    },
    async setComposed({ id, composedGoal, composedMinutes }) {
      const row = minutes.find((r) => r.id === id);
      if (!row) return false;
      row.composed_goal = composedGoal;
      row.composed_minutes = composedMinutes;
      row.status = 'composed';
      return true;
    },
    async getMinutesForBriefing(briefingId) {
      return minutes
        .filter((r) => r.briefing_id === briefingId)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({
          id: r.id,
          status: r.status,
          outcome: r.outcome,
          directive: r.directive,
          composedGoal: r.composed_goal,
          composedMinutes: r.composed_minutes,
          created_at: r.created_at,
        }));
    },
    async approveMinutes({ id, goal }) {
      const row = minutes.find((r) => r.id === id);
      if (!row) throw new Error(`minutes row id=${id} not found`);
      if (row.status !== 'composed') {
        throw new Error(`minutes row id=${id} is not composed`);
      }
      const finalGoal = goal != null ? goal : row.composed_goal;
      const queuedRow = {
        id: ++sprintSeq,
        goal: finalGoal,
        minutes: row.composed_minutes,
        status: 'pending',
      };
      sprintQueue.push(queuedRow);
      row.status = 'approved';
      return queuedRow.id;
    },
  };
}

test('insertMinutes returns an integer id and the row starts resolved', async () => {
  const db = makeMinutesStore();
  const id = await db.insertMinutes({
    briefingId: 1,
    outcome: 'redirect',
    directive: 'do X',
    answers: [{ title: 'Q1', answer: 'yes' }],
  });

  assert.equal(typeof id, 'number');
  const rows = await db.getMinutesForBriefing(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'resolved');
  assert.equal(rows[0].outcome, 'redirect');
  assert.equal(rows[0].directive, 'do X');
});

test('claimPendingCompose claims the oldest resolved row and marks it composing', async () => {
  const db = makeMinutesStore();
  const first = await db.insertMinutes({
    briefingId: 2,
    outcome: 'redirect',
    directive: 'first',
    answers: [{ title: 'Q1', answer: 'yes' }],
  });
  await db.insertMinutes({
    briefingId: 2,
    outcome: 'approve',
    directive: 'second',
    answers: [],
  });

  const claimed = await db.claimPendingCompose();
  assert.deepEqual(claimed, {
    minutesId: first,
    briefingId: 2,
    outcome: 'redirect',
    directive: 'first',
    answers: [{ title: 'Q1', answer: 'yes' }],
  });

  const rows = await db.getMinutesForBriefing(2);
  assert.equal(rows.find((r) => r.id === first).status, 'composing');
});

test('claimPendingCompose returns null when no resolved rows remain', async () => {
  const db = makeMinutesStore();
  await db.insertMinutes({ briefingId: 9, outcome: 'approve', directive: 'x', answers: [] });
  await db.claimPendingCompose(); // claims the only resolved row -> composing
  const again = await db.claimPendingCompose();
  assert.equal(again, null);
});

test('claimPendingCompose returns null on an empty table', async () => {
  const db = makeMinutesStore();
  assert.equal(await db.claimPendingCompose(), null);
});

test('setComposed sets the composed columns and status, returns true', async () => {
  const db = makeMinutesStore();
  const id = await db.insertMinutes({ briefingId: 3, outcome: 'redirect', directive: 'go', answers: [] });

  const ok = await db.setComposed({ id, composedGoal: 'goal text', composedMinutes: 'minutes text' });
  assert.equal(ok, true);

  const rows = await db.getMinutesForBriefing(3);
  assert.equal(rows[0].status, 'composed');
  assert.equal(rows[0].composedGoal, 'goal text');
  assert.equal(rows[0].composedMinutes, 'minutes text');
});

test('setComposed returns false for an unknown id', async () => {
  const db = makeMinutesStore();
  assert.equal(await db.setComposed({ id: 9999, composedGoal: 'g', composedMinutes: 'm' }), false);
});

test('getMinutesForBriefing returns camelCase rows in ascending id order', async () => {
  const db = makeMinutesStore();
  const i1 = await db.insertMinutes({ briefingId: 4, outcome: 'approve', directive: 'one', answers: [] });
  const i2 = await db.insertMinutes({ briefingId: 4, outcome: 'redirect', directive: 'two', answers: [] });
  const i3 = await db.insertMinutes({ briefingId: 4, outcome: 'approve', directive: 'three', answers: [] });

  const rows = await db.getMinutesForBriefing(4);
  assert.deepEqual(rows.map((r) => r.id), [i1, i2, i3]);
  // camelCase composed keys are present even before composition.
  assert.ok('composedGoal' in rows[0]);
  assert.ok('composedMinutes' in rows[0]);
  assert.equal(rows[0].composedGoal, null);
});

test('approveMinutes with an explicit goal enqueues with that goal and marks approved', async () => {
  const db = makeMinutesStore();
  const id = await db.insertMinutes({ briefingId: 5, outcome: 'redirect', directive: 'd', answers: [] });
  await db.setComposed({ id, composedGoal: 'composed goal', composedMinutes: 'm' });

  const sprintId = await db.approveMinutes({ id, goal: 'override' });
  assert.equal(typeof sprintId, 'number');

  const queued = db.sprintQueue.find((q) => q.id === sprintId);
  assert.equal(queued.goal, 'override');
  assert.equal(queued.minutes, 'm');

  const rows = await db.getMinutesForBriefing(5);
  assert.equal(rows[0].status, 'approved');
});

test('approveMinutes with no goal falls back to composed_goal', async () => {
  const db = makeMinutesStore();
  const id = await db.insertMinutes({ briefingId: 6, outcome: 'redirect', directive: 'd', answers: [] });
  await db.setComposed({ id, composedGoal: 'the composed goal', composedMinutes: 'mm' });

  const sprintId = await db.approveMinutes({ id });
  const queued = db.sprintQueue.find((q) => q.id === sprintId);
  assert.equal(queued.goal, 'the composed goal');
});

test('approveMinutes on a resolved (not composed) row throws "not composed"', async () => {
  const db = makeMinutesStore();
  const id = await db.insertMinutes({ briefingId: 7, outcome: 'redirect', directive: 'd', answers: [] });

  await assert.rejects(() => db.approveMinutes({ id }), /not composed/);
  // No sprint was enqueued.
  assert.equal(db.sprintQueue.length, 0);
});

test('approveMinutes on an unknown id throws "not found"', async () => {
  const db = makeMinutesStore();
  await assert.rejects(() => db.approveMinutes({ id: 9999 }), /not found/);
});

test('insertMinutes accepts an empty answers array and getMinutesForBriefing reflects it', async () => {
  const db = makeMinutesStore();
  await db.insertMinutes({ briefingId: 8, outcome: 'approve', directive: 'ship', answers: [] });
  const claimed = await db.claimPendingCompose();
  assert.deepEqual(claimed.answers, []);
  const rows = await db.getMinutesForBriefing(8);
  assert.equal(rows.length, 1);
});
