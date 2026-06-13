import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

// A fetch mock that serves the briefing GET and records/answers the minutes POST.
// `postStatus` is the HTTP status the minutes POST resolves to (default 201).
// `postThrows` makes the minutes POST reject (network error).
function mockBriefingAndMinutes({ briefing, postStatus = 201, postThrows = false } = {}) {
  const fetchMock = vi.fn(async (url, opts) => {
    if (url === '/api/minutes') {
      if (postThrows) throw new Error('network down');
      return { ok: postStatus === 201, status: postStatus };
    }
    return { ok: true, json: async () => briefing };
  });
  global.fetch = fetchMock;
  return fetchMock;
}

describe('MeetingView — minutes submission', () => {
  it('POSTs /api/minutes once with the approve directive from slide content', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'ship the loop\nthen iterate' },
    };
    const fetchMock = mockBriefingAndMinutes({ briefing: decisionBriefing });

    render(<MeetingView id={42} />);
    await screen.findByTestId('minutes-confirmed');

    const calls = fetchMock.mock.calls.filter((c) => c[0] === '/api/minutes');
    expect(calls).toHaveLength(1);
    expect(minutesPostBody(fetchMock)).toEqual({
      briefingId: 42,
      outcome: 'approve',
      directive: 'ship the loop\nthen iterate',
      answers: [],
    });
  });

  it('POSTs the human-typed directive on redirect', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'redirect', direction: 'focus on X' },
    };
    const fetchMock = mockBriefingAndMinutes({ briefing: decisionBriefing });

    render(<MeetingView id={7} />);
    await screen.findByTestId('minutes-confirmed');

    const body = minutesPostBody(fetchMock);
    expect(body.outcome).toBe('redirect');
    expect(body.directive).toBe('focus on X');
  });

  it('includes captured question answers in the POST body', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      answers: { 0: 'my answer' },
      decision: { outcome: 'approve', direction: 'go' },
    };
    const fetchMock = mockBriefingAndMinutes({ briefing: decisionBriefing });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-confirmed');

    expect(minutesPostBody(fetchMock).answers).toEqual([
      { title: 'Intro', answer: 'my answer' },
    ]);
  });

  it('sends answers: [] when there are no captured answers', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'go' },
    };
    const fetchMock = mockBriefingAndMinutes({ briefing: decisionBriefing });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-confirmed');

    expect(minutesPostBody(fetchMock).answers).toEqual([]);
  });

  it('sends directive: "" when the decision slide has empty content (approve)', async () => {
    const emptyContentBriefing = {
      ...decisionBriefing,
      slides: [
        { type: 'decision', title: 'Decide', content: [], narration: '' },
      ],
    };
    stateStub = {
      ...freshState(),
      currentIndex: 0,
      decision: { outcome: 'approve', direction: '' },
    };
    const fetchMock = mockBriefingAndMinutes({ briefing: emptyContentBriefing });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-confirmed');

    const body = minutesPostBody(fetchMock);
    expect(body.directive).toBe('');
    expect(body.outcome).toBe('approve');
  });

  it('shows the confirmation state and hides the slide stage on 201', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'go' },
    };
    mockBriefingAndMinutes({ briefing: decisionBriefing, postStatus: 201 });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-confirmed');

    expect(screen.queryByTestId('slide-stage')).toBeNull();
  });

  it('shows an error + retry and keeps the slide stage on a non-201 response', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'go' },
    };
    mockBriefingAndMinutes({ briefing: decisionBriefing, postStatus: 400 });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-error');

    expect(screen.getByTestId('minutes-retry')).toBeTruthy();
    expect(screen.getByTestId('slide-stage')).toBeTruthy();
  });

  it('shows the error state on a network failure', async () => {
    stateStub = {
      ...freshState(),
      currentIndex: 1,
      decision: { outcome: 'approve', direction: 'go' },
    };
    mockBriefingAndMinutes({ briefing: decisionBriefing, postThrows: true });

    render(<MeetingView id={1} />);
    await screen.findByTestId('minutes-error');
  });
});
