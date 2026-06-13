import { useState } from 'react';

// SlideStage renders a single slide at a time — title, content bullets, and the
// narration (the presenter's spoken script) — plus the controls for the slide's
// type. It is presentational: it holds no data state, makes no fetch calls, and
// drives all turn-taking through the callbacks it receives as props. The only
// internal state is the controlled value of the answer/direction textareas.

function InfoControls({ onContinue }) {
  return (
    <div className="slide-controls">
      <button type="button" onClick={() => onContinue()}>
        Continue
      </button>
    </div>
  );
}

function QuestionControls({ onAnswer }) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  return (
    <div className="slide-controls">
      <textarea
        aria-label="Your answer"
        placeholder="Type your answer…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        disabled={trimmed.length === 0}
        onClick={() => onAnswer(trimmed)}
      >
        Submit
      </button>
    </div>
  );
}

function DecisionControls({ onDecide }) {
  const [direction, setDirection] = useState('');
  const trimmed = direction.trim();
  return (
    <div className="slide-controls">
      <textarea
        aria-label="Direction"
        placeholder="Direction (required to redirect)…"
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
      />
      <div className="decision-actions">
        <button type="button" onClick={() => onDecide('approve', '')}>
          Approve
        </button>
        <button
          type="button"
          disabled={trimmed.length === 0}
          onClick={() => onDecide('redirect', trimmed)}
        >
          Redirect
        </button>
      </div>
    </div>
  );
}

export default function SlideStage({
  slides,
  currentIndex,
  answers,
  onContinue,
  onAnswer,
  onDecide,
}) {
  const total = Array.isArray(slides) ? slides.length : 0;
  const slide = total > 0 ? slides[currentIndex] : undefined;

  if (!slide) {
    return (
      <section className="slide-stage" data-testid="slide-stage">
        <p className="slide-placeholder">No slide</p>
      </section>
    );
  }

  let controls = null;
  switch (slide.type) {
    case 'info':
      controls = <InfoControls onContinue={onContinue} />;
      break;
    case 'question':
      controls = <QuestionControls onAnswer={onAnswer} />;
      break;
    case 'decision':
      controls = <DecisionControls onDecide={onDecide} />;
      break;
    default:
      console.warn(`SlideStage: unrecognised slide type "${slide.type}"`);
      controls = null;
  }

  const content = Array.isArray(slide.content) ? slide.content : [];

  return (
    <section className="slide-stage" data-testid="slide-stage">
      <div className="slide-progress" data-testid="slide-progress">
        Slide {currentIndex + 1} of {total}
      </div>

      <h1 className="slide-title" data-testid="slide-title">
        {slide.title}
      </h1>

      <ul className="slide-content" data-testid="slide-content">
        {content.map((bullet, i) => (
          <li key={i}>{bullet}</li>
        ))}
      </ul>

      <div className="slide-narration" data-testid="slide-narration">
        <span className="slide-narration-label">Presenter</span>
        <p>{slide.narration}</p>
      </div>

      {controls}
    </section>
  );
}
