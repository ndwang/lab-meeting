// Lab Meeting server: the deployed front-of-house and the HTTP ingest point
// that replaces the original filesystem-watched briefings directory.
//
// Hello-world skeleton scope (Kickoff):
//   GET  /api/health          liveness
//   POST /api/briefings       reporter agent posts the briefing JSON here  [token]
//   GET  /api/briefings       list recent briefings
//   GET  /api/briefings/:id   full briefing payload
// Sprint 1+ adds: slide rendering UI, POST /api/minutes, GET /api/next-sprint,
// POST /api/qa (server-side Opus 4.8). Contracts live in the design doc.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { initDb, insertBriefing, listBriefings, getBriefing, usingPostgres } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

// --- auth: shared bearer token on write/ingest endpoints ---
function requireToken(req, reply) {
  const expected = process.env.LAB_MEETING_TOKEN;
  if (!expected) return; // unset in dev → open, so the skeleton runs locally
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (got !== expected) {
    reply.code(401).send({ error: 'unauthorized' });
    return reply;
  }
}

// --- API ---
app.get('/api/health', async () => ({
  ok: true,
  service: 'lab-meeting',
  storage: usingPostgres() ? 'postgres' : 'memory',
}));

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

// --- static client (built SPA) with history-API fallback ---
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({
    ok: true,
    note: 'client not built — run `npm run build`. API is live at /api/health',
  }));
}

const port = Number(process.env.PORT) || 3000;
await initDb();
await app.listen({ port, host: '0.0.0.0' });
