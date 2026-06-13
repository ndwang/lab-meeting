import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlideStage } from '../SlideStage.jsx';
import sprint1 from '../../../briefings/sprint-1.json';

// Assertions use plain DOM properties (no @testing-library/jest-dom dependency).
const slides = sprint1.slides;
const infoIndex = slides.findIndex((s) => s.type === 'info');
const decisionIndex = slides.findIndex((s) => s.type === 'decision');

function renderStage(props) {
  return render(
    <SlideStage
      slides={slides}
      currentIndex={0}
      answers={{}}
      onContinue={() => {}}
      onAnswer={() => {}}
      onDecide={() => {}}
      {...props}
    />,
  );
}

describe('SlideStage', () => {
  it('renders an info slide title, content, narration and Continue button', () => {
    const slide = slides[infoIndex];
    renderStage({ currentIndex: infoIndex });

    expect(screen.getByTestId('slide-title').textContent).toContain(slide.title);
    const content = screen.getByTestId('slide-content');
    expect(content.querySelectorAll('li').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('slide-narration').textContent).toContain(slide.narration);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('disables Submit on empty input and enables + calls onAnswer once text is typed (question slide)', async () => {
    const onAnswer = vi.fn();
    const questionSlides = [
      { type: 'question', title: 'Q', content: ['ask'], narration: 'narr' },
    ];
    render(
      <SlideStage
        slides={questionSlides}
        currentIndex={0}
        answers={{}}
        onContinue={() => {}}
        onAnswer={onAnswer}
        onDecide={() => {}}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit.disabled).toBe(true);

    await userEvent.type(screen.getByRole('textbox'), 'great work');
    expect(submit.disabled).toBe(false);

    await userEvent.click(submit);
    expect(onAnswer).toHaveBeenCalledWith('great work');
  });

  it('renders Approve and Redirect on a decision slide; Redirect disabled; Approve calls onDecide(approve, "")', async () => {
    const onDecide = vi.fn();
    renderStage({ currentIndex: decisionIndex, onDecide });

    const approve = screen.getByRole('button', { name: 'Approve' });
    const redirect = screen.getByRole('button', { name: 'Redirect' });
    expect(approve).toBeTruthy();
    expect(redirect.disabled).toBe(true);

    await userEvent.click(approve);
    expect(onDecide).toHaveBeenCalledWith('approve', '');
  });

  it('shows a progress indicator matching /Slide N of M/', () => {
    renderStage({ currentIndex: 0 });
    expect(screen.getByText(/Slide \d+ of \d+/)).toBeTruthy();
    expect(screen.getByText(`Slide 1 of ${slides.length}`)).toBeTruthy();
  });
});
