import { useMemo, useState } from 'react';
import {
  BLANK,
  buildGrammarExercises,
  checkTypedForm,
  findGrammarPoint,
  getGrammarPoints,
  type GrammarExercise,
} from '@language-srs/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Row, Screen, TextButton, Title } from '../ui';

/**
 * Using a grammar point, rather than agreeing that you understood it.
 *
 * The page before this explains; this is where the explanation gets tested,
 * and it is deliberately not one shape repeated. Recognising 是 among four
 * options and producing it into a gap are different abilities that come apart,
 * so a sitting runs matching, then multiple choice, then typing, then the
 * point itself with the explanation withheld.
 *
 * Nothing here is scored against the learner. A sitting is passed if they got
 * most of it, the result moves the point up or down one ladder, and the number
 * that matters — when this comes back — is stated rather than hidden.
 */

const PER_SITTING = 5;
/** Getting most of it right is a pass; this is the bar. */
const PASS_RATIO = 0.7;

export function Practice({ id }: { id: string }) {
  const { engine, revision, mutate } = useEngine();
  const { navigate } = useRouter();
  void revision;

  const point = findGrammarPoint(id);

  // A new seed per mount, so leaving and coming back is a different sitting
  // rather than the same five questions in the same order.
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000));

  const exercises = useMemo(() => {
    if (!point) return [];
    return buildGrammarExercises(point, {
      pool: getGrammarPoints(point.languageCode),
      count: PER_SITTING,
      seed,
    });
  }, [point, seed]);

  const [at, setAt] = useState(0);
  const [right, setRight] = useState(0);
  const [done, setDone] = useState(false);

  if (!point) {
    return (
      <Screen>
        <Title>Not found</Title>
        <TextButton label="Back to the syllabus" onClick={() => navigate('/learn')} />
      </Screen>
    );
  }

  const onAnswered = async (correct: boolean) => {
    const scored = right + (correct ? 1 : 0);
    setRight(scored);

    if (at + 1 < exercises.length) {
      setAt(at + 1);
      return;
    }

    const passed = scored / exercises.length >= PASS_RATIO;
    await mutate((instance) => instance.recordGrammarPractice(point.id, passed));
    setDone(true);
  };

  if (done || exercises.length === 0) {
    const passed = exercises.length > 0 && right / exercises.length >= PASS_RATIO;
    const next = engine.grammarDue(point.id);

    return (
      <Screen>
        <Rise index={0}>
          <div className="stack stack--tight">
            <Title>{passed ? 'That holds up' : 'Worth another look'}</Title>
            <Caption>
              {right} of {exercises.length} right.{' '}
              {passed
                ? 'Moved further out.'
                : 'Back tomorrow — getting a rule wrong usually means the explanation needs rereading, not that you forgot it.'}
            </Caption>
          </div>
        </Rise>

        {next ? (
          <Rise index={1}>
            <Caption>Next practice {describeWhen(next, engine.now())}.</Caption>
          </Rise>
        ) : null}

        <Rise index={2}>
          <BigButton label="Read the point again" onClick={() => navigate(`/learn/${point.id}`)} />
        </Rise>
        <Rise index={3}>
          <Row center>
            <TextButton label="All grammar" muted onClick={() => navigate('/learn')} />
          </Row>
        </Rise>
      </Screen>
    );
  }

  const exercise = exercises[at]!;

  return (
    <Screen layer="loop">
      <div className="progress">
        <div className="progress__row">
          <Caption>
            {at + 1} of {exercises.length} · {point.form}
          </Caption>
          <button
            type="button"
            className="progress__leave"
            onClick={() => navigate(`/learn/${point.id}`)}
          >
            Done
          </button>
        </div>
        <div className="track">
          <div className="track__fill" style={{ width: `${(at / exercises.length) * 100}%` }} />
        </div>
      </div>

      <div className="deal" key={exercise.id}>
        <Exercise exercise={exercise} onAnswered={(correct) => void onAnswered(correct)} />
      </div>
    </Screen>
  );
}

