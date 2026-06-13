import { useCallback, useEffect, useRef, useState } from 'react';

// Polling cadence for GET /api/qa?briefingId=N. The spec requires no faster
// than 3 seconds.
const POLL_INTERVAL_MS = 3000;

// The live Q&A aside. Renders alongside the slide stage during a meeting: the
// human types a follow-up, the browser POSTs it (no token — browser-facing),
// and then polls the thread until the host agent (spawned by the local
// attendant daemon, out of scope here) posts an answer. This component never
// touches the slide-gating flow; it only reads/writes the Q&A channel.
//
// submitStatus: 'idle' | 'pending' | 'error'
//   'idle'    — form is live and ready for input
//   'pending' — POST in flight (submit disabled)
//   'error'   — POST failed; the form is live again so the human can retry
export default function QAPanel({ briefingId }) {
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]);
  const [submitStatus, setSubmitStatus] = useState('idle');

  // Whether at least one question is still awaiting an answer. Drives the
  // polling loop: poll while anything is unanswered, stop once all answered.
  const hasUnanswered = thread.some((item) => item.status !== 'answered');

  const refreshThread = useCallback(async () => {
    try {
      const res = await fetch(`/api/qa?briefingId=${briefingId}`);
      if (!res.ok) return; // poll failures are silent — keep polling
      const data = await res.json();
      if (Array.isArray(data)) setThread(data);
    } catch {
      // Network blip — swallow and let the next tick retry.
    }
  }, [briefingId]);

  // Poll the thread on a fixed interval whenever a question is outstanding.
  // The interval is cleared on unmount and whenever everything is answered.
  useEffect(() => {
    if (!hasUnanswered) return undefined;
    const timer = setInterval(refreshThread, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasUnanswered, refreshThread]);

  const onSubmit = useCallback(
    async (event) => {
      event.preventDefault();
      const text = question.trim();
      if (text === '' || submitStatus === 'pending') return;

      setSubmitStatus('pending');
      try {
        const res = await fetch('/api/qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ briefingId, question: text }),
        });
        if (!res.ok) throw new Error('post failed');
        const { questionId } = await res.json();
        // Optimistically add the question so it shows pending immediately; the
        // poll will reconcile it (and the rest of the thread) once it answers.
        setThread((prev) => [
          ...prev,
          { id: questionId, question: text, answer: null, status: 'pending' },
        ]);
        setQuestion('');
        setSubmitStatus('idle');
      } catch {
        setSubmitStatus('error');
      }
    },
    [question, submitStatus, briefingId],
  );

  return (
    <section className="qa-panel" data-testid="qa-panel">
      <h2>Ask a follow-up</h2>
      <ul className="qa-thread" data-testid="qa-thread">
        {thread.map((item) => (
          <QAItem key={item.id} item={item} />
        ))}
      </ul>
      <form className="qa-form" onSubmit={onSubmit}>
        <textarea
          data-testid="qa-input"
          aria-label="Ask a follow-up"
          placeholder="Ask the engineer a follow-up…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="submit"
          data-testid="qa-submit"
          disabled={submitStatus === 'pending' || question.trim() === ''}
        >
          {submitStatus === 'pending' ? 'Sending…' : 'Ask'}
        </button>
      </form>
      {submitStatus === 'error' && (
        <p className="qa-error" data-testid="qa-error">
          Could not send your question. Please try again.
        </p>
      )}
    </section>
  );
}

function QAItem({ item }) {
  const answered = item.status === 'answered' && item.answer != null;
  return (
    <li className="qa-item" data-testid="qa-item">
      <div className="qa-question">
        <span className="qa-author qa-author-you">You</span>
        <p>{item.question}</p>
      </div>
      {answered ? (
        <div className="qa-answer" data-testid="qa-answer">
          <span className="qa-author qa-author-agent">Claude — Engineer</span>
          <p>{item.answer}</p>
        </div>
      ) : (
        <div className="qa-pending" data-testid="qa-pending">
          pending — bringing in the engineer…
        </div>
      )}
    </li>
  );
}
