import { useEffect, useState } from 'react';

// Hello-world shell. Proves the live URL is up and the ingest contract works
// end to end: any briefing POSTed to /api/briefings shows up in this list.
// Sprint 1 replaces this with the Zoom-style meeting + slide stage.
export default function App() {
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
        <small>{health ? `live · ${health.storage}` : 'connecting…'}</small>
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
                <strong>{b.sprint_id || `briefing-${b.id}`}</strong>
                <span>{b.goal || 'untitled'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
