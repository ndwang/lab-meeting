// Builds the Fastify app: routes + static client serving. No DB connect, no
// listen — so routes are testable via app.inject() without a database.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import * as realDb from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

// Read the repo's version once at module load from the root package.json,
// resolved file-relative so it works regardless of CWD. Throws (fail-fast) if
// the file is missing or unparseable.
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
);

// Render a human-readable `minutes` text for the queued sprint from a resolved
// meeting: the outcome, the directive (next sprint goal), and any captured
// question-slide answers as `title: answer` lines.
function renderMinutesText({ outcome, directive, answers }) {
  const lines = [`Outcome: ${outcome}`, `Directive: ${directive}`];
  if (Array.isArray(answers) && answers.length > 0) {
    lines.push('Answers:');
    for (const { title, answer } of answers) {
      lines.push(`${title}: ${answer}`);
    }
  }
  return lines.join('\n');
}

// `opts.db` overrides individual db helpers in tests (so app.inject() can run
// without a real Postgres connection). Production calls buildApp() with no args.
export async function buildApp(opts = {}) {
  const db = { ...realDb, ...opts.db };
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Bearer token on write/ingest endpoints. The token is required at startup
  // (see index.js), so it is always present here.
  function requireToken(req, reply) {
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (got !== process.env.LAB_MEETING_TOKEN) {
      reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
  }

  app.get('/api/health', async () => ({ ok: true, service: 'lab-meeting' }));

  // Reports the repo's build version so consumers can confirm which build is
  // running. No DB, no auth.
  app.get('/api/version', async () => ({ version }));

  // The reporter agent ends every sprint by POSTing its briefing JSON here.
  app.post('/api/briefings', async (req, reply) => {
    if (await requireToken(req, reply)) return;
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

  // The browser POSTs here when the human resolves a meeting's decision slide.
  // No bearer token — this is browser-facing and the SPA holds no token. The
  // call persists the meeting outcome, then enqueues the next sprint.
  app.post('/api/minutes', async (req, reply) => {
    const body = req.body ?? {};
    if (!body.briefingId || !body.outcome || !body.directive) {
      return reply.code(400).send({ error: 'briefingId, outcome, and directive are required' });
    }
    if (body.outcome !== 'approve' && body.outcome !== 'redirect') {
      return reply.code(400).send({ error: 'outcome must be approve or redirect' });
    }

    const minutesId = await db.insertMinutes({
      briefingId: body.briefingId,
      outcome: body.outcome,
      payload: body,
    });

    const queuedSprintId = await db.insertSprintQueue({
      goal: body.directive,
      minutes: renderMinutesText(body),
    });

    req.log.info({ minutesId, queuedSprintId, outcome: body.outcome }, 'minutes recorded');
    return reply.code(201).send({ minutesId, queuedSprintId });
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
