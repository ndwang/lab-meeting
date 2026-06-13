import { useEffect, useRef, useState } from 'react';
import SlideStage from './SlideStage.jsx';
import QAPanel from './QAPanel.jsx';
import { useMeetingState } from './useMeetingState.js';

// How often the browser polls GET /api/minutes for the composed instruction
// while the host agent is composing. Hardcoded — not configurable.
const POLL_INTERVAL_MS = 2000;

// The meeting page. Owns the top-level data fetch for a single briefing, the
// loading/error states, and the meeting chrome (sprint name + goal). It hands
// the slides to the page-gating state machine (useMeetingState), renders the
// slide stage, and — when the human resolves the decision slide — drives the
// two-step handoff: it POSTs the human's direction to /api/minutes, polls until
// the host agent has composed the next instruction, shows that instruction in an
// editable textarea, and only enqueues the next sprint when the human approves.
export default function MeetingView({ id }) {
  // status: 'loading' | 'error' | 'ok'
  const [status, setStatus] = useState('loading');
  const [briefing, setBriefing] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setBriefing(null);

    fetch(`/api/briefings/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('not found');
        const data = await res.json();
        if (!data || !Array.isArray(data.slides)) {
          throw new Error('malformed briefing');
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setBriefing(data);
        setStatus('ok');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="wrap meeting">
      <header className="meeting-header">
        <a className="back" href="#/">← Back</a>
      </header>
      {status === 'loading' && <Loading />}
      {status === 'error' && <ErrorState />}
      {status === 'ok' && <Meeting briefing={briefing} briefingId={id} />}
    </main>
  );
}

function Loading() {
  return (
    <p className="loading" data-testid="loading">
      Loading…
    </p>
  );
}

function ErrorState() {
  return (
    <p className="error" data-testid="error">
      Briefing not found, or an error occurred loading it.
    </p>
  );
}

// Rendered only once the briefing has loaded so useMeetingState is always
// driven by a stable, present slides array.
//
// submitStatus drives the two-step decision handoff:
//   null            — no decision recorded yet (slide stage live)
//   'pending'       — POST /api/minutes in flight
//   'composing'     — minutes recorded; polling for the host-composed instruction
//   'composed'      — instruction composed; editable review + Approve & launch
//   'approving'     — POST /api/minutes/:id/approve in flight
//   'approved'      — next sprint queued (final confirmation)
//   'submit-error'  — POST /api/minutes failed; offer retry (stage stays live)
//   'approve-error' — POST /api/minutes/:id/approve failed; offer retry
function Meeting({ briefing, briefingId }) {
  const state = useMeetingState(briefing.slides);
  const [submitStatus, setSubmitStatus] = useState(null);
  const [minutesId, setMinutesId] = useState(null);
  const [composedRow, setComposedRow] = useState(null);
  const [approveGoal, setApproveGoal] = useState('');
  // Guards the POST against React StrictMode's double-invoke: set before the
  // fetch, cleared on cleanup, so exactly one POST is sent per decision.
  const submitted = useRef(false);

  // Step 1 — POST the human's direction to /api/minutes, then move to polling.
  useEffect(() => {
    if (!state.decision) return;
    if (submitStatus !== null) return;
    if (submitted.current) return;
    submitted.current = true;

    setSubmitStatus('pending');

    const answers = Object.entries(state.answers).map(([i, answer]) => ({
      title: briefing.slides[i]?.title ?? '',
      answer,
    }));

    fetch('/api/minutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        briefingId,
        outcome: state.decision.outcome,
        directive: state.decision.direction,
        answers,
      }),
    })
      .then(async (res) => {
        if (res.status !== 201) {
          setSubmitStatus('submit-error');
          return;
        }
        const body = await res.json();
        setMinutesId(body.minutesId);
        setSubmitStatus('composing');
      })
      .catch(() => {
        setSubmitStatus('submit-error');
      });

    return () => {
      submitted.current = false;
    };
  }, [state.decision, submitStatus, state.answers, briefing.slides, briefingId]);

  // Step 1b — poll GET /api/minutes?briefingId=N until the host agent has
  // composed the next instruction (the row's status flips to 'composed').
  // Transient poll failures are ignored so the interval keeps running; the
  // interval is always cleared on unmount or when we leave the composing state.
  useEffect(() => {
    if (submitStatus !== 'composing') return undefined;

    let active = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/minutes?briefingId=${briefingId}`);
        if (!res.ok) return;
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!active || !row || row.status !== 'composed') return;
        setComposedRow({
          composedGoal: row.composedGoal,
          composedMinutes: row.composedMinutes,
        });
        setApproveGoal(row.composedGoal ?? '');
        setSubmitStatus('composed');
      } catch {
        // Transient error — keep polling.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [submitStatus, briefingId]);

  // Step 2 — enqueue the next sprint with the (possibly edited) instruction.
  function handleApprove() {
    setSubmitStatus('approving');
    fetch(`/api/minutes/${minutesId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: approveGoal }),
    })
      .then((res) => {
        setSubmitStatus(res.status === 201 ? 'approved' : 'approve-error');
      })
      .catch(() => {
        setSubmitStatus('approve-error');
      });
  }

  // Retry Step 1 — clear the in-flight guard and reset the machine so the
  // submit effect fires again with the same decision.
  function retrySubmit() {
    submitted.current = false;
    setSubmitStatus(null);
  }

  if (submitStatus === 'approved') return <ConfirmedState />;

  if (submitStatus === 'pending' || submitStatus === 'composing') {
    return <ComposingState />;
  }

  if (
    submitStatus === 'composed' ||
    submitStatus === 'approving' ||
    submitStatus === 'approve-error'
  ) {
    return (
      <>
        <ComposeReview
          goal={approveGoal}
          minutes={composedRow?.composedMinutes}
          onGoalChange={setApproveGoal}
          onApprove={handleApprove}
          submitting={submitStatus === 'approving'}
        />
        {submitStatus === 'approve-error' && (
          <ApproveError onRetry={handleApprove} />
        )}
      </>
    );
  }

  return (
    <>
      <section className="sprint-header" data-testid="sprint-header">
        <h1 data-testid="sprint-id">{briefing.sprintId}</h1>
        <p className="goal" data-testid="goal">
          {briefing.goal}
        </p>
      </section>
      <div className="meeting-stage">
        <SlideStage
          slides={briefing.slides}
          currentIndex={state.currentIndex}
          answers={state.answers}
          onContinue={state.continue}
          onAnswer={state.answer}
          onDecide={state.decide}
        />
        <QAPanel briefingId={briefingId} />
      </div>
      {submitStatus === 'submit-error' && <SubmitError onRetry={retrySubmit} />}
    </>
  );
}

function ComposingState() {
  return (
    <div className="composing" data-testid="composing">
      Composing the next instruction…
    </div>
  );
}

// The product's central beat: the human sees exactly what the agent will work
// on next, can edit it, and explicitly approves before anything launches.
function ComposeReview({ goal, minutes, onGoalChange, onApprove, submitting }) {
  return (
    <section className="compose-review" data-testid="compose-review">
      <h2 className="compose-review-title">Here's what I'll work on next</h2>
      <textarea
        className="compose-goal"
        aria-label="Next sprint goal"
        value={goal}
        onChange={(e) => onGoalChange(e.target.value)}
      />
      {minutes && <pre className="compose-minutes">{minutes}</pre>}
      <button type="button" disabled={submitting} onClick={onApprove}>
        Approve &amp; launch
      </button>
    </section>
  );
}

function ConfirmedState() {
  return (
    <div className="minutes-confirmed" data-testid="minutes-confirmed">
      Next sprint queued
    </div>
  );
}

function SubmitError({ onRetry }) {
  return (
    <div className="minutes-error" data-testid="minutes-error">
      Failed to record minutes.{' '}
      <button type="button" data-testid="minutes-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function ApproveError({ onRetry }) {
  return (
    <div className="approve-error" data-testid="approve-error">
      Failed to queue the next sprint.{' '}
      <button type="button" data-testid="approve-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
