import { useState, useCallback } from 'react';

/**
 * Page-gating state machine for a page-gated, Zoom-style meeting.
 *
 * Drives slide progression based on each slide's `type`:
 *  - `info`     advances freely via `continue()`.
 *  - `question` is hard-gated: `answer(text)` records a non-empty answer and advances.
 *  - `decision` is terminal: `decide(outcome, direction)` records the outcome and
 *               does NOT advance the index (the decision slide closes the meeting).
 *
 * All captured data (answers, decision) lives in client state only — no server writes.
 *
 * @param {Array<{ type: 'info'|'question'|'decision' }>} slides
 * @returns {{
 *   currentIndex: number,
 *   answers: Record<number, string>,
 *   decision: null | { outcome: 'approve'|'redirect', direction: string },
 *   continue: () => void,
 *   answer: (text: string) => void,
 *   decide: (outcome: string, direction: string) => void,
 * }}
 */
export function useMeetingState(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const lastIndex = list.length - 1;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [decision, setDecision] = useState(null);

  const advance = useCallback(
    (index) => Math.min(index + 1, lastIndex),
    [lastIndex],
  );

  const continueFn = useCallback(() => {
    if (list[currentIndex]?.type !== 'info') return;
    setCurrentIndex((index) => advance(index));
  }, [list, currentIndex, advance]);

  const answerFn = useCallback(
    (text) => {
      if (typeof text !== 'string' || text.trim() === '') return;
      if (list[currentIndex]?.type !== 'question') return;
      setAnswers((prev) => ({ ...prev, [currentIndex]: text }));
      setCurrentIndex((index) => advance(index));
    },
    [list, currentIndex, advance],
  );

  const decideFn = useCallback(
    (outcome, direction = '') => {
      if (list[currentIndex]?.type !== 'decision') return;
      setDecision({ outcome, direction });
      // The decision slide is terminal — currentIndex is intentionally unchanged.
    },
    [list, currentIndex],
  );

  return {
    currentIndex,
    answers,
    decision,
    continue: continueFn,
    answer: answerFn,
    decide: decideFn,
  };
}
