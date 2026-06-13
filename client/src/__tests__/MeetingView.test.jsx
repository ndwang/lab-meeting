import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import sprint1 from '../../../briefings/sprint-1.json';
import MeetingView from '../MeetingView.jsx';

// Isolate MeetingView from the sibling work items: SlideStage and
// useMeetingState are built by other lanes. We assert the wiring contract — the
// exact props MeetingView passes — without depending on their real behaviour.
vi.mock('../SlideStage.jsx', () => ({
  default: (props) => {
    lastSlideStageProps = props;
    return (
      <div data-testid="slide-stage">slides:{props.slides.length}</div>
    );
  },
}));

// The hook is mocked, so a test can choose the meeting state MeetingView sees by
// reassigning `stateStub` before rendering. Default: a fresh meeting with no
// decision recorded (decision: null) — the loading/error/wiring tests rely on
// this default so they never trigger the minutes POST.
function freshState() {
  return {
    currentIndex: 0,
    answers: {},
    decision: null,
    continue: vi.fn(),
    answer: vi.fn(),
    decide: vi.fn(),
  };
}

let stateStub = freshState();

vi.mock('../useMeetingState.js', () => ({
  useMeetingState: (slides) => {
    lastSlidesPassedToHook = slides;
    return stateStub;
  },
}));

let lastSlideStageProps;
let lastSlidesPassedToHook;

function mockFetchOnce(impl) {
  global.fetch = vi.fn(impl);
}

// A briefing whose final slide is a decision slide, suitable for exercising the
// minutes-submission flow.
const decisionBriefing = {
  sprintId: 'sprint-x',
  goal: 'demo goal',
  slides: [
    { type: 'info', title: 'Intro', content: ['a'], narration: '' },
    {
      type: 'decision',
      title: 'Decide',
      content: ['ship the loop', 'then iterate'],
      narration: '',
    },
  ],
};

// Returns the parsed body of the POST /api/minutes call, or null if none.
function minutesPostBody(fetchMock) {
  const call = fetchMock.mock.calls.find((c) => c[0] === '/api/minutes');
  if (!call) return null;
  return JSON.parse(call[1].body);
}

beforeEach(() => {
  lastSlideStageProps = undefined;
  lastSlidesPassedToHook = undefined;
  stateStub = freshState();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MeetingView', () => {
  it('shows a loading indicator while the briefing is fetching', () => {
    // A never-resolving fetch keeps the component in the loading state.
    mockFetchOnce(() => new Promise(() => {}));
    render(<MeetingView id={1} />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('fetches GET /api/briefings/{id} on mount', () => {
    mockFetchOnce(() => new Promise(() => {}));
    render(<MeetingView id={7} />);
    expect(global.fetch).toHaveBeenCalledWith('/api/briefings/7');
  });

  it('renders the sprint header and SlideStage on success', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => sprint1,
    }));
    render(<MeetingView id={1} />);

    await waitFor(() => screen.getByTestId('slide-stage'));

    expect(screen.getByTestId('sprint-id').textContent).toBe(sprint1.sprintId);
    expect(screen.getByTestId('goal').textContent).toBe(sprint1.goal);
  });

  it('passes the briefing slides and state callbacks to SlideStage', async () => {
    mockFetchOnce(async () => ({ ok: true, json: async () => sprint1 }));
    render(<MeetingView id={1} />);
    await waitFor(() => screen.getByTestId('slide-stage'));

    expect(lastSlidesPassedToHook).toBe(sprint1.slides);
    expect(lastSlideStageProps.slides).toBe(sprint1.slides);
    expect(lastSlideStageProps.currentIndex).toBe(stateStub.currentIndex);
    expect(lastSlideStageProps.answers).toBe(stateStub.answers);
    expect(lastSlideStageProps.onContinue).toBe(stateStub.continue);
    expect(lastSlideStageProps.onAnswer).toBe(stateStub.answer);
    expect(lastSlideStageProps.onDecide).toBe(stateStub.decide);
  });

  it('renders an error state with "not found" on a 404', async () => {
    mockFetchOnce(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    }));
    render(<MeetingView id={9999} />);

    const err = await screen.findByTestId('error');
    expect(err.textContent.toLowerCase()).toContain('not found');
  });

  it('renders an error state on a network failure', async () => {
    mockFetchOnce(async () => {
      throw new Error('network down');
    });
    render(<MeetingView id={1} />);
    expect(await screen.findByTestId('error')).toBeTruthy();
  });

  it('renders an error state when the briefing has no slides array', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ sprintId: 'x', goal: 'y' }),
    }));
    render(<MeetingView id={1} />);
    expect(await screen.findByTestId('error')).toBeTruthy();
  });

  it('renders SlideStage with no crash when slides is an empty array', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ sprintId: 'empty', goal: 'no slides', slides: [] }),
    }));
    render(<MeetingView id={1} />);
    await waitFor(() => screen.getByTestId('slide-stage'));
    expect(lastSlideStageProps.slides).toEqual([]);
  });

  it('re-fetches when the id prop changes', async () => {
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('/2')
          ? { sprintId: 'sprint-2', goal: 'second', slides: [] }
          : sprint1,
    }));
    global.fetch = fetchMock;

    const { rerender } = render(<MeetingView id={1} />);
    await waitFor(() => screen.getByTestId('slide-stage'));
    expect(screen.getByTestId('sprint-id').textContent).toBe(sprint1.sprintId);

    rerender(<MeetingView id={2} />);
    await waitFor(() =>
      expect(screen.getByTestId('sprint-id').textContent).toBe('sprint-2')
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/briefings/1');
    expect(fetchMock).toHaveBeenCalledWith('/api/briefings/2');
  });

  it('does not POST /api/minutes when decision is null', async () => {
    // Default stateStub has decision: null — the effect must not fire a POST.
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => sprint1 }));
    global.fetch = fetchMock;
    render(<MeetingView id={1} />);
    await waitFor(() => screen.getByTestId('slide-stage'));

    const minutesCall = fetchMock.mock.calls.find((c) => c[0] === '/api/minutes');
    expect(minutesCall).toBeUndefined();
  });
});

