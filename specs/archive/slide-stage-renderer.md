# Slide Stage Renderer

<!-- One spec per work item. Written by the planner, reviewed in batch by the spec reviewer,
     implemented by one builder in an isolated worktree. -->

## Overview
- Purpose: Build the `SlideStage` component that renders a single slide at a time — title, content bullets, and narration text — together with the slide-specific controls (Continue button, answer input, or decision actions) driven by the page-gating state machine hook.
- Background: The meeting view renders one slide at a time, page-gated. The slide schema has three types: `info`, `question`, and `decision`. Each type has the same title/content/narration fields but different controls. The page-gating state machine (`useMeetingState`) is built by a separate work item and is treated as a dependency here (the `SlideStage` component receives its state and callbacks as props).
- Deliverables: `client/src/SlideStage.jsx` — a purely presentational-ish component that receives the current slide, the slide index, the total count, the current answer state, and callbacks for advancing, answering, and deciding.

## Requirements
- Goal / deliverables: Render the current slide's title, content bullets, and narration; display the correct controls for each slide type; show a progress indicator.
- MVP:
  - Title rendered in a large heading.
  - Content bullets rendered as a `<ul>` list.
  - Narration rendered in a visually distinct block (presenter script).
  - Progress indicator "Slide N of M" visible at all times.
  - `info` slide: "Continue" button that calls `onContinue()`.
  - `question` slide: `<textarea>` for the answer + "Submit" button disabled until the textarea is non-empty; calls `onAnswer(text)`.
  - `decision` slide: direction `<textarea>` + "Approve" button (calls `onDecide('approve', '')`) + "Redirect" button (calls `onDecide('redirect', directionText)`); "Redirect" is disabled when the textarea is empty.
- Non-goals: Animations or slide transitions; voice/TTS; avatar tiles; any fetch calls; persisting state.
- Acceptance criteria:
  1. `SlideStage` renders a progress indicator with text matching `/Slide \d+ of \d+/`.
  2. For an `info` slide, a button with text "Continue" is rendered; clicking it calls `onContinue`.
  3. For a `question` slide, a `<textarea>` and a "Submit" button are rendered; the "Submit" button has `disabled` attribute when the textarea is empty; clicking "Submit" with non-empty text calls `onAnswer` with the trimmed text.
  4. For a `decision` slide, "Approve" and "Redirect" buttons are rendered; "Redirect" is disabled when its textarea is empty; clicking "Approve" calls `onDecide('approve', '')`.
  5. The slide `title` is rendered in an element with `data-testid="slide-title"`.
  6. The slide `content` bullets are rendered as `<li>` elements inside an element with `data-testid="slide-content"`.
  7. The `narration` text is rendered in an element with `data-testid="slide-narration"`.
  8. `SlideStage` accepts props: `slides` (array), `currentIndex` (number), `answers` (object), `onContinue` (fn), `onAnswer` (fn), `onDecide` (fn).
- Constraints / risks: Component must be pure/presentational — no internal fetch, no `useEffect` for data loading. Internal state is limited to the controlled `<textarea>` value(s) (local UI state only).

## Design

### Target Files
- Add:
  - `client/src/SlideStage.jsx` - slide rendering component with per-type controls

### Modules, Classes, And Functions
- Module: `client/src/SlideStage.jsx` - slide presenter component
  - Function: `SlideStage({ slides, currentIndex, answers, onContinue, onAnswer, onDecide })` — React component
  - Responsibility: Derives `currentSlide = slides[currentIndex]`; renders title, bullets, narration; renders controls based on `currentSlide.type`; shows progress indicator.
  - Input/output: Props as listed; renders DOM. Calls `onContinue()`, `onAnswer(text)`, or `onDecide(outcome, direction)` in response to user interaction.
  - Dependencies: `useState` from React (for textarea controlled values only).

- Function: `InfoControls({ onContinue })` — inline sub-component or JSX block
  - Responsibility: Renders the "Continue" button for `info` slides.

- Function: `QuestionControls({ onAnswer })` — inline sub-component or JSX block
  - Responsibility: Manages local textarea state, validates non-empty, calls `onAnswer`.

- Function: `DecisionControls({ onDecide })` — inline sub-component or JSX block
  - Responsibility: Manages local direction textarea state; renders Approve and Redirect buttons.

### Data Models
- Model: `Slide` - one element of the `slides` array (passed from the briefing)
  - Fields:
    - `type: 'info' | 'question' | 'decision'` - controls which control set is shown
    - `title: string` - shown in heading
    - `content: string[]` - shown as bullet list
    - `narration: string` - shown as presenter script block
  - Validation: If `type` is unrecognised, render only title/content/narration with no action controls and log a console.warn.

### Errors And Exceptions
- Error: `slides` array is empty or `currentIndex` is out of bounds — render a placeholder "No slide" message without crashing.
- Error: Unrecognised `slide.type` — render slide content only, no controls; emit `console.warn`.

## Test Cases
- Normal: `info` slide renders title, bullets, narration, and "Continue" button.
- Normal: `question` slide renders title, "Submit" button disabled initially; non-empty input enables "Submit"; clicking calls `onAnswer`.
- Normal: `decision` slide renders "Approve" and "Redirect" buttons; "Redirect" disabled when textarea empty; clicking "Approve" calls `onDecide('approve', '')`.
- Normal: Progress indicator shows "Slide 2 of 4" when `currentIndex=1` and `slides.length=4`.
- Boundary: `slides=[]` or `currentIndex` out of range → renders placeholder, no crash.
- Boundary: `content` is an empty array → `<ul>` is rendered with zero `<li>` items, no crash.
- Boundary: Unrecognised `type` → title/content/narration rendered, no controls.

## Verification
- Commands: `cd client && npx vitest run` passes all SlideStage tests.
- Manual checks: Load the meeting view in the browser with sprint-1.json; verify each slide type renders its controls; verify the progress counter increments.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
