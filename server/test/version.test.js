// Test for GET /api/version. Uses app.inject() — no database, no listen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { buildApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve the root package.json file-relative so the test passes from any CWD.
const rootPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'),
);

test('GET /api/version returns the root package.json version', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/version' });

  assert.equal(res.statusCode, 200, 'responds with HTTP 200');

  const body = JSON.parse(res.body);
  assert.deepEqual(
    Object.keys(body),
    ['version'],
    'body has exactly one key: version',
  );
  assert.equal(typeof body.version, 'string', 'version is a string');
  assert.ok(body.version.length > 0, 'version is non-empty');
  assert.equal(
    body.version,
    rootPkg.version,
    'version equals root package.json version',
  );
});