// A fetch mock that serves the briefing GET, the minutes POST, the poll GET, and
// the approve POST for the two-step decision handoff. Uses fake timers so the
// 2000ms poll can be driven forward with vi.advanceTimersByTimeAsync(2000).
//
//   postStatus    — HTTP status for POST /api/minutes (default 201)
//   postThrows    — make POST /api/minutes throw (network error)
//   pollRows      — array of { status, composedGoal, composedMinutes } objects
//                   returned by successive GET /api/minutes?briefingId=N calls.
//                   If null, no poll mock is exercised. Each call consumes the
//                   next element; the last element repeats for further calls.
//   approveStatus — HTTP status for POST /api/minutes/:id/approve (default 201)
//   approveThrows — make POST /api/minutes/:id/approve throw
function mockBriefingAndMinutes({
  briefing,
  postStatus = 201,
  postThrows = false,
  pollRows = null,
  approveStatus = 201,
  approveThrows = false,
} = {}) {
  // shouldAdvanceTime keeps real time ticking the fake clock so Testing
  // Library's findBy/waitFor polling resolves; explicit advanceTimersByTimeAsync
  // still jumps the clock to fire the 2000ms poll interval deterministically.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let pollCount = 0;
  const fetchMock = vi.fn(async (url, opts) => {
    if (opts?.method === 'POST' && url === '/api/minutes') {
      if (postThrows) throw new Error('network down');
      return {
        ok: postStatus === 201,
        status: postStatus,
        json: async () => ({ minutesId: 11 }),
      };
    }
    if (url.startsWith('/api/minutes?briefingId=')) {
      const row = pollRows[Math.min(pollCount++, pollRows.length - 1)];
      return { ok: true, json: async () => [row] };
    }
    if (opts?.method === 'POST' && /\/api\/minutes\/\d+\/approve/.test(url)) {
      if (approveThrows) throw new Error('network down');
      return {
        ok: approveStatus === 201,
        status: approveStatus,
        json: async () => ({ queuedSprintId: 22 }),
      };
    }
    return { ok: true, json: async () => briefing };
  });
  global.fetch = fetchMock;
  return fetchMock;
}

// Returns the parsed body of the POST /api/minutes/:id/approve call, or null.
function approvePostBody(fetchMock) {
  const call = fetchMock.mock.calls.find(
    (c) => typeof c[0] === 'string' && /\/api\/minutes\/\d+\/approve/.test(c[0])
  );
  if (!call) return null;
  return JSON.parse(call[1].body);
}

const composedRow = {
  status: 'composed',
  composedGoal: 'Build the caching layer',
  composedMinutes: 'Outcome: redirect\nDirective: cache it',
};

