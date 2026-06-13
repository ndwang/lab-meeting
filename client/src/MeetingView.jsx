import { useEffect, useState } from 'react';

// Meeting view shell. The Router dispatches here for #/meeting/:id and passes
// the parsed integer id. This lane owns routing only: it fetches the briefing
// for the given id and renders a minimal stage so the route is verifiable end
// to end. The full page-gated slide stage is layered in by the meeting-view
// and slide-stage lanes at integration.
export default function MeetingView({ id }) {
  const [briefing, setBriefing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/briefings/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setBriefing(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main className="wrap">
        <p className="empty">Could not load briefing {id}: {error}</p>
      </main>
    );
  }

  if (!briefing) {
    return (
      <main className="wrap">
        <p className="empty">Loading briefing {id}…</p>
      </main>
    );
  }

  const slides = briefing.slides ?? [];

  return (
    <main className="wrap">
      <header>
        <span className="rec" /> Meeting
        <small>{briefing.sprint_id || briefing.sprintId || `briefing-${id}`}</small>
      </header>
      <h2>{briefing.goal || 'untitled'}</h2>
      <p className="empty">{slides.length} slide{slides.length === 1 ? '' : 's'}</p>
    </main>
  );
}
