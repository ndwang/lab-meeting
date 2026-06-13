#!/usr/bin/env node
// The loop-closer. Runs on the laptop (NOT deployed). Polls the live app for a
// sprint queued by a resolved meeting and launches it via headless Claude Code.
// This is the one piece of glue with no fallback — build and test it by hand.
//
//   LAB_MEETING_URL=https://lab-meeting.onrender.com \
//   LAB_MEETING_TOKEN=... \
//   node scripts/poll.mjs
//
// Stubbed for the kickoff: GET /api/next-sprint isn't implemented until Sprint 2.
import { execFile } from 'node:child_process';

const URL_BASE = process.env.LAB_MEETING_URL || 'http://localhost:3000';
const TOKEN = process.env.LAB_MEETING_TOKEN || '';
const INTERVAL_MS = 5000;

async function tick() {
  let res;
  try {
    res = await fetch(`${URL_BASE}/api/next-sprint`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
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
  console.log('[poll] launching sprint:', goal);
  // The PI's redirect, made literal: spoken/typed feedback → next workflow.
  launchSprint(goal, minutes);
}

function launchSprint(goal, minutes) {
  const prompt = `/sprint goal=${JSON.stringify(goal)} minutes=${JSON.stringify(minutes || '')}`;
  const child = execFile('claude', ['-p', prompt], (err, stdout, stderr) => {
    if (err) console.error('[poll] sprint launch failed:', err.message, stderr);
    else console.log('[poll] sprint started\n', stdout?.slice(0, 400));
  });
  child.unref();
}

console.log(`[poll] watching ${URL_BASE}/api/next-sprint every ${INTERVAL_MS}ms`);
setInterval(tick, INTERVAL_MS);
tick();
