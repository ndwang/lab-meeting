export const meta = {
  name: 'sprint',
  description:
    'One sprint: plan -> spec review -> parallel work lanes (build/review/docs in worktrees) -> integrate & test -> reporter posts a briefing to the live meeting app. The unit of work the PI gates at a lab meeting.',
  phases: [
    { title: 'Plan', detail: 'decompose the goal into 3-6 specs' },
    { title: 'Spec review', detail: 'batch critique; catch cross-spec conflicts' },
    { title: 'Work lanes', detail: 'per item: build -> skeptic review -> docs, in an isolated worktree' },
    { title: 'Integrate', detail: 'merge lanes, resolve conflicts, loop tests to green' },
    { title: 'Report', detail: 'compile the briefing and POST it to /api/briefings' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs. Launched as `/sprint with goal '...' and minutes '...'` (or via the
// poller). Read defensively: args may be an object, a string, or undefined.
// ---------------------------------------------------------------------------
// args may arrive as an object, a JSON string, or a bare goal string.
let input = args
if (typeof input === 'string') {
  try { input = JSON.parse(input) } catch { input = { goal: input } }
}
const goal = (input && input.goal) || 'Advance the project per the latest meeting minutes and CLAUDE.md.'
const minutes = (input && input.minutes) || ''

const MAX_SPEC_REVIEW_ROUNDS = 2
const MAX_BUILD_ATTEMPTS = 3 // 1 build + 2 retries with objections attached

const CONTEXT = `
SPRINT GOAL:
${goal}

LATEST MEETING MINUTES (the PI's standing direction — honor it):
${minutes || '(none — this is the first sprint)'}

Always read CLAUDE.md first for the product vision, the HTTP contract, the
briefing schema, and conventions. Specs follow SPEC_TEMPLATE.md. Spec review
follows the spec-review skill. Docs follow the docs-maintainer skill.
`.trim()

// ---------------------------------------------------------------------------
// Schemas — every agent returns validated structured data, never prose.
// ---------------------------------------------------------------------------
const SPECS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'specPath', 'purpose', 'acceptanceCriteria', 'targetFiles', 'testCases'],
        properties: {
          id: { type: 'string', description: 'short slug, e.g. "minutes-endpoint"' },
          title: { type: 'string' },
          specPath: { type: 'string', description: 'path to the written spec file, e.g. specs/minutes-endpoint.md' },
          purpose: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
          targetFiles: { type: 'array', items: { type: 'string' } },
          testCases: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    planSummary: { type: 'string' },
  },
}

const SPEC_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approved', 'crossSpecConflicts', 'perSpecIssues', 'summary'],
  properties: {
    approved: { type: 'boolean' },
    crossSpecConflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemIds', 'issue'],
        properties: {
          itemIds: { type: 'array', items: { type: 'string' } },
          issue: { type: 'string' },
        },
      },
    },
    perSpecIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'issues'],
        properties: {
          itemId: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'filesChanged', 'escalateContractIssue'],
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    escalateContractIssue: {
      type: 'boolean',
      description: 'true ONLY if implementing this faithfully would weaken an already-implemented contract — a PI decision, not a lane decision',
    },
    escalationReason: { type: 'string' },
  },
}

const LANE_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pass', 'specWrong', 'reasons', 'summary'],
  properties: {
    pass: { type: 'boolean' },
    specWrong: {
      type: 'boolean',
      description: 'true if the failure is the spec being wrong (weakening a contract), which must escalate to the PI rather than be fixed in-lane',
    },
    reasons: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const DOCS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['updated', 'files', 'summary'],
  properties: {
    updated: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const INTEGRATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mergedBranches', 'conflictsResolved', 'testStatus', 'summary'],
  properties: {
    mergedBranches: { type: 'array', items: { type: 'string' } },
    conflictsResolved: { type: 'array', items: { type: 'string' } },
    testStatus: { type: 'string', enum: ['green', 'red', 'no-tests'] },
    testOutput: { type: 'string' },
    commitRange: { type: 'string', description: 'e.g. abc123..def456 for the reporter to diff' },
    summary: { type: 'string' },
  },
}

const REPORT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['posted', 'slideCount', 'summary'],
  properties: {
    posted: { type: 'boolean' },
    httpStatus: { type: 'number' },
    briefingId: { type: ['number', 'string'] },
    slideCount: { type: 'number' },
    localCopy: { type: 'string', description: 'path to the saved briefing JSON' },
    summary: { type: 'string' },
  },
}

// ---------------------------------------------------------------------------
// 1. Plan
// ---------------------------------------------------------------------------
phase('Plan')
let specs = await agent(
  `${CONTEXT}

You are the PLANNER. Decompose the sprint goal into 3-6 concrete, non-overlapping work items.
For EACH item, write a spec file under specs/ following SPEC_TEMPLATE.md exactly (purpose,
acceptance criteria, target files, modules, data models, test cases). Keep items narrow and
genuinely parallel — two items must not edit the same file. Specs are the contract everything
downstream verifies against, so make acceptance criteria precise and testable.

Write the spec files to disk now, then return the structured list. Do not implement anything.`,
  { schema: SPECS_SCHEMA, model: 'sonnet', label: 'planner' }
)

