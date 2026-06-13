import { useEffect, useState } from 'react';
import SlideStage from './SlideStage.jsx';
import { useMeetingState } from './useMeetingState.js';

// The meeting page. Owns the top-level data fetch for a single briefing, the
// loading/error states, and the meeting chrome (sprint name + goal). It hands
// the slides to the page-gating state machine (useMeetingState) and renders the
// slide stage. No writes, no polling — answers and the decision live in client
// state only (this sprint).
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
      {status === 'ok' && <Meeting briefing={briefing} />}
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
function Meeting({ briefing }) {
  const state = useMeetingState(briefing.slides);

  return (
    <>
      <section className="sprint-header" data-testid="sprint-header">
        <h1 data-testid="sprint-id">{briefing.sprintId}</h1>
        <p className="goal" data-testid="goal">
          {briefing.goal}
        </p>
      </section>
      <SlideStage
        slides={briefing.slides}
        currentIndex={state.currentIndex}
        answers={state.answers}
        onContinue={state.continue}
        onAnswer={state.answer}
        onDecide={state.decide}
      />
    </>
  );
}
