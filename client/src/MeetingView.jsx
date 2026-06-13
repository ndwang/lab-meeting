import { useEffect, useRef, useState } from 'react';
import SlideStage from './SlideStage.jsx';
import QAPanel from './QAPanel.jsx';
import { useMeetingState } from './useMeetingState.js';

// The meeting page. Owns the top-level data fetch for a single briefing, the
// loading/error states, and the meeting chrome (sprint name + goal). It hands
// the slides to the page-gating state machine (useMeetingState), renders the
// slide stage, and — when the human resolves the decision slide — POSTs the
// minutes to the server, which records them and queues the next sprint.
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
// submitStatus: null | 'pending' | 'confirmed' | 'error'
//   null      — no decision recorded yet (controls live)
//   'pending' — POST in flight (controls hidden)
//   'confirmed' — server recorded the minutes (stage replaced by confirmation)
//   'error'   — POST failed; controls live again so the human can retry
function Meeting({ briefing, briefingId }) {
  const state = useMeetingState(briefing.slides);
  const [submitStatus, setSubmitStatus] = useState(null);
  // Guards the POST against React StrictMode's double-invoke: set before the
  // fetch, cleared on cleanup, so exactly one POST is sent per decision.
  const submitted = useRef(false);

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
      .then((res) => {
        setSubmitStatus(res.status === 201 ? 'confirmed' : 'error');
      })
      .catch(() => {
        setSubmitStatus('error');
      });

    return () => {
      submitted.current = false;
    };
  }, [state.decision, submitStatus, state.answers, briefing.slides, briefingId]);

  if (submitStatus === 'confirmed') return <ConfirmedState />;

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
      {submitStatus === 'error' && (
        <SubmitError onRetry={() => setSubmitStatus(null)} />
      )}
    </>
  );
}

function ConfirmedState() {
  return (
    <div className="minutes-confirmed" data-testid="minutes-confirmed">
      Minutes recorded · next sprint queued
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
