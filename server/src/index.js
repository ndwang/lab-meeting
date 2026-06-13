// Lab Meeting server entrypoint: require config, connect the DB, serve.
// All required env is asserted up front and fails fast if missing.
import 'dotenv/config';
import { requireEnv } from './env.js';
import { initDb } from './db.js';
import { buildApp } from './app.js';

const port = Number(requireEnv('PORT'));
requireEnv('LAB_MEETING_TOKEN'); // asserted here; read per-request in app.js
await initDb();
const app = await buildApp();
await app.listen({ port, host: '0.0.0.0' });
