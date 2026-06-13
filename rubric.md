# rubric.md — how to grade a Lab Meeting sprint (model-verifiable)

This file is the contract the orchestration grades itself against. The event asks: *is "done"
verifiable by the model without a human — a test suite, a responding URL, a rubric file?* Yes:
the integrate/test phase and the implementation reviewer check work against this rubric and the
per-item specs before a briefing is ever produced.

## Per-item acceptance (the implementation reviewer applies this to each work lane)

A work item is **done** only if all hold:

1. **Spec satisfied.** Every acceptance criterion in the item's spec (`SPEC_TEMPLATE.md` format)
   is met. The reviewer diffs the worktree against the spec section by section.
2. **Tests pass.** The item's stated test cases exist and pass. No skipped/`.only` tests.
3. **No contract drift.** If the implementation weakens an already-implemented contract, it is
   NOT resolved in-lane — it escalates to a question slide (contract changes are PI decisions).
4. **Docs current.** `docs/` reflects the new confirmed state (current state only, no history),
   per the `docs-maintainer` skill.
5. **Scoped.** The item touches only the files its spec claims. Cross-item file collisions are a
   spec-review failure, not a merge surprise.

## Sprint-level acceptance (integrate/test phase)

- All work lanes merged; conflicts resolved; docs consistent (no contradictions across items).
- **The test suite is green** (or the unresolved items are explicitly flagged as question slides).
- **The deployed URL responds:** `GET /api/health` returns `{ ok: true }`.
- A briefing JSON validating against the schema in `CLAUDE.md` was POSTed to `/api/briefings`
  and is readable back via `GET /api/briefings/:id`.

## Product-level acceptance (what makes the demo real)

- A briefing posted by a sprint renders in the live app as a page-gated meeting.
- A decision slide accepts Approve / Redirect; a Redirect writes minutes and the slide edits live.
- Minutes from one meeting are injected into the next sprint (loop closed).
- Q&A answers are grounded in the briefing's `artifacts` payload, including honest
  "that wasn't tested" answers.

## Repeatability (the orchestration claim)

Another team should be able to rerun this tomorrow on a new problem: save `/sprint`, point it at
a goal + the latest minutes, and the same plan→review→build→verify→report→meet loop runs. The
template is the deliverable, not any single sprint's output.
