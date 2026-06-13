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

const stateStub = {
  currentIndex: 0,
  answers: {},
  decision: null,
  continue: vi.fn(),
  answer: vi.fn(),
  decide: vi.fn(),
};

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

beforeEach(() => {
  lastSlideStageProps = undefined;
  lastSlidesPassedToHook = undefined;
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

  it('does not call any write endpoint (no POST)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => sprint1 }));
    global.fetch = fetchMock;
    render(<MeetingView id={1} />);
    await waitFor(() => screen.getByTestId('slide-stage'));

    for (const call of fetchMock.mock.calls) {
      const opts = call[1];
      expect(opts?.method ?? 'GET').toBe('GET');
    }
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/minutes',
      expect.anything()
    );
  });
});
