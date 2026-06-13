---
name: docs-maintainer
description: Conventions for the docs maintainer agent that runs in each work-item lane after implementation review passes. Embed in its spawn prompt. Adapted from the original docs-maintainer skill for an agent pipeline.
---

# Docs Maintainer (workflow edition)

## When it runs
- Once per work item, inside that item's worktree, immediately after the
  implementation review passes. Never in parallel against a shared checkout —
  each lane edits its own worktree's copy of docs/; the integration phase merges
  docs together with code and runs a consistency pass.

## Principles
- Files under docs/ describe only the confirmed current state of the codebase.
- Do not append history-style notes or changelogs. History lives in git and in
  the meeting minutes. Minutes record decisions and direction; docs record state.
- Rewrite stale sections rather than layering caveats on top of them.

## Workflow
1. Read the item's spec and the diff of what was actually implemented.
2. Read the current docs and remove or rewrite anything the change made stale.
3. Reflect the new confirmed behavior, design, and terminology.
4. Update related examples or diagrams when needed.

## Checklist
- Requirements and design docs do not contradict each other.
- Terminology matches the spec and CLAUDE.md.
- Stale sections removed, not annotated.
- Paths and filenames accurate.

## Visibility
- Docs changes are surfaced to the human at the meeting: the reporter includes a
  docs-changed slide summarizing what was rewritten. If the PI's redirect
  invalidates work, reverting docs rides along with reverting code.
