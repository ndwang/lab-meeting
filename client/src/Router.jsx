import { useEffect, useState } from 'react';
import BriefingList from './App.jsx';
import MeetingView from './MeetingView.jsx';

// Lightweight hash-based router. Two routes:
//   #/ (or empty)      → landing list (BriefingList)
//   #/meeting/:id      → meeting view (MeetingView), id parsed as an integer
// Hash routing needs no server changes and no router dependency. Parsing is
// defensive: an unrecognised hash falls through to the landing list, and a
// #/meeting/:id with a non-integer id redirects to #/.

// Parse the current hash into a route descriptor.
// Returns { name: 'list' } or { name: 'meeting', id } or null (= bad meeting id).
function parseHash(hash) {
  // Normalise: strip a single leading '#'. '', '#', '#/' all mean the list.
  const path = hash.replace(/^#/, '');
  const match = path.match(/^\/meeting\/(.+)$/);
  if (!match) return { name: 'list' };

  const id = Number(match[1]);
  if (!Number.isInteger(id)) return null; // signal: redirect to #/
  return { name: 'meeting', id };
}

export default function Router() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = parseHash(hash);

  // Non-integer meeting id: redirect to the list. Render the list this pass;
  // setting location.hash will fire hashchange and re-render cleanly.
  if (route === null) {
    if (window.location.hash !== '#/') window.location.hash = '#/';
    return <BriefingList />;
  }

  if (route.name === 'meeting') {
    return (
      <>
        <a className="back" href="#/">← Back to briefings</a>
        <MeetingView id={route.id} />
      </>
    );
  }

  return <BriefingList />;
}
