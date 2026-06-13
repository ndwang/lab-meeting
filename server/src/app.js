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
  enqueueSprint,
  claimNextSprint,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

// Read the repo's version once at module load from the root package.json,
// resolved file-relative so it works regardless of CWD. Throws (fail-fast) if
// the file is missing or unparseable.
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
);

// Render the human-readable minutes text stored on the queued sprint. This is
// the standing direction the next sprint's agents read: the outcome, the
// directive, and any captured question answers.
function renderMinutes({ outcome, directive, answers }) {
  const lines = [`Outcome: ${outcome}`, `Directive: ${directive}`];
  if (answers.length > 0) {
    lines.push('', 'Answers:');
    for (const { title, answer } of answers) {
      lines.push(`- ${title}: ${answer}`);
    }
  }
  return lines.join('\n');
}

// The db layer is injectable so the DB-touching routes are testable via
// app.inject() without a live Postgres. Production (index.js) calls buildApp()
// with no args and uses the real module.
const realDb = {
  insertBriefing,
  listBriefings,
  getBriefing,
  insertMinutes,
  enqueueSprint,
  claimNextSprint,
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

  // Resolved decision slide. Called by the BROWSER (no bearer token) when the
  // human approves or redirects: persists the minutes, then enqueues the next
  // sprint with the directive as its goal. Returns { minutesId, queuedSprintId }.
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
      payload: { briefingId, outcome, directive, answers: normalizedAnswers },
    });

    const minutesText = renderMinutes({ outcome, directive, answers: normalizedAnswers });
    const queuedSprintId = await db.enqueueSprint({ goal: directive, minutes: minutesText });

    req.log.info({ minutesId, queuedSprintId, outcome }, 'minutes recorded, sprint queued');
    return reply.code(201).send({ minutesId, queuedSprintId });
  });

  // Drained by the local poller (scripts/poll.mjs) — requires the bearer token.
  // Atomically claims the oldest pending queued sprint; 204 when none remain.
  app.get('/api/next-sprint', async (req, reply) => {
    if (requireToken(req, reply)) return;
    const next = await db.claimNextSprint();
    if (!next) return reply.code(204).send();
    return reply.code(200).send({ goal: next.goal, minutes: next.minutes });
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
