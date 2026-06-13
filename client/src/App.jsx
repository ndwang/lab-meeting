import { useEffect, useState } from 'react';

// Landing list. Proves the live URL is up and the ingest contract works end to
// end: any briefing POSTed to /api/briefings shows up here. Each row links to
// its meeting view at #/meeting/:id (hash routing — see Router.jsx).
export default function BriefingList() {
  const [health, setHealth] = useState(null);
  const [briefings, setBriefings] = useState([]);

  async function refresh() {
    const [h, b] = await Promise.all([
      fetch('/api/health').then((r) => r.json()).catch(() => null),
      fetch('/api/briefings').then((r) => r.json()).catch(() => ({ briefings: [] })),
    ]);
    setHealth(h);
    setBriefings(b.briefings ?? []);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="wrap">
      <header>
        <span className="rec" /> Lab Meeting
        <small>{health?.ok ? 'live' : 'connecting…'}</small>
      </header>

      <p className="tagline">
        A human-in-the-loop layer for long-horizon agents. Your agents prepare a
        briefing after each sprint and present it to you, their PI.
      </p>

      <section>
        <h2>Briefings ({briefings.length})</h2>
        {briefings.length === 0 ? (
          <p className="empty">
            No briefings yet. The first meeting is held in a text file; every
            meeting after is held here. Waiting for a sprint to report in…
          </p>
        ) : (
          <ul>
            {briefings.map((b) => (
              <li key={b.id}>
                <a href={`#/meeting/${b.id}`}>
                  <strong>{b.sprint_id || `briefing-${b.id}`}</strong>
                  <span>{b.goal || 'untitled'}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