function Exercise({
  exercise,
  onAnswered,
}: {
  exercise: GrammarExercise;
  onAnswered: (correct: boolean) => void;
}) {
  switch (exercise.kind) {
    case 'match':
      return <Match exercise={exercise} onAnswered={onAnswered} />;
    case 'blank':
      return <Blank exercise={exercise} onAnswered={onAnswered} />;
    case 'type':
      return <Typed exercise={exercise} onAnswered={onAnswered} />;
    case 'recall':
      return <Recall exercise={exercise} onAnswered={onAnswered} />;
  }
}

/**
 * Pair each sentence with what it means.
 *
 * Tap one side then the other. A correct pair locks and fades; a wrong one
 * clears the selection and is counted once, because a matching grid where
 * every mistake is punished separately turns into a guessing game nobody
 * finishes.
 */
function Match({
  exercise,
  onAnswered,
}: {
  exercise: Extract<GrammarExercise, { kind: 'match' }>;
  onAnswered: (correct: boolean) => void;
}) {
  /*
   * Held as a value rather than a "side:id" string.
   *
   * Pair ids contain colons of their own — zh-shi:pair:0 — so splitting one
   * back apart produced "zh-shi" as the id and nothing ever matched. Worth the
   * extra object to make the mistake unavailable.
   */
  const [picked, setPicked] = useState<{ side: 'target' | 'gloss'; id: string } | undefined>();
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [slipped, setSlipped] = useState(false);
  const [wrong, setWrong] = useState<string | undefined>();

  const glosses = useMemo(
    () => [...exercise.pairs].sort((a, b) => a.gloss.localeCompare(b.gloss)),
    [exercise],
  );

  const choose = (pairId: string, side: 'target' | 'gloss') => {
    if (solved.has(pairId)) return;

    if (picked === undefined) {
      setPicked({ side, id: pairId });
      setWrong(undefined);
      return;
    }

    if (picked.side === side) {
      setPicked({ side, id: pairId });
      return;
    }

    if (picked.id === pairId) {
      const next = new Set(solved).add(pairId);
      setSolved(next);
      setPicked(undefined);
      if (next.size === exercise.pairs.length) onAnswered(!slipped);
    } else {
      setSlipped(true);
      setWrong(pairId);
      setPicked(undefined);
    }
  };

  return (
    <div className="stack">
      <Caption>Pair each sentence with what it means.</Caption>
      <div className="match">
        <div className="match__column">
          {exercise.pairs.map((pair) => (
            <button
              key={pair.id}
              type="button"
              className={`chip${solved.has(pair.id) ? ' chip--solved' : ''}${
                picked?.side === 'target' && picked.id === pair.id ? ' chip--picked' : ''
              }`}
              disabled={solved.has(pair.id)}
              onClick={() => choose(pair.id, 'target')}
            >
              {pair.target}
            </button>
          ))}
        </div>
        <div className="match__column">
          {glosses.map((pair) => (
            <button
              key={pair.id}
              type="button"
              className={`chip${solved.has(pair.id) ? ' chip--solved' : ''}${
                picked?.side === 'gloss' && picked.id === pair.id ? ' chip--picked' : ''
              }${wrong === pair.id ? ' chip--wrong' : ''}`}
              disabled={solved.has(pair.id)}
              onClick={() => choose(pair.id, 'gloss')}
            >
              {pair.gloss}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The sentence with the form removed, and four candidates. */
function Blank({
  exercise,
  onAnswered,
}: {
  exercise: Extract<GrammarExercise, { kind: 'blank' }>;
  onAnswered: (correct: boolean) => void;
}) {
  const [chosen, setChosen] = useState<string | undefined>();
  const answered = chosen !== undefined;
  const correct = chosen === exercise.answer;

  return (
    <div className="stack">
      <Caption>Which one fills the gap?</Caption>
      <div className="card card--quiet">
        <p className="sentence">
          {exercise.sentence.split(BLANK).map((part, index, parts) => (
            <span key={index}>
              {part}
              {index < parts.length - 1 ? (
                <span className={`gap${answered ? (correct ? ' gap--right' : ' gap--wrong') : ''}`}>
                  {answered ? exercise.answer : BLANK}
                </span>
              ) : null}
            </span>
          ))}
        </p>
        <span className="sentence__gloss">{exercise.gloss}</span>
      </div>

      <div className="stack stack--tight">
        {exercise.options.map((option) => (
          <button
            key={option}
            type="button"
            className={`option${
              answered && option === exercise.answer ? ' option--correct' : ''
            }${answered && option === chosen && !correct ? ' option--wrong' : ''}`}
            disabled={answered}
            onClick={() => setChosen(option)}
          >
            <span className="option__label">{option}</span>
          </button>
        ))}
      </div>

      {answered ? (
        <BigButton
          label="Next"
          {...(correct ? {} : { hint: `The answer is ${exercise.answer}` })}
          onClick={() => onAnswered(correct)}
        />
      ) : null}
    </div>
  );
}

/** The same gap, with nothing to choose from. */
function Typed({
  exercise,
  onAnswered,
}: {
  exercise: Extract<GrammarExercise, { kind: 'type' }>;
  onAnswered: (correct: boolean) => void;
}) {
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const correct = checkTypedForm(typed, exercise.answer);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!checked) setChecked(true);
        else onAnswered(correct);
      }}
    >
      <Caption>Write the missing word.</Caption>
      <div className="card card--quiet">
        <p className="sentence">
          {exercise.sentence.split(BLANK).map((part, index, parts) => (
            <span key={index}>
              {part}
              {index < parts.length - 1 ? (
                <span className={`gap${checked ? (correct ? ' gap--right' : ' gap--wrong') : ''}`}>
                  {checked ? exercise.answer : BLANK}
                </span>
              ) : null}
            </span>
          ))}
        </p>
        <span className="sentence__gloss">{exercise.gloss}</span>
      </div>

      <input
        className="field field--answer"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        disabled={checked}
        placeholder="Type it"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        aria-label="The missing word"
      />

      {checked ? (
        <BigButton
          label="Next"
          hint={correct ? 'Right' : `You wrote ${typed || 'nothing'}`}
          onClick={() => onAnswered(correct)}
        />
      ) : (
        <BigButton label="Check" disabled={typed.trim().length === 0} onClick={() => setChecked(true)} />
      )}
    </form>
  );
}

/**
 * The pattern, with the explanation withheld.
 *
 * Self-graded on purpose, and last. There is no way to mark "did you actually
 * understand the rule" automatically, and pretending otherwise would be worse
 * than asking — but it is asked at the end of a sitting that has already
 * tested the same point three other ways, so the answer means something.
 */
function Recall({
  exercise,
  onAnswered,
}: {
  exercise: Extract<GrammarExercise, { kind: 'recall' }>;
  onAnswered: (correct: boolean) => void;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="stack">
      <Caption>What does this pattern do?</Caption>
      <div className="card card--quiet">
        <span className="recall__form">{exercise.form}</span>
        <span className="pattern pattern--inline">{exercise.pattern}</span>
      </div>

      {shown ? (
        <>
          <p className="prose">{exercise.answer}</p>
          <Row>
            <button type="button" className="verdict__button" onClick={() => onAnswered(false)}>
              Not quite
            </button>
            <button
              type="button"
              className="verdict__button verdict__button--good"
              onClick={() => onAnswered(true)}
            >
              That is what I had
            </button>
          </Row>
        </>
      ) : (
        <BigButton label="Show it" onClick={() => setShown(true)} />
      )}
    </div>
  );
}

/** "in 3 days", from two timestamps. */
function describeWhen(due: string, now: string): string {
  const days = Math.round((Date.parse(due) - Date.parse(now)) / 86_400_000);
  if (Number.isNaN(days)) return 'soon';
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
