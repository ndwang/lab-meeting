import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// Mock the two views the Router dispatches to so this suite tests routing
// logic only — not the landing list or the meeting page (separate lanes).
vi.mock('../App.jsx', () => ({
  default: () => <div data-testid="briefing-list">list</div>,
}));
vi.mock('../MeetingView.jsx', () => ({
  default: ({ id }) => <div data-testid="meeting-view">meeting {String(id)}</div>,
}));

import Router from '../Router.jsx';

function setHash(hash) {
  window.location.hash = hash;
}

beforeEach(() => {
  // Reset to a known empty hash before each test.
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

describe('Router', () => {
  it('renders MeetingView with id=1 for #/meeting/1', () => {
    setHash('#/meeting/1');
    render(<Router />);
    const view = screen.getByTestId('meeting-view');
    expect(view).toBeTruthy();
    expect(view.textContent).toContain('meeting 1');
    expect(screen.queryByTestId('briefing-list')).toBeNull();
  });

  it('renders BriefingList for #/', () => {
    setHash('#/');
    render(<Router />);
    expect(screen.getByTestId('briefing-list')).toBeTruthy();
    expect(screen.queryByTestId('meeting-view')).toBeNull();
  });

  it('renders BriefingList for an empty hash', () => {
    setHash('');
    render(<Router />);
    expect(screen.getByTestId('briefing-list')).toBeTruthy();
  });

  it('redirects to #/ and renders BriefingList for a non-numeric meeting id', () => {
    setHash('#/meeting/abc');
    render(<Router />);
    expect(screen.getByTestId('briefing-list')).toBeTruthy();
    expect(screen.queryByTestId('meeting-view')).toBeNull();
    expect(window.location.hash).toBe('#/');
  });

  it('renders BriefingList for an unrecognised hash', () => {
    setHash('#/unknown');
    render(<Router />);
    expect(screen.getByTestId('briefing-list')).toBeTruthy();
    expect(screen.queryByTestId('meeting-view')).toBeNull();
  });

  it('re-renders when a hashchange event fires after mount', () => {
    setHash('#/');
    render(<Router />);
    expect(screen.getByTestId('briefing-list')).toBeTruthy();

    act(() => {
      window.location.hash = '#/meeting/7';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(screen.getByTestId('meeting-view').textContent).toContain('meeting 7');
    expect(screen.queryByTestId('briefing-list')).toBeNull();
  });

  it('renders a Back link to #/ in the meeting view', () => {
    setHash('#/meeting/1');
    render(<Router />);
    const back = screen.getByText(/back to briefings/i);
    expect(back.getAttribute('href')).toBe('#/');
  });
});
