#!/usr/bin/env node
// The attendant daemon — the lab's standing presence. Runs on the laptop (NOT
// deployed). Two independent loops against the live meeting app:
//   1. sprint loop  — drains GET /api/next-sprint, launches the next sprint.
//   2. Q&A loop      — drains GET /api/qa/pending, spawns a host agent that
//                      answers grounded in the briefing artifacts + live repo
//                      and POSTs the answer back ("the engineer joins the meeting").
// Both run agents via headless `claude -p` driving the Workflow tool / repo.
// This is the glue with no fallback — the director owns it.
//
//   node --env-file=.env scripts/poll.mjs
//
// Requires LAB_MEETING_URL and LAB_MEETING_TOKEN (fails fast if missing).
import { spawn } from 'node:child_process';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const URL_BASE = requireEnv('LAB_MEETING_URL').replace(/\/$/, '');
const TOKEN = requireEnv('LAB_MEETING_TOKEN');
const SPRINT_INTERVAL_MS = 5000;
const QA_INTERVAL_MS = 4000;
const WORKFLOW = '.claude/workflows/sprint.mjs';

// Spawn a headless claude that inherits this process's env (so its Bash sees
// LAB_MEETING_URL / LAB_MEETING_TOKEN). stdin ignored (= `< /dev/null`).
function spawnClaude(prompt, onExit) {
  const child = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('error', (err) => { console.error('[poll] claude launch failed:', err.message); onExit(err); });
  child.on('exit', (code) => onExit(null, code));
}

// --- 1. sprint loop ---------------------------------------------------------
let sprintRunning = false; // never launch a second sprint while one is in flight

async function sprintTick() {
  if (sprintRunning) return;
  let res;
  try {
    res = await fetch(`${URL_BASE}/api/next-sprint`, { headers: { authorization: `Bearer ${TOKEN}` } });
  } catch (e) { console.error('[poll] next-sprint unreachable:', e.message); return; }
  if (res.status === 204) return;
  if (!res.ok) { console.error('[poll] next-sprint status', res.status); return; }
  const { goal, minutes } = await res.json();
  sprintRunning = true;
  console.log(`[poll] launching sprint — the PI's direction, made literal:\n        ${goal.slice(0, 120)}`);
  const prompt =
    `Use the Workflow tool to run the saved workflow at ${WORKFLOW}. ` +
    `Pass this exact value as the args argument: ${JSON.stringify({ goal, minutes: minutes ?? '' })}. ` +
    `This launches one autonomous sprint that ends by POSTing a briefing to the meeting app. ` +
    `Wait for the workflow to finish, then reply with only the JSON it returned.`;
  spawnClaude(prompt, (_err, code) => {
    console.log(`[poll] sprint process exited (code ${code ?? 'err'}). Watching for the next queued sprint.`);
    sprintRunning = false;
  });
}

// --- 2. Q&A loop ------------------------------------------------------------
let qaRunning = false; // answer one question at a time (only claim when ready)

async function qaTick() {
  if (qaRunning) return;
  let res;
  try {
    res = await fetch(`${URL_BASE}/api/qa/pending`, { headers: { authorization: `Bearer ${TOKEN}` } });
  } catch (e) { console.error('[poll] qa/pending unreachable:', e.message); return; }
  if (res.status === 204) return;
  if (!res.ok) { console.error('[poll] qa/pending status', res.status); return; }
  const { id, briefingId, question } = await res.json();
  qaRunning = true;
  console.log(`[poll] engineer joining the meeting — Q on briefing ${briefingId}:\n        ${String(question).slice(0, 120)}`);
  const prompt =
    `You are the engineer joining a lab meeting to answer ONE follow-up question, grounded in real evidence. ` +
    `Question (about briefing ${briefingId}): ${JSON.stringify(question)}. ` +
    `Ground your answer in BOTH (a) the briefing artifacts — fetch ${URL_BASE}/api/briefings/${briefingId} and read its ` +
    `artifacts payload (diffs, gitLog, testOutput, reviewerVerdicts, docsChanged, specDeltas) — and (b) the actual ` +
    `repository you are running in (read files, run git/grep/tests as needed). Be concise and concrete. If the answer ` +
    `is not supported by the artifacts or the code, say so honestly (e.g. "that wasn't tested"); do not speculate. ` +
    `Then POST your answer exactly once (the token is in your environment as $LAB_MEETING_TOKEN). To avoid ` +
    `shell-quoting issues, write the JSON body — an object with a single "answer" string field — to a temp file ` +
    `and send it: curl -sS -X POST "${URL_BASE}/api/qa/${id}/answer" -H "content-type: application/json" ` +
    `-H "authorization: Bearer $LAB_MEETING_TOKEN" --data @/tmp/qa-${id}.json. Then reply with only the answer text.`;
  spawnClaude(prompt, (_err, code) => {
    console.log(`[poll] engineer finished Q ${id} (code ${code ?? 'err'}).`);
    qaRunning = false;
  });
}

console.log(`[poll] attendant daemon watching ${URL_BASE} — sprints every ${SPRINT_INTERVAL_MS}ms, Q&A every ${QA_INTERVAL_MS}ms`);
setInterval(sprintTick, SPRINT_INTERVAL_MS);
setInterval(qaTick, QA_INTERVAL_MS);
sprintTick();
qaTick();