// ---------------------------------------------------------------------------
// 2. Spec review (batch; up to 2 rounds). Cross-spec conflicts are the point.
// ---------------------------------------------------------------------------
phase('Spec review')
for (let round = 1; round <= MAX_SPEC_REVIEW_ROUNDS; round++) {
  const review = await agent(
    `${CONTEXT}

You are the SPEC REVIEWER. Use the spec-review skill — its conventions are authoritative. Review ALL of this sprint's specs
TOGETHER in one batch — check each spec internally (clear, testable acceptance criteria;
realistic target files) AND check the set against each other. The thing you must not miss:
overlapping file claims between items that will collide at merge. Read the actual spec files.

Specs under review:
${JSON.stringify(specs.items, null, 2)}

Return approved=true only if every spec is sound and the set is conflict-free.`,
    { schema: SPEC_REVIEW_SCHEMA, model: 'sonnet', label: `spec-review-r${round}` }
  )
  log(`Spec review round ${round}: ${review.approved ? 'approved' : `${review.crossSpecConflicts.length} conflicts, ${review.perSpecIssues.length} per-spec issues`}`)
  if (review.approved) break
  if (round === MAX_SPEC_REVIEW_ROUNDS) {
    log('Spec review cap reached — proceeding with current specs (residual issues go on the briefing).')
    break
  }
  specs = await agent(
    `${CONTEXT}

You are the PLANNER, revising after spec review. Rewrite the spec files on disk to resolve
every issue below, especially cross-spec file collisions (re-partition the work so no two items
edit the same file). Return the full revised item list.

Review feedback:
${JSON.stringify(review, null, 2)}

Current specs:
${JSON.stringify(specs.items, null, 2)}`,
    { schema: SPECS_SCHEMA, model: 'sonnet', label: `planner-revise-r${round}` }
  )
}

// ---------------------------------------------------------------------------
// 3-5. Work lanes — parallel per item, each in its own git worktree.
// build -> skeptic review (retry w/ objections, cap 2) -> docs. Each lane
// exits fully done, escalated, or unresolved.
// ---------------------------------------------------------------------------
phase('Work lanes')

async function runLane(item, i) {
  const branch = `sprint/${item.id}`
  const wt = `.worktrees/${item.id}`
  let objections = ''
  let lastReview = null

  for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
    const build = await agent(
      `${CONTEXT}

You are a BUILDER. Your whole world is ONE spec. Read it: ${item.specPath}.

Work in an ISOLATED git worktree so parallel lanes don't collide:
- On attempt 1, create it from repo root: \`git worktree add -b ${branch} ${wt} HEAD\`
  (if it already exists, just cd into ${wt}).
- Do ALL your work inside ${wt}. Implement the spec to satisfy every acceptance criterion,
  add the test cases the spec names, and commit on branch ${branch}.

${attempt > 1 ? `This is attempt ${attempt}. A reviewer REJECTED the previous attempt. Fix exactly these objections:\n${objections}\n` : ''}
Set escalateContractIssue=true ONLY if faithfully implementing this spec would weaken a
contract that is already implemented elsewhere — that is a PI decision; do not silently resolve it.`,
      { schema: BUILD_SCHEMA, label: `build:${item.id}:a${attempt}`, phase: 'Work lanes' }
    )

    if (build.escalateContractIssue) {
      return { id: item.id, title: item.title, branch, status: 'escalated', reason: build.escalationReason, build }
    }

    lastReview = await agent(
      `${CONTEXT}

You are an IMPLEMENTATION REVIEWER — a fresh-eyed skeptic. You did not write this code.
Read the spec ${item.specPath}, then diff the worktree ${wt} against it section by section
(\`git -C ${wt} diff HEAD~..HEAD\` or against base as appropriate) and run its tests inside ${wt}.

Return pass=true only if every acceptance criterion is genuinely met and tests pass.
If the failure is that the SPEC itself is wrong (it would weaken an implemented contract),
set specWrong=true — that escalates to the PI instead of being fixed in-lane.
Be specific in reasons; the builder will act on them verbatim.`,
      { schema: LANE_REVIEW_SCHEMA, model: 'sonnet', label: `review:${item.id}:a${attempt}`, phase: 'Work lanes' }
    )

    if (lastReview.specWrong) {
      return { id: item.id, title: item.title, branch, status: 'escalated', reason: lastReview.reasons.join('; '), build, review: lastReview }
    }
    if (lastReview.pass) {
      const docs = await agent(
        `${CONTEXT}

You are the DOCS MAINTAINER for this lane. Use the docs-maintainer skill — its conventions are authoritative. Inside worktree
${wt}, update docs/ to reflect the new CONFIRMED state from this item (spec ${item.specPath}):
rewrite stale sections, current state only, no history notes. Commit the docs change on ${branch}.`,
        { schema: DOCS_SCHEMA, model: 'sonnet', label: `docs:${item.id}`, phase: 'Work lanes' }
      )
      return { id: item.id, title: item.title, branch, status: 'done', build, review: lastReview, docs }
    }

    objections = lastReview.reasons.map((r, n) => `${n + 1}. ${r}`).join('\n')
    log(`Lane ${item.id}: attempt ${attempt} rejected — ${lastReview.reasons.length} objection(s)`)
  }

  return { id: item.id, title: item.title, branch, status: 'unresolved', objections, review: lastReview }
}