describe('MeetingView — two-step decision handoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('POSTs /api/minutes once and enters the composing state (pre-poll)', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'ship the loop\nthen iterate' },
    };
    const fetchMock = mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [composedRow],
    });

    render(<MeetingView id={42} />);
    await screen.findByTestId('composing');

    const postCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/minutes' && c[1]?.method === 'POST'
    );
    expect(postCalls).toHaveLength(1);
    expect(minutesPostBody(fetchMock)).toEqual({
      briefingId: 42,
      outcome: 'approve',
      directive: 'ship the loop\nthen iterate',
      answers: [],
    });

    // Poll has not fired yet — no timer has advanced.
    const pollCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('/api/minutes?briefingId=')
    );
    expect(pollCalls).toHaveLength(0);
  });

  it('POSTs the human-typed directive on redirect with captured answers', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      answers: { 0: 'my answer' },
      decision: { outcome: 'redirect', direction: 'focus on X' },
    };
    const fetchMock = mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [composedRow],
    });

    render(<MeetingView id={7} />);
    await screen.findByTestId('composing');

    const body = minutesPostBody(fetchMock);
    expect(body.outcome).toBe('redirect');
    expect(body.directive).toBe('focus on X');
    expect(body.answers).toEqual([{ title: 'Intro', answer: 'my answer' }]);
  });

  it('polls until composed, then shows the editable compose-review and hides the stage', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'cache it' },
    };
    mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [composedRow],
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('composing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const review = await screen.findByTestId('compose-review');
    expect(review).toBeTruthy();
    const textarea = screen.getByLabelText('Next sprint goal');
    expect(textarea.value).toBe('Build the caching layer');
    expect(screen.queryByTestId('slide-stage')).toBeNull();
    expect(screen.queryByTestId('composing')).toBeNull();
  });

  it('stays composing while the poll returns a not-yet-composed row', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'cache it' },
    };
    mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [{ status: 'resolved' }, { status: 'resolved' }, composedRow],
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('composing');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('composing')).toBeTruthy();
    expect(screen.queryByTestId('compose-review')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('composing')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(await screen.findByTestId('compose-review')).toBeTruthy();
  });

  it('approves the edited goal and shows "Next sprint queued"', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'cache it' },
    };
    const fetchMock = mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [composedRow],
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('composing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await screen.findByTestId('compose-review');

    const textarea = screen.getByLabelText('Next sprint goal');
    fireEvent.change(textarea, { target: { value: 'edited goal' } });
    fireEvent.click(screen.getByRole('button', { name: /Approve & launch/ }));

    const confirmed = await screen.findByTestId('minutes-confirmed');
    expect(confirmed.textContent).toContain('Next sprint queued');
    expect(screen.queryByTestId('compose-review')).toBeNull();

    expect(approvePostBody(fetchMock)).toEqual({ goal: 'edited goal' });
    const approveCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === 'string' && /\/api\/minutes\/\d+\/approve/.test(c[0])
    );
    expect(approveCall[0]).toBe('/api/minutes/11/approve');
  });

  it('approves the unedited composed goal when the human does not edit it', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'cache it' },
    };
    const fetchMock = mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [composedRow],
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('composing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await screen.findByTestId('compose-review');

    fireEvent.click(screen.getByRole('button', { name: /Approve & launch/ }));
    await screen.findByTestId('minutes-confirmed');

    expect(approvePostBody(fetchMock)).toEqual({ goal: 'Build the caching layer' });
  });

  it('shows minutes-error + retry on a non-201 POST and keeps the slide stage', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'go' },
    };
    const fetchMock = mockBriefingAndMinutes({
      briefing: decisionBriefing,
      postStatus: 400,
      pollRows: [composedRow],
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-error');

    expect(screen.getByTestId('minutes-retry')).toBeTruthy();
    expect(screen.getByTestId('slide-stage')).toBeTruthy();

    // Retry re-sends the POST. Make the second attempt succeed.
    fetchMock.mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST' && url === '/api/minutes') {
        return { ok: true, status: 201, json: async () => ({ minutesId: 11 }) };
      }
      if (url.startsWith('/api/minutes?briefingId=')) {
        return { ok: true, json: async () => [composedRow] };
      }
      return { ok: true, json: async () => decisionBriefing };
    });

    fireEvent.click(screen.getByTestId('minutes-retry'));
    await screen.findByTestId('composing');

    const postCalls = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/minutes' && c[1]?.method === 'POST'
    );
    expect(postCalls.length).toBe(2);
  });

  it('shows minutes-error on a POST network failure', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'go' },
    };
    mockBriefingAndMinutes({
      briefing: decisionBriefing,
      postThrows: true,
      pollRows: [composedRow],
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-error');
  });

  it('shows approve-error + retry when the approve POST fails, then succeeds on retry', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'cache it' },
    };
    const fetchMock = mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [composedRow],
      approveStatus: 500,
    });

    render(<MeetingView id={1} />);
    await screen.findByTestId('composing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await screen.findByTestId('compose-review');

    fireEvent.click(screen.getByRole('button', { name: /Approve & launch/ }));
    await screen.findByTestId('approve-error');
    expect(screen.getByTestId('approve-retry')).toBeTruthy();
    // Compose-review stays so the human can adjust and retry.
    expect(screen.getByTestId('compose-review')).toBeTruthy();

    // Retry succeeds.
    fetchMock.mockImplementation(async (url, opts) => {
      if (opts?.method === 'POST' && /\/api\/minutes\/\d+\/approve/.test(url)) {
        return { ok: true, status: 201, json: async () => ({ queuedSprintId: 22 }) };
      }
      return { ok: true, json: async () => decisionBriefing };
    });
    fireEvent.click(screen.getByTestId('approve-retry'));
    await screen.findByTestId('minutes-confirmed');
  });

  it('clears the polling interval on unmount (no state update after unmount)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'cache it' },
    };
    mockBriefingAndMinutes({
      briefing: decisionBriefing,
      pollRows: [{ status: 'resolved' }],
    });

    const { unmount } = render(<MeetingView id={1} />);
    await screen.findByTestId('composing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    unmount();
    // Advancing past further ticks must not schedule any callback / state update.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
