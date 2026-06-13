---
name: spec-review
description: Review conventions for the sprint workflow. Embed in the spec reviewer and implementation reviewer spawn prompts. Adapted from spec-lifecycle-guard for an agent pipeline.
---

# Spec Review Conventions

## Spec review (phase 2, before any building)
- One reviewer agent critiques ALL of the sprint's specs in a single batch.
- Check each spec internally: acceptance criteria are concrete and testable, target
  files are complete, data models are unambiguous, test cases cover normal, error,
  and boundary paths.
- Check the set against each other: flag any two specs that claim the same files or
  modules — builders work in isolated worktrees and will not discover the collision
  until merge. Overlap must be resolved before the fan-out.
- The planner revises on feedback. Maximum two review rounds; then the workflow
  proceeds with remaining concerns recorded for the reporter.

## Implementation review (phase 4, per work item, in the item's worktree)
- Fresh agent, skeptic persona. Never the builder reviewing its own work.
- Walk the spec section by section — acceptance criteria, target files, modules,
  data models, error handling, test cases — and report conformance or deviation
  per section. Run the spec's Verification commands.
- On fail, return concrete objections; the builder retries with objections attached.
  Maximum two retries; then the item is flagged unresolved. Unresolved items become
  question slides in the briefing — that is a valid outcome, not a failure.

## Contract changes are PI decisions
- If review feedback suggests the SPEC was wrong — i.e., weakening or changing an
  already implemented contract — do not resolve it in the lane. Do not edit the spec,
  do not have the builder "fix" code to a new interpretation. Record the tradeoff and
  escalate it as a question slide for the meeting.