const lanes = (await parallel(specs.items.map((item, i) => () => runLane(item, i)))).filter(Boolean)
const done = lanes.filter((l) => l.status === 'done')
const escalated = lanes.filter((l) => l.status === 'escalated')
const unresolved = lanes.filter((l) => l.status === 'unresolved')
log(`Lanes complete: ${done.length} done, ${escalated.length} escalated, ${unresolved.length} unresolved`)

// ---------------------------------------------------------------------------
// 6. Integrate & test — merge the done lanes into main, loop tests to green.
// ---------------------------------------------------------------------------
phase('Integrate')
const integrate = await agent(
  `${CONTEXT}

You are INTEGRATION. From the repo root on the main branch, merge ONLY these branches that
passed review: ${JSON.stringify(done.map((l) => l.branch))}.
- Record the pre-merge HEAD, then merge each branch; resolve any conflicts (code AND docs).
- Run a docs consistency pass so merged docs/ don't contradict each other.
- Loop on the project's checks — \`npm run build\` and \`npm test\` if a test script exists —
  fixing failures until green, capped at 3 attempts. If there is no test script, report 'no-tests'.
- Clean up the merged worktrees: \`git worktree remove <path>\` for each.
- Return commitRange as <pre-merge-HEAD>..HEAD so the reporter can diff the sprint.

Do NOT merge escalated/unresolved branches: ${JSON.stringify([...escalated, ...unresolved].map((l) => l.branch))} — leave them for the PI.`,
  { schema: INTEGRATE_SCHEMA, label: 'integrate' }
)
log(`Integrate: ${integrate.mergedBranches.length} merged, tests ${integrate.testStatus}`)

// ---------------------------------------------------------------------------
// 7. Reporter — compile the briefing and POST it to the live meeting app.
// ---------------------------------------------------------------------------
phase('Report')
const sprintRecord = {
  goal,
  specs: specs.items,
  planSummary: specs.planSummary,
  lanes,
  integrate,
}

const report = await agent(
  `${CONTEXT}

You are the REPORTER. You prepare the briefing the agents present to their PI at the lab meeting.
Here is everything that happened this sprint (planner output, every lane's build/review/docs
including failed attempts, and integration/test results):

${JSON.stringify(sprintRecord, null, 2)}

Additionally read the real git history yourself: \`git log --oneline\` and the diff for
${integrate.commitRange || 'the recent commits'}.

Compose the briefing as slides that conform EXACTLY to the schema in CLAUDE.md. Requirements:
- One info slide per done item: spec-vs-implementation delta, terse bullets + a conversational
  narration field (this becomes the spoken script).
- A "docs changed" info slide summarizing doc updates.
- A QUESTION slide for every escalated item (${escalated.length}) and every unresolved item
  (${unresolved.length}) — these hard-gate the meeting; state precisely what you need from the PI.
- A final DECISION slide proposing concrete next steps (Approve | Redirect).
- Populate the artifacts payload (specDeltas, gitLog, diffs, testOutput, docsChanged,
  reviewerVerdicts) with REAL content — it grounds the Q&A agent.

Then:
1. Save a local copy to ./briefings/<sprintId>.json (mkdir -p briefings first). Demo evidence.
2. POST it to the live app. Read creds from .env at repo root:
   \`set -a; . ./.env; set +a\`
   then:
   \`curl -sS -o /tmp/brief_resp.json -w '%{http_code}' -X POST "$LAB_MEETING_URL/api/briefings" \
      -H "content-type: application/json" -H "authorization: Bearer $LAB_MEETING_TOKEN" \
      --data @./briefings/<sprintId>.json\`
   Capture the HTTP status and the returned briefingId. A 201 means the meeting was requested.
   Make EXACTLY ONE POST — if it returns 201 you are done, do not POST again (duplicates create duplicate meetings).

Return the structured result. If the POST did not return 201, set posted=false and explain in summary.`,
  { schema: REPORT_RESULT_SCHEMA, label: 'reporter' }
)

log(`Reporter: posted=${report.posted} status=${report.httpStatus ?? 'n/a'} briefingId=${report.briefingId ?? 'n/a'} slides=${report.slideCount}`)

return {
  goal,
  lanes: { done: done.length, escalated: escalated.length, unresolved: unresolved.length },
  testStatus: integrate.testStatus,
  briefing: report,
}
