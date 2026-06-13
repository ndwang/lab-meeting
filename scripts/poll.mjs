#!/usr/bin/env node
// The loop-closer. Runs on the laptop (NOT deployed). Polls the live app for a
// sprint queued by a resolved meeting and launches it via headless Claude Code.
// This is the one piece of glue with no fallback — the director owns it.
//
// Run it (Node 20+ loads .env natively):
//   node --env-file=.env scripts/poll.mjs
//
// Requires LAB_MEETING_URL and LAB_MEETING_TOKEN (fails fast if missing).
//
// How a sprint is launched headlessly: saved workflows in .claude/workflows are
// NOT exposed as CLI slash commands, so `claude -p "/sprint"` does not work.
// Instead we prompt a headless `claude -p` session to drive the Workflow tool
// on the saved script. Verified: headless claude stays alive until the workflow
// (and its agents + reporter POST) completes, then exits.
import { spawn } from 'node:child_process';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const URL_BASE = requireEnv('LAB_MEETING_URL').replace(/\/$/, '');
const TOKEN = requireEnv('LAB_MEETING_TOKEN');
const INTERVAL_MS = 5000;
const WORKFLOW = '.claude/workflows/sprint.mjs';

let running = false; // never launch a second sprint while one is in flight

async function tick() {
  if (running) return;
  let res;
  try {
    res = await fetch(`${URL_BASE}/api/next-sprint`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  } catch (e) {
    console.error('[poll] unreachable:', e.message);
    return;
  }
  if (res.status === 204) return; // nothing queued
  if (!res.ok) {
    console.error('[poll] unexpected status', res.status);
    return;
  }
  const { goal, minutes } = await res.json();
  launchSprint(goal, minutes ?? '');
}

function launchSprint(goal, minutes) {
  running = true;
  console.log(`[poll] launching sprint — the PI's direction, made literal:\n        ${goal.slice(0, 120)}`);
  const prompt =
    `Use the Workflow tool to run the saved workflow at ${WORKFLOW}. ` +
    `Pass this exact value as the args argument: ${JSON.stringify({ goal, minutes })}. ` +
    `This launches one autonomous sprint that ends by POSTing a briefing to the meeting app. ` +
    `Wait for the workflow to finish, then reply with only the JSON it returned.`;

  // stdio: ignore stdin (equivalent to `< /dev/null`); stream child output.
  const child = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('error', (err) => {
    console.error('[poll] failed to launch claude:', err.message);
    running = false;
  });
  child.on('exit', (code) => {
    console.log(`[poll] sprint process exited (code ${code}). Watching for the next queued sprint.`);
    running = false;
  });
}

console.log(`[poll] watching ${URL_BASE}/api/next-sprint every ${INTERVAL_MS}ms`);
setInterval(tick, INTERVAL_MS);
tick();
