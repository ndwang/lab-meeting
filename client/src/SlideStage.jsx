import { useState } from 'react';

// Presentational slide stage: renders one slide (title, content bullets,
// narration) plus the controls dictated by its type. All gate logic lives in
// useMeetingState; this component only renders and invokes callbacks.
export function SlideStage({ slides, currentIndex, answers, onContinue, onAnswer, onDecide }) {
  const total = Array.isArray(slides) ? slides.length : 0;
  const slide = total > 0 ? slides[currentIndex] : undefined;

  if (!slide) {
    return <div className="slide-stage">No slide</div>;
  }

  return (
    <div className="slide-stage">
      <div className="slide-progress">{`Slide ${currentIndex + 1} of ${total}`}</div>
      <h1 data-testid="slide-title">{slide.title}</h1>
      <ul data-testid="slide-content">
        {(slide.content ?? []).map((bullet, i) => (
          <li key={i}>{bullet}</li>
        ))}
      </ul>
      <div data-testid="slide-narration" className="slide-narration">
        {slide.narration}
      </div>
      <Controls slide={slide} onContinue={onContinue} onAnswer={onAnswer} onDecide={onDecide} />
    </div>
  );
}

function Controls({ slide, onContinue, onAnswer, onDecide }) {
  switch (slide.type) {
    case 'info':
      return <InfoControls onContinue={onContinue} />;
    case 'question':
      return <QuestionControls onAnswer={onAnswer} />;
    case 'decision':
      return <DecisionControls onDecide={onDecide} />;
    default:
      console.warn(`SlideStage: unrecognised slide type "${slide.type}"`);
      return null;
  }
}

function InfoControls({ onContinue }) {
  return (
    <div className="slide-controls">
      <button type="button" onClick={() => onContinue?.()}>
        Continue
      </button>
    </div>
  );
}

function QuestionControls({ onAnswer }) {
  const [text, setText] = useState('');
  const empty = text.trim() === '';
  return (
    <div className="slide-controls">
      <textarea
        aria-label="answer"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" disabled={empty} onClick={() => onAnswer?.(text.trim())}>
        Submit
      </button>
    </div>
  );
}

function DecisionControls({ onDecide }) {
  const [direction, setDirection] = useState('');
  const empty = direction.trim() === '';
  return (
    <div className="slide-controls">
      <textarea
        aria-label="direction"
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
      />
      <button type="button" onClick={() => onDecide?.('approve', '')}>
        Approve
      </button>
      <button type="button" disabled={empty} onClick={() => onDecide?.('redirect', direction.trim())}>
        Redirect
      </button>
    </div>
  );
}
