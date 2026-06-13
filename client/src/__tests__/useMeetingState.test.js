import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMeetingState } from '../useMeetingState.js';
import sprint1 from '../../../briefings/sprint-1.json';

const slides = sprint1.slides;
// sprint-1 fixture has no question slide, so synthesize a mixed deck for the
// question-gating tests while still anchoring the info/decision tests on the fixture.
const mixed = [
  { type: 'info', title: 'i0', content: [], narration: '' },
  { type: 'question', title: 'q1', content: [], narration: '' },
  { type: 'info', title: 'i2', content: [], narration: '' },
  { type: 'decision', title: 'd3', content: [], narration: '' },
];

describe('useMeetingState', () => {
  it('continue() on an info slide advances the index', () => {
    const { result } = renderHook(() => useMeetingState(slides));
    expect(slides[0].type).toBe('info');
    expect(result.current.currentIndex).toBe(0);
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(1);
  });

  it('answer(text) on a question slide records the answer and advances', () => {
    const { result } = renderHook(() => useMeetingState(mixed));
    act(() => result.current.continue()); // 0 info -> 1 question
    act(() => result.current.answer('great work'));
    expect(result.current.answers[1]).toBe('great work');
    expect(result.current.currentIndex).toBe(2);
  });

  it('answer("") is a no-op (no record, no advance)', () => {
    const { result } = renderHook(() => useMeetingState(mixed));
    act(() => result.current.continue()); // -> question at 1
    act(() => result.current.answer(''));
    act(() => result.current.answer('   '));
    expect(result.current.answers[1]).toBeUndefined();
    expect(result.current.currentIndex).toBe(1);
  });

  it('continue() on a question slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(mixed));
    act(() => result.current.continue()); // -> question at 1
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(1);
  });

  it('answer("x") on an info slide is a no-op', () => {
    const { result } = renderHook(() => useMeetingState(mixed));
    act(() => result.current.answer('x'));
    expect(result.current.answers[0]).toBeUndefined();
    expect(result.current.currentIndex).toBe(0);
  });

  it('decide("approve", "") sets the decision without advancing', () => {
    const { result } = renderHook(() => useMeetingState(slides));
    const decisionIndex = slides.findIndex((s) => s.type === 'decision');
    act(() => {
      result.current.currentIndex; // touch
    });
    // walk to the decision slide via continue() on the all-info-then-decision fixture
    for (let i = 0; i < decisionIndex; i += 1) {
      act(() => result.current.continue());
    }
    expect(result.current.currentIndex).toBe(decisionIndex);
    act(() => result.current.decide('approve', ''));
    expect(result.current.decision).toEqual({ outcome: 'approve', direction: '' });
    expect(result.current.currentIndex).toBe(decisionIndex);
  });

  it('decide("redirect", "focus on X") records the direction', () => {
    const { result } = renderHook(() => useMeetingState(mixed));
    act(() => result.current.continue()); // 0 -> 1 question
    act(() => result.current.answer('a')); // 1 -> 2 info
    act(() => result.current.continue()); // 2 -> 3 decision
    expect(result.current.currentIndex).toBe(3);
    act(() => result.current.decide('redirect', 'focus on X'));
    expect(result.current.decision).toEqual({ outcome: 'redirect', direction: 'focus on X' });
    expect(result.current.currentIndex).toBe(3);
  });

  it('clamps advancing past the last slide', () => {
    const onlyInfo = [{ type: 'info', title: 'i', content: [], narration: '' }];
    const { result } = renderHook(() => useMeetingState(onlyInfo));
    act(() => result.current.continue());
    act(() => result.current.continue());
    expect(result.current.currentIndex).toBe(0);
  });

  it('all actions on an empty slides array are no-ops and do not crash', () => {
    const { result } = renderHook(() => useMeetingState([]));
    act(() => result.current.continue());
    act(() => result.current.answer('x'));
    act(() => result.current.decide('approve', ''));
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.answers).toEqual({});
    expect(result.current.decision).toBeNull();
  });
});
