# README.md — Architecture at a Glance subsection

<!-- Trimmed for the Lab Meeting sprint workflow. One spec per work item, written by the
planner, reviewed in batch by the spec reviewer (max two rounds), implemented by one
builder in an isolated worktree, verified section-by-section by the implementation
reviewer. Completed specs move to specs/archive/ — do not delete during the event. -->

## Overview
- Purpose: Add a concise "Architecture at a glance" subsection to README.md that summarizes the two systems (local `/sprint` runner + deployed meeting app) and the full HTTP control loop so a reader can understand how the loop closes in one reading.
- Background: The existing README.md has a brief "Architecture" section with three bullet points, but it does not show how the HTTP control loop closes end-to-end (briefing POST → meeting → minutes POST → next-sprint GET → poll.mjs launches next sprint). This makes it hard for a new reader to grasp the system at a glance.
- Deliverables: A new "Architecture at a glance" subsection inserted into the existing "Architecture" section of README.md. No code, config, or test changes.

## Requirements
- Goal / deliverables: Insert a subsection "### Architecture at a glance" inside the existing "## Architecture" section. The subsection must describe both systems and the HTTP control loop in 10 lines or fewer (including the ASCII/text diagram).
- MVP: The subsection renders correctly in GitHub Markdown, includes both systems, and traces the full control loop through all five steps listed in the sprint goal.
- Non-goals: Do not change any code, configuration, tests, or other documentation files. Do not alter the existing bullet points in the "Architecture" section — only add the new subsection below them.
- Acceptance criteria:
  1. `README.md` contains a `### Architecture at a glance` heading.
  2. The subsection names both systems: the local `/sprint` runner and the deployed meeting app.
  3. The subsection shows the five-step control loop in order: `POST /api/briefings` → meeting → `POST /api/minutes` → `GET /api/next-sprint` → `poll.mjs` launches the next sprint.
  4. The subsection is 10 lines of prose/diagram or fewer (blank lines excluded).
  5. No other file is modified.
  6. The existing "## Architecture" bullet points are unchanged.
- Constraints / risks: This is a docs-only change. There is no risk of breaking the app. Keep the language tight — the goal is "at a glance", not a full explanation.

## Design

### Target Files
- Update:
  - `README.md` - add "### Architecture at a glance" subsection inside the existing "## Architecture" section

### Modules, Classes, And Functions
- N/A (docs-only change)

### Data Models
- N/A

### Errors And Exceptions
- N/A

## Test Cases
- Normal: README.md renders in GitHub Markdown without syntax errors; the new heading appears in the table of contents (if one exists) and links correctly.
- Error: N/A — static document; no runtime errors possible.
- Boundary: Subsection must stay at or under 10 non-blank lines; verify by counting lines after editing.

## Verification
- Commands:
  - `grep -n "Architecture at a glance" README.md` — confirms heading is present.
  - `grep -n "POST /api/briefings\|POST /api/minutes\|GET /api/next-sprint\|poll.mjs" README.md` — confirms all five loop steps are mentioned.
  - `git diff --name-only` — confirms only `README.md` was touched.
- Manual checks:
  - Read the subsection aloud; it should take under 30 seconds to understand the full loop.
  - Verify the existing "Architecture" bullet points are identical to the original.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
