// Builds the Fastify app: routes + static client serving. No DB connect, no
// listen — so routes are testable via app.inject() without a database.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  insertBriefing,
  listBriefings,
  getBriefing,
  insertMinutes,
  claimPendingCompose,
  setComposed,
  getMinutesForBriefing,
  approveMinutes,
  claimNextSprint,
  insertQuestion,
  claimPendingQuestion,
  answerQuestion,
  listQAForBriefing,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

// Read the repo's version once at module load from the root package.json,
// resolved file-relative so it works regardless of CWD. Throws (fail-fast) if
// the file is missing or unparseable.
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
);

// The db layer is injectable so the DB-touching routes are testable via
// app.inject() without a live Postgres. Production (index.js) calls buildApp()
// with no args and uses the real module.
const realDb = {
  insertBriefing,
  listBriefings,
  getBriefing,
  insertMinutes,
  claimPendingCompose,
  setComposed,
  getMinutesForBriefing,
  approveMinutes,
  claimNextSprint,
  insertQuestion,
  claimPendingQuestion,
  answerQuestion,
  listQAForBriefing,
};

export async function buildApp({ db = realDb } = {}) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Bearer token on write/ingest endpoints. The token is required at startup
  // (see index.js), so it is always present here. Returns true when the request
  // is rejected (a 401 has been sent) so callers must short-circuit. Returns a
  // plain boolean — NOT the reply — so callers can guard without `await` (a
  // Fastify reply is thenable and awaiting it resolves to undefined, which would
  // let the handler body run on through after the 401).
  function requireToken(req, reply) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (got !== process.env.LAB_MEETING_TOKEN) {
      reply.code(401).send({ error: 'unauthorized' });
      return true;
    }
    return false;
  }

  app.get('/api/health', async () => ({ ok: true, service: 'lab-meeting' }));

  // Reports the repo's build version so consumers can confirm which build is
  // running. No DB, no auth.
  app.get('/api/version', async () => ({ version }));

  // The reporter agent ends every sprint by POSTing its briefing JSON here.
  app.post('/api/briefings', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const payload = req.body;
    if (!payload || !Array.isArray(payload.slides)) {
      return reply.code(400).send({ error: 'briefing must include a slides[] array' });
    }
    const id = await db.insertBriefing({
      sprintId: payload.sprintId,
      goal: payload.goal,
      payload,
    });
    req.log.info({ briefingId: id, slides: payload.slides.length }, 'briefing ingested');
    return reply.code(201).send({ briefingId: id });
  });

  app.get('/api/briefings', async () => ({ briefings: await db.listBriefings() }));

  app.get('/api/briefings/:id', async (req, reply) => {
    const row = await db.getBriefing(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    return row.payload ?? row;
  });

  // ---- Decision handoff: a status machine on the minutes row
  // (resolved → composing → composed → approved). The browser records the
  // human's decision; the attendant daemon claims it; the host agent composes
  // the next instruction; the browser polls for it and the human approves it;
  // only then is the next sprint enqueued. The server holds no LLM — it is the
  // state-machine bus that carries the handoff between the room and the lab.

  // Resolved decision slide. Called by the BROWSER (no bearer token) when the
  // human approves or redirects: persists the human's decision as a 'resolved'
  // minutes row. Does NOT enqueue — that happens at approve time, after the host
  // agent has composed the next instruction. Returns { minutesId }.
  app.post('/api/minutes', async (req, reply) => {
    const body = req.body ?? {};
    const { briefingId, outcome, directive, answers } = body;

    if (briefingId == null || !outcome || directive == null) {
      return reply
        .code(400)
        .send({ error: 'briefingId, outcome and directive are required' });
    }
    if (outcome !== 'approve' && outcome !== 'redirect') {
      return reply
        .code(400)
        .send({ error: "outcome must be 'approve' or 'redirect'" });
    }

    const normalizedAnswers = Array.isArray(answers) ? answers : [];

    const minutesId = await db.insertMinutes({
      briefingId,
      outcome,
      directive,
      answers: normalizedAnswers,
    });

    req.log.info({ minutesId, outcome }, 'minutes recorded (resolved)');
    return reply.code(201).send({ minutesId });
  });

  // The attendant daemon polls this to claim the oldest 'resolved' minutes row
  // for composition. Bearer token. Atomically marks it 'composing' so a row is
  // claimed exactly once even under concurrent pollers; 204 when none remain.
  app.get('/api/compose/pending', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const claimed = await db.claimPendingCompose();
    if (!claimed) return reply.code(204).send();
    return reply.code(200).send(claimed);
  });

  // Browser polls the minutes record(s) for a briefing to watch the handoff
  // status advance and read the composed instruction. No bearer token.
  // Registered before the parameterized POST routes; query-param routing keeps
  // it distinct from the /api/minutes/:id forms.
  app.get('/api/minutes', async (req, reply) => {
    const raw = req.query.briefingId;
    const briefingId = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(briefingId)) {
      return reply.code(400).send({ error: 'briefingId is required' });
    }
    return db.getMinutesForBriefing(briefingId);
  });

  // Host agent posts the composed next instruction. Bearer token. Sets the
  // composed columns and advances the row to 'composed'. 404 on unknown id.
  app.post('/api/minutes/:id/instruction', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const { goal, minutesText } = req.body ?? {};
    if (!goal || !minutesText) {
      return reply.code(400).send({ error: 'goal and minutesText are required' });
    }
    const updated = await db.setComposed({
      id: req.params.id,
      composedGoal: goal,
      composedMinutes: minutesText,
    });
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return reply.code(200).send({ ok: true });
  });

  // Browser posts the human's approval (with the possibly-edited goal). No
  // bearer token. Enqueues the next sprint and advances the row to 'approved'.
  // 409 if the row has not been composed yet; 404 if the id is unknown.
  app.post('/api/minutes/:id/approve', async (req, reply) => {
    const { goal } = req.body ?? {};
    try {
      const queuedSprintId = await db.approveMinutes({ id: req.params.id, goal });
      req.log.info({ minutesId: req.params.id, queuedSprintId }, 'minutes approved, sprint queued');
      return reply.code(201).send({ queuedSprintId });
    } catch (err) {
      if (err.message.includes('not composed')) {
        return reply.code(409).send({ error: 'minutes not yet composed' });
      }
      if (err.message.includes('not found')) {
        return reply.code(404).send({ error: 'not found' });
      }
      throw err;
    }
  });

  // Drained by the local poller (scripts/poll.mjs) — requires the bearer token.
  // Atomically claims the oldest pending queued sprint; 204 when none remain.
  app.get('/api/next-sprint', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const next = await db.claimNextSprint();
    if (!next) return reply.code(204).send();
    return reply.code(200).send({ goal: next.goal, minutes: next.minutes });
  });

  // ---- Q&A channel: a store-and-forward relay. The server holds no LLM; it
  // only buses questions to the host agent (the attendant daemon) and answers
  // back to the browser.

  // Browser posts a follow-up during the meeting. No bearer token (human action).
  app.post('/api/qa', async (req, reply) => {
    const { briefingId, question } = req.body ?? {};
    if (briefingId == null || !question) {
      return reply.code(400).send({ error: 'briefingId and question are required' });
    }
    const questionId = await db.insertQuestion({ briefingId, question });
    req.log.info({ questionId, briefingId }, 'question posted');
    return reply.code(201).send({ questionId });
  });

  // Browser polls the full Q&A thread for a briefing. No bearer token.
  // Registered before the parameterized claim/answer routes; query-param routing
  // keeps it distinct from GET /api/qa/pending.
  app.get('/api/qa', async (req, reply) => {
    const raw = req.query.briefingId;
    const briefingId = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(briefingId)) {
      return reply.code(400).send({ error: 'briefingId is required' });
    }
    return db.listQAForBriefing(briefingId);
  });

  // Host agent (attendant daemon) claims the oldest pending question. Bearer token.
  app.get('/api/qa/pending', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const claimed = await db.claimPendingQuestion();
    if (!claimed) return reply.code(204).send();
    return reply.code(200).send(claimed);
  });

  // Host agent posts the grounded answer back. Bearer token.
  app.post('/api/qa/:id/answer', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const { answer } = req.body ?? {};
    if (!answer) {
      return reply.code(400).send({ error: 'answer is required' });
    }
    const updated = await db.answerQuestion({ id: req.params.id, answer });
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return reply.code(200).send({ ok: true });
  });

  // Built SPA with history-API fallback (client routing, not a compat fallback).
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
