import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QAPanel from './QAPanel.jsx';

// Q&A is a poll-driven aside. Tests mock fetch directly and drive the polling
// loop by advancing fake timers, so no real server or interval wall-clock is
// involved.

function jsonRes(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Returns the parsed body of the first POST /api/qa call, or null.
function qaPostBody(fetchMock) {
  const call = fetchMock.mock.calls.find(
    (c) => c[0] === '/api/qa' && c[1]?.method === 'POST',
  );
  return call ? JSON.parse(call[1].body) : null;
}

describe('QAPanel', () => {
  it('disables the submit button when the textarea is empty', () => {
    global.fetch = vi.fn();
    render(<QAPanel briefingId={5} />);
    expect(screen.getByTestId('qa-submit')).toBeDisabled();
  });

  it('POSTs /api/qa with { briefingId, question } on submit', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url) => {
      if (url === '/api/qa') return jsonRes({ questionId: 11 });
      return jsonRes([]);
    });
    global.fetch = fetchMock;

    render(<QAPanel briefingId={42} />);
    await user.type(screen.getByTestId('qa-input'), 'Why did tests fail?');
    await user.click(screen.getByTestId('qa-submit'));

    await waitFor(() => expect(qaPostBody(fetchMock)).not.toBeNull());
    expect(qaPostBody(fetchMock)).toEqual({
      briefingId: 42,
      question: 'Why did tests fail?',
    });
    const postCall = fetchMock.mock.calls.find(
      (c) => c[0] === '/api/qa' && c[1]?.method === 'POST',
    );
    expect(postCall[1].method).toBe('POST');
  });

  it('shows the question with a "You" label and pending state after a successful POST', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url) => {
      if (url === '/api/qa') return jsonRes({ questionId: 1 });
      return jsonRes([]);
    });
    global.fetch = fetchMock;

    render(<QAPanel briefingId={1} />);
    await user.type(screen.getByTestId('qa-input'), 'My question');
    await user.click(screen.getByTestId('qa-submit'));

    await screen.findByTestId('qa-item');
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('My question')).toBeInTheDocument();
    expect(screen.getByTestId('qa-pending').textContent).toContain(
      'bringing in the engineer',
    );
  });

  it('clears the textarea after a successful submit', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async (url) =>
      url === '/api/qa' ? jsonRes({ questionId: 1 }) : jsonRes([]),
    );

    render(<QAPanel briefingId={1} />);
    const input = screen.getByTestId('qa-input');
    await user.type(input, 'something');
    await user.click(screen.getByTestId('qa-submit'));

    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('renders the polled answer attributed to "Claude — Engineer"', async () => {
    const user = userEvent.setup();
    let getResponse = [];
    const fetchMock = vi.fn(async (url, opts) => {
      if (url === '/api/qa' && opts?.method === 'POST') {
        return jsonRes({ questionId: 7 });
      }
      // GET /api/qa?briefingId=N
      return jsonRes(getResponse);
    });
    global.fetch = fetchMock;

    render(<QAPanel briefingId={3} />);
    await user.type(screen.getByTestId('qa-input'), 'Question?');
    await user.click(screen.getByTestId('qa-submit'));
    await screen.findByTestId('qa-pending');

    // The daemon answers; the next poll will reflect it.
    getResponse = [
      {
        id: 7,
        question: 'Question?',
        answer: 'Because the migration was missing.',
        status: 'answered',
        created_at: '2026-06-13T00:00:00Z',
      },
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await screen.findByTestId('qa-answer');
    expect(screen.getByText('Claude — Engineer')).toBeInTheDocument();
    expect(
      screen.getByText('Because the migration was missing.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('qa-pending')).toBeNull();
  });

  it('stops polling once every question is answered', async () => {
    const user = userEvent.setup();
    const answered = [
      {
        id: 7,
        question: 'Question?',
        answer: 'done',
        status: 'answered',
        created_at: '2026-06-13T00:00:00Z',
      },
    ];
    const fetchMock = vi.fn(async (url, opts) => {
      if (url === '/api/qa' && opts?.method === 'POST') {
        return jsonRes({ questionId: 7 });
      }
      return jsonRes(answered);
    });
    global.fetch = fetchMock;

    render(<QAPanel briefingId={3} />);
    await user.type(screen.getByTestId('qa-input'), 'Question?');
    await user.click(screen.getByTestId('qa-submit'));
    await screen.findByTestId('qa-pending');

    // First poll resolves the answer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await screen.findByTestId('qa-answer');

    const getCallsAfterAnswer = fetchMock.mock.calls.filter(
      (c) => c[1]?.method !== 'POST',
    ).length;

    // Advance well past several intervals — no further GET fetches.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    const getCallsLater = fetchMock.mock.calls.filter(
      (c) => c[1]?.method !== 'POST',
    ).length;
    expect(getCallsLater).toBe(getCallsAfterAnswer);
  });

  it('shows an inline error and re-enables the form when POST returns non-2xx', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async (url, opts) => {
      if (url === '/api/qa' && opts?.method === 'POST') {
        return jsonRes({ error: 'boom' }, false);
      }
      return jsonRes([]);
    });

    render(<QAPanel briefingId={1} />);
    await user.type(screen.getByTestId('qa-input'), 'will fail');
    await user.click(screen.getByTestId('qa-submit'));

    await screen.findByTestId('qa-error');
    // Form re-enabled: text preserved, button live again.
    expect(screen.getByTestId('qa-input')).toHaveValue('will fail');
    expect(screen.getByTestId('qa-submit')).not.toBeDisabled();
    // The failed question was NOT added to the thread.
    expect(screen.queryByTestId('qa-item')).toBeNull();
  });
});
