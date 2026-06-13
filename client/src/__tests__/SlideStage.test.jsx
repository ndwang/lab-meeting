import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SlideStage from '../SlideStage.jsx';
import sprint1 from '../../../briefings/sprint-1.json';

const slides = sprint1.slides;
const infoSlide = slides[0]; // type: info
const decisionSlide = slides[slides.length - 1]; // type: decision

function renderStage(props = {}) {
  const defaults = {
    slides,
    currentIndex: 0,
    answers: {},
    onContinue: vi.fn(),
    onAnswer: vi.fn(),
    onDecide: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  return { ...render(<SlideStage {...merged} />), props: merged };
}

afterEach(() => cleanup());

describe('SlideStage — shared rendering', () => {
  it('renders title, content bullets, and narration for the current slide', () => {
    renderStage({ currentIndex: 0 });

    expect(screen.getByTestId('slide-title')).toHaveTextContent(infoSlide.title);

    const content = screen.getByTestId('slide-content');
    const items = within(content).getAllByRole('listitem');
    expect(items.length).toBe(infoSlide.content.length);
    expect(items.length).toBeGreaterThan(0);

    expect(screen.getByTestId('slide-narration')).toHaveTextContent(
      infoSlide.narration,
    );
  });

  it('renders a progress indicator matching /Slide \\d+ of \\d+/', () => {
    renderStage({ currentIndex: 0 });
    expect(screen.getByTestId('slide-progress').textContent).toMatch(
      /Slide \d+ of \d+/,
    );
  });

  it('shows "Slide 1 of 4" for the sprint-1 fixture at index 0', () => {
    renderStage({ currentIndex: 0 });
    expect(screen.getByTestId('slide-progress')).toHaveTextContent(
      `Slide 1 of ${slides.length}`,
    );
  });
});

describe('SlideStage — info slide', () => {
  it('renders a Continue button that calls onContinue', () => {
    const { props } = renderStage({ currentIndex: 0 });
    const btn = screen.getByRole('button', { name: 'Continue' });
    fireEvent.click(btn);
    expect(props.onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('SlideStage — question slide', () => {
  const questionSlide = {
    type: 'question',
    title: 'A question for you',
    content: ['Consider the tradeoffs'],
    narration: 'What do you think we should do here?',
  };

  it('renders a textarea and a Submit button disabled while empty', () => {
    renderStage({ slides: [questionSlide], currentIndex: 0 });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('enables Submit after typing and calls onAnswer with the trimmed text', () => {
    const { props } = renderStage({ slides: [questionSlide], currentIndex: 0 });
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '  ship it  ' } });
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(props.onAnswer).toHaveBeenCalledWith('ship it');
  });
});

describe('SlideStage — decision slide', () => {
  it('renders Approve and Redirect; Redirect disabled while empty; Approve passes the slide content as the directive', () => {
    const { props } = renderStage({
      slides,
      currentIndex: slides.length - 1,
    });
    expect(screen.getByTestId('slide-title')).toHaveTextContent(
      decisionSlide.title,
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    const redirect = screen.getByRole('button', { name: 'Redirect' });
    expect(redirect).toBeDisabled();
    fireEvent.click(approve);
    // Approve adopts the briefing's proposed next-steps: the decision slide's
    // content bullets joined with newlines become the next sprint's directive.
    expect(props.onDecide).toHaveBeenCalledWith(
      'approve',
      decisionSlide.content.join('\n'),
    );
  });

  it('enables Redirect after typing and calls onDecide with the direction', () => {
    const { props } = renderStage({
      slides,
      currentIndex: slides.length - 1,
    });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'pivot to caching' },
    });
    const redirect = screen.getByRole('button', { name: 'Redirect' });
    expect(redirect).toBeEnabled();
    fireEvent.click(redirect);
    expect(props.onDecide).toHaveBeenCalledWith('redirect', 'pivot to caching');
  });
});

describe('SlideStage — boundaries', () => {
  it('renders a placeholder when slides is empty', () => {
    render(
      <SlideStage
        slides={[]}
        currentIndex={0}
        answers={{}}
        onContinue={vi.fn()}
        onAnswer={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('No slide')).toBeInTheDocument();
  });

  it('renders a placeholder when currentIndex is out of range', () => {
    render(
      <SlideStage
        slides={slides}
        currentIndex={99}
        answers={{}}
        onContinue={vi.fn()}
        onAnswer={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText('No slide')).toBeInTheDocument();
  });

  it('renders an empty <ul> with zero <li> when content is empty', () => {
    render(
      <SlideStage
        slides={[{ type: 'info', title: 'Empty', content: [], narration: 'n' }]}
        currentIndex={0}
        answers={{}}
        onContinue={vi.fn()}
        onAnswer={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    const content = screen.getByTestId('slide-content');
    expect(within(content).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('renders title/content/narration and no controls for an unrecognised type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <SlideStage
        slides={[{ type: 'mystery', title: 'X', content: ['a'], narration: 'n' }]}
        currentIndex={0}
        answers={{}}
        onContinue={vi.fn()}
        onAnswer={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByTestId('slide-title')).toHaveTextContent('X');
    expect(screen.getByTestId('slide-narration')).toHaveTextContent('n');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
