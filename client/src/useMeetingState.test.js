import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { useMeetingState } from './useMeetingState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const briefing = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../briefings/sprint-1.json'), 'utf8'),
);

// A hand-built fixture matching the spec's canonical example.
const SLIDES = [
  { type: 'info', title: 'A' },
  { type: 'question', title: 'B' },
  { type: 'info', title: 'C' },
  { type: 'decision', title: 'D' },
];

describe('useMeetingState — return shape', () => {
  it('returns currentIndex, answers, decision, continue, answer, decide', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.answers).toEqual({});
    expect(result.current.decision).toBeNull();
    expect(typeof result.current.continue).toBe('function');
    expect(typeof result.current.answer).toBe('function');
    expect(typeof result.current.decide).toBe('function');
  });
});

describe('useMeetingState — normal progression', () => {
  it('continue() on an info slide increments currentIndex by 1', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(1);
  });

  it('answer(text) on a question slide records the answer and advances', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue()); // 0 -> 1 (question)
    act(() => result.current.answer('my answer'));
    expect(result.current.answers).toEqual({ 1: 'my answer' });
    expect(result.current.currentIndex).toBe(2);
  });

  it('continue() on the second info slide advances toward the decision', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue());
    act(() => result.current.answer('x'));
    act(() => result.current.continue()); // 2 (info) -> 3 (decision)
    expect(result.current.currentIndex).toBe(3);
  });

  it('decide(approve, "") on the decision slide records outcome and does not advance', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue());
    act(() => result.current.answer('x'));
    act(() => result.current.continue());
    act(() => result.current.decide('approve', ''));
    expect(result.current.decision).toEqual({ outcome: 'approve', direction: '' });
    expect(result.current.currentIndex).toBe(3);
  });
});

describe('useMeetingState — gates', () => {
  it('continue() on a question slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue()); // -> 1 (question)
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(1);
  });

  it('continue() on the decision slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue());
    act(() => result.current.answer('x'));
    act(() => result.current.continue()); // -> 3 (decision)
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(3);
  });

  it('answer("") on a question slide is a no-op (no record, no advance)', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue()); // -> 1 (question)
    act(() => result.current.answer(''));
    expect(result.current.answers).toEqual({});
    expect(result.current.currentIndex).toBe(1);
  });

  it('answer("   ") on a question slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue());
    act(() => result.current.answer('   '));
    expect(result.current.answers).toEqual({});
    expect(result.current.currentIndex).toBe(1);
  });

  it('answer("x") on an info slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.answer('x')); // index 0 is info
    expect(result.current.answers).toEqual({});
    expect(result.current.currentIndex).toBe(0);
  });

  it('decide(...) on an info slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.decide('approve', '')); // index 0 is info
    expect(result.current.decision).toBeNull();
    expect(result.current.currentIndex).toBe(0);
  });
});

describe('useMeetingState — boundaries', () => {
  it('continue() at the last slide is clamped', () => {
    const slides = [{ type: 'info' }, { type: 'info' }];
    const { result } = renderHook(() => useMeetingState(slides));
    act(() => result.current.continue()); // -> 1
    act(() => result.current.continue()); // clamped at 1
    expect(result.current.currentIndex).toBe(1);
  });

  it('empty slides — all actions are no-ops and nothing crashes', () => {
    const { result } = renderHook(() => useMeetingState([]));
    act(() => result.current.continue());
    act(() => result.current.answer('x'));
    act(() => result.current.decide('approve', ''));
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.answers).toEqual({});
    expect(result.current.decision).toBeNull();
  });

  it('undefined slides — does not crash', () => {
    const { result } = renderHook(() => useMeetingState(undefined));
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(0);
  });
});

describe('useMeetingState — regression', () => {
  it('answers for different question slides are stored independently by index', () => {
    const slides = [
      { type: 'question' },
      { type: 'question' },
      { type: 'info' },
    ];
    const { result } = renderHook(() => useMeetingState(slides));
    act(() => result.current.answer('first'));
    act(() => result.current.answer('second'));
    expect(result.current.answers).toEqual({ 0: 'first', 1: 'second' });
    expect(result.current.currentIndex).toBe(2);
  });

  it('decide(redirect, "focus on X") stores direction correctly', () => {
    const { result } = renderHook(() => useMeetingState(SLIDES));
    act(() => result.current.continue());
    act(() => result.current.answer('x'));
    act(() => result.current.continue());
    act(() => result.current.decide('redirect', 'focus on X'));
    expect(result.current.decision).toEqual({
      outcome: 'redirect',
      direction: 'focus on X',
    });
  });
});

describe('useMeetingState — drives the real sprint-1.json briefing', () => {
  it('walks info → info → info → decision, then resolves the decision terminally', () => {
    const { result } = renderHook(() => useMeetingState(briefing.slides));
    const lastIndex = briefing.slides.length - 1;
    expect(briefing.slides[lastIndex].type).toBe('decision');

    // Advance through every leading info slide.
    for (let i = 0; i < lastIndex; i += 1) {
      expect(briefing.slides[i].type).toBe('info');
      act(() => result.current.continue());
    }
    expect(result.current.currentIndex).toBe(lastIndex);

    // continue() is a no-op on the terminal decision slide.
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(lastIndex);

    // Resolving the decision records state without advancing.
    act(() => result.current.decide('approve', ''));
    expect(result.current.decision).toEqual({ outcome: 'approve', direction: '' });
    expect(result.current.currentIndex).toBe(lastIndex);
  });
});
