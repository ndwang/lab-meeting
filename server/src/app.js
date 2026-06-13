// Builds the Fastify app: routes + static client serving. No DB connect, no
// listen — so routes are testable via app.inject() without a database.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { insertBriefing, listBriefings, getBriefing } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

export async function buildApp() {
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

  // The reporter agent ends every sprint by POSTing its briefing JSON here.
  app.post('/api/briefings', async (req, reply) => {
    if (await requireToken(req, reply)) return;
    const payload = req.body;
    if (!payload || !Array.isArray(payload.slides)) {
      return reply.code(400).send({ error: 'briefing must include a slides[] array' });
    }
    const id = await insertBriefing({
      sprintId: payload.sprintId,
      goal: payload.goal,
      payload,
    });
    req.log.info({ briefingId: id, slides: payload.slides.length }, 'briefing ingested');
    return reply.code(201).send({ briefingId: id });
  });

  app.get('/api/briefings', async () => ({ briefings: await listBriefings() }));

  app.get('/api/briefings/:id', async (req, reply) => {
    const row = await getBriefing(req.params.id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    return row.payload ?? row;
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
