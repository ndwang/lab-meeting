import { useState } from 'react';

// Page-gating state machine for the meeting view.
// info slides advance via continue(); question slides hard-gate until a
// non-empty answer(text); the terminal decision slide resolves via decide().
// All captured data lives in client state only.
export function useMeetingState(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [decision, setDecision] = useState(null);

  const lastIndex = list.length - 1;
  const currentSlide = list[currentIndex];

  function advance() {
    setCurrentIndex((i) => Math.min(i + 1, lastIndex));
  }

  function continueFn() {
    if (!currentSlide || currentSlide.type !== 'info') return;
    advance();
  }

  function answer(text) {
    if (!currentSlide || currentSlide.type !== 'question') return;
    if (typeof text !== 'string' || text.trim() === '') return;
    setAnswers((prev) => ({ ...prev, [currentIndex]: text }));
    advance();
  }

  function decide(outcome, direction) {
    if (!currentSlide || currentSlide.type !== 'decision') return;
    setDecision({ outcome, direction: direction ?? '' });
  }

  return {
    currentIndex,
    answers,
    decision,
    continue: continueFn,
    answer,
    decide,
  };
}
