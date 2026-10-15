import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CARD_KINDS,
  buildQuestion,
  checkTypedAnswer,
  isAutoGraded,
  isTypingFeasible,
  kindLabel,
  stageEarned,
  suggestRating,
  RATING_LABELS,
  type AnswerAttempt,
  type AnswerMode,
  type AnswerOption,
  type CardKind,
  type CardWithEntry,
  type LexicalEntry,
  type Rating,
} from '@language-srs/core';
import { TeacherSays } from '../components/Teacher';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Row, Screen, TextButton, Title, ToneText } from '../ui';
import { useTheme } from '../theme';

/**
 * The review session.
 *
 * Cards are answered rather than merely revealed, because HSK, JLPT and TOPIK are
 * almost entirely multiple choice and a learner who has only self-graded has
 * never practised picking the right option out of four with three plausible ones
 * beside it. Self-grading survives where it is genuinely right — handwriting, and
 * any card whose pool cannot yield real distractors.
 *
 * Speech uses the Web Speech API rather than expo-speech: same job, already in
 * the browser.
 */

const ANSWER_PROMPTS: Partial<Record<AnswerMode, string>> = {
  choice: 'Pick the answer',
  typed: 'Type it',
};

/**
 * What to say when there is nothing to study.
 *
 * One line, because there is one queue. The session modes this screen used to
 * offer — learn-only, cram — are not in `buildStudyQueue` here, which
 * interleaves card kinds by the exam level's weights and takes no mode.
 */
const EMPTY_COPY = 'Come back when reviews are ready, or raise your daily new-card limit.';

const SPEECH_LOCALES: Record<string, string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  vi: 'vi-VN',
};

function speak(text: string, languageCode: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LOCALES[languageCode] ?? languageCode;
  utterance.rate = 0.85;
  speechSynthesis.speak(utterance);
}

export function Review() {
  const { engine, revision, grade, mutate } = useEngine();
  const { palette } = useTheme();
  const { navigate, query } = useRouter();

  const pinnedCard = query.get('card') ?? undefined;
  const forcedReveal = query.get('reveal') === '1';

  const [revealed, setRevealed] = useState(forcedReveal);
  const [attempt, setAttempt] = useState<AnswerAttempt | undefined>();
  const [chosenId, setChosenId] = useState<string | undefined>();
  const [session, setSession] = useState({ reviewed: 0, recalled: 0 });
  const [missed, setMissed] = useState<LexicalEntry[]>([]);
  const [preferTyped, setPreferTyped] = useState(false);
  const [typed, setTyped] = useState('');

  const shownAt = useRef(Date.now());
  // Guards a double-tap grading the same card twice: the queue does not move
  // until the await resolves, so a second press inside that window would land on
  // the card already being graded.
  const grading = useRef(false);
  const history = useRef<{ rating: Rating; missedEntryId?: string }[]>([]);
  const missedIds = useRef(new Set<string>());
  const knownAtStart = useRef(engine.getStats().coverage.entriesKnown);


  /*
   * The queue, whole. `kind` from a widget deep link is honoured by pinning the
   * card it names rather than by filtering the queue, because filtering is not
   * something this `buildStudyQueue` does.
   */
  const queue = useMemo(() => engine.getQueue(), [engine, revision]);

  const current: CardWithEntry | undefined = useMemo(() => {
    if (pinnedCard) {
      const found = queue.cards.find((pair) => pair.card.id === pinnedCard);
      if (found) return found;
    }
    return queue.cards[0];
  }, [queue, pinnedCard]);

  const pool = useMemo(
    () => (current ? engine.getEntries(current.card.languageCode) : []),
    [engine, current],
  );

  /*
   * Mode, distractors and previews come from the core as one `Question`.
   *
   * This was three separate memos here, and the same three in the Expo app, and
   * the server would have made a fourth. Three implementations of "which wrong
   * answers are plausible" would drill three different exams — so the assembly
   * lives in `buildQuestion` and this screen renders what it is handed.
   */
  const question = useMemo(() => {
    if (!current) return undefined;
    // A widget tap that already revealed the answer cannot then be asked as a
    // question — the learner has seen it.
    const revealed = forcedReveal && pinnedCard === current.card.id;
    const preferred: AnswerMode | undefined = revealed ? 'self' : preferTyped ? 'typed' : undefined;

    return buildQuestion({
      pair: current,
      pool,
      profile: engine.getProfile(current.card.languageCode),
      now: engine.now(),
      ...(preferred ? { preferred } : {}),
    });
  }, [current, pool, preferTyped, forcedReveal, pinnedCard, engine]);

  const mode = question?.mode ?? 'self';
  const options = question?.options ?? [];
  const previews = question?.previews;

  // Listening cards lead with audio rather than making the learner hunt for it.
  useEffect(() => {
    if (!current) return;
    shownAt.current = Date.now();
    setRevealed(forcedReveal);
    setAttempt(undefined);
    setChosenId(undefined);
    setTyped('');
    if (current.card.kind === 'listening') speak(current.entry.target, current.entry.languageCode);
  }, [current?.card.id]);

  const commitGrade = useCallback(
    async (rating: Rating) => {
      if (!current || grading.current) return;
      grading.current = true;

      const entry = current.entry;
      await grade(current.card.id, rating, {
        durationMs: Date.now() - shownAt.current,
        source: 'app',
      });

      setSession((previous) => ({
        reviewed: previous.reviewed + 1,
        recalled: previous.recalled + (rating > 1 ? 1 : 0),
      }));

      const addedToMissed = rating === 1 && !missedIds.current.has(entry.id);
      if (addedToMissed) {
        missedIds.current.add(entry.id);
        setMissed((previous) => [...previous, entry]);
      }
      history.current.push({ rating, ...(addedToMissed ? { missedEntryId: entry.id } : {}) });

      setRevealed(false);
      setAttempt(undefined);
      setChosenId(undefined);
      grading.current = false;
    },
    [current, grade],
  );

  /**
   * Record an answer without grading it.
   *
   * Nothing is committed here, including when the answer was wrong. The learner
   * has just been told they were wrong and the useful moment is the one
   * immediately after — seeing the right answer next to the option they took.
   */
  const settleAttempt = useCallback((next: AnswerAttempt) => {
    setAttempt(next);
    setRevealed(true);
  }, []);

  const onChoose = useCallback(
    (option: AnswerOption) => {
      if (attempt) return;
      setChosenId(option.id);
      settleAttempt({
        mode: mode === 'tone' ? 'tone' : 'choice',
        correct: option.correct,
        chosenOptionId: option.id,
        durationMs: Date.now() - shownAt.current,
      });
    },
    [attempt, mode, settleAttempt],
  );

  const onType = useCallback(() => {
    if (!current || attempt) return;
    const check = checkTypedAnswer(typed, current.card, current.entry);
    settleAttempt({
      mode: 'typed',
      correct: check.correct,
      text: typed,
      check,
      durationMs: Date.now() - shownAt.current,
    });
  }, [attempt, current, typed, settleAttempt]);

  const suggested = attempt?.correct ? suggestRating(attempt) : undefined;
  const settledWrong = attempt !== undefined && isAutoGraded(attempt);

  const onUndo = useCallback(async () => {
    const undone = await mutate((instance) => instance.undoLastGrade());
    if (!undone) return;

    const last = history.current.pop();
    setSession((previous) => ({
      reviewed: Math.max(0, previous.reviewed - 1),
      recalled: Math.max(0, previous.recalled - (last && last.rating > 1 ? 1 : 0)),
    }));
    if (last?.missedEntryId) {
      missedIds.current.delete(last.missedEntryId);
      setMissed((previous) => previous.filter((entry) => entry.id !== last.missedEntryId));
    }
    setRevealed(false);
    setAttempt(undefined);
    setChosenId(undefined);
  }, [mutate]);

  /**
   * Keyboard.
   *
   * The number keys mean the same thing in both phases — pick the nth thing in
   * front of you — because the options and the grade buttons are never on screen
   * asking for a number at the same time.
   */
  useEffect(() => {
    if (!current) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const digit = Number(event.key);
      if (digit >= 1 && digit <= 4) {
        if (!revealed && (mode === 'choice' || mode === 'tone')) {
          const option = options[digit - 1];
          if (option) {
            event.preventDefault();
            onChoose(option);
          }
          return;
        }
        if (revealed) {
          event.preventDefault();
          void commitGrade(digit as Rating);
        }
        return;
      }

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!revealed && mode === 'self') setRevealed(true);
        else if (settledWrong) void commitGrade(1);
        else if (revealed) void commitGrade(suggested ?? 3);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, mode, options, revealed, settledWrong, suggested, onChoose, commitGrade]);

  if (!current || !previews) {
    const accuracy = session.reviewed > 0 ? Math.round((session.recalled / session.reviewed) * 100) : 0;
    const earned = stageEarned(
      engine.activeLanguage,
      knownAtStart.current,
      engine.getStats().coverage.entriesKnown,
    );

    return (
      <Screen>
        <div className="pop hero">
          <Title>{session.reviewed > 0 ? 'Done' : 'Nothing waiting'}</Title>
          <Caption>
            {session.reviewed > 0
              ? `${session.reviewed} card${session.reviewed === 1 ? '' : 's'}, ${accuracy}% recalled.`
              : EMPTY_COPY}
          </Caption>
        </div>

        {/*
          Closed by somebody rather than by a progress bar.

          Seeded by the session's own count, so the line is fixed for this
          sitting instead of changing if the screen re-renders — and so two
          sessions in a row are not met with the same sentence.
        */}
        {session.reviewed > 0 ? (
          <Rise index={0}>
            <TeacherSays code={engine.activeLanguage} mood="finished" seed={session.reviewed} />
          </Rise>
        ) : null}

        {/*
          The one celebration in the app, and it fires only when a stage was
          genuinely crossed. A reward that arrives every session is a sound
          effect.
        */}
        {earned ? (
          <Rise index={1}>
            <div className="earned">
              <span className="earned__glyph">{earned.native}</span>
              <span className="earned__name">{earned.romanised ?? earned.native}</span>
              <Caption>
                {earned.meaning} · reached {earned.wordsRequired} words known
              </Caption>
            </div>
          </Rise>
        ) : null}

        {missed.length > 0 ? (
          <Rise index={2}>
            <div className="section">
              <h2 className="section__title">To come back to</h2>
              {missed.map((entry) => (
                <div key={entry.id} className="detail">
                  <span className="heading">{entry.target}</span>
                  <span className="detail__value">{entry.meanings.join(', ')}</span>
                </div>
              ))}
            </div>
          </Rise>
        ) : null}

        <Rise index={3}>
          <BigButton label="Back home" onClick={() => navigate('/home')} />
        </Rise>
        <Rise index={4}>
          <Row center>
            <TextButton label="Add more words" onClick={() => navigate('/import')} />
          </Row>
        </Rise>
      </Screen>
    );
  }

  const total = queue.cards.length + session.reviewed;
  const typingFeasible = isTypingFeasible(current.card, current.entry);

  return (
    <Screen layer="loop">
      {/*
        The loop's own chrome, and all of it.

        There is no title bar above this screen — a header saying "Review" over
        a card the learner is already looking at is a second thing competing
        for the only attention that matters. What is left is where you are and
        a quiet way out, and the way out has to be here precisely because the
        shared one is gone.
      */}
      <div className="progress">
        <div className="progress__row">
          <Caption>
            {session.reviewed + 1} of {total}
          </Caption>
          <button
            type="button"
            className="progress__leave"
            onClick={() => navigate('/home')}
            aria-label="Leave this session"
          >
            Done
          </button>
        </div>
        <div className="track">
          <div
            className="track__fill"
            style={{ width: `${total > 0 ? (session.reviewed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/*
        Card and options are one block. They were a centred card over a pinned
        footer, which opened a hand's width of nothing between the word and its
        options on a tall screen.
      */}
      <div className="deal question" key={current.card.id}>
        <ReviewCard
          pair={current}
          revealed={revealed}
          {...(mode === 'self' ? { onReveal: () => setRevealed(true) } : {})}
          {...(ANSWER_PROMPTS[mode] ? { prompt: ANSWER_PROMPTS[mode] } : {})}
        />

        {mode === 'choice' || mode === 'tone' ? (
          <ChoiceAnswer options={options} chosenId={chosenId} onChoose={onChoose} />
        ) : null}

        {mode === 'typed' ? (
          attempt?.check ? (
            <div className="verdict">
              <span
                className="verdict__word"
                style={{
                  color:
                    attempt.check.quality === 'exact'
                      ? palette.good
                      : attempt.check.quality === 'close'
                        ? palette.hard
                        : palette.again,
                }}
              >
                {attempt.check.quality === 'exact'
                  ? 'Correct'
                  : attempt.check.quality === 'close'
                    ? 'So close'
                    : 'Not quite'}
              </span>
              {attempt.check.quality !== 'exact' ? (
                <span className="verdict__expected">{attempt.check.expected}</span>
              ) : null}
              {attempt.check.note ? <Caption>{attempt.check.note}</Caption> : null}
            </div>
          ) : (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                onType();
              }}
            >
              <input
                className="field"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Type your answer"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              <BigButton label="Check" onClick={onType} disabled={typed.trim().length === 0} />
            </form>
          )
        ) : null}
      </div>

      <div className="stack">
        {!revealed && mode === 'self' ? (
          <BigButton label="Reveal" onClick={() => setRevealed(true)} />
        ) : null}

        {revealed && settledWrong ? (
          <BigButton label="Got it" hint="Scheduled to come back soon" onClick={() => void commitGrade(1)} />
        ) : null}

        {revealed && !settledWrong ? (
          <div className="grades">
            {([1, 2, 3, 4] as Rating[]).map((rating) => (
              <button
                key={rating}
                type="button"
                className="grade"
                onClick={() => void commitGrade(rating)}
                aria-label={`${RATING_LABELS[rating]}, next in ${previews[rating].display}${
                  rating === suggested ? ', suggested' : ''
                }`}
                style={
                  rating === suggested
                    ? { borderColor: gradeColour(rating, palette), borderWidth: 1.5, borderStyle: 'solid' }
                    : undefined
                }
              >
                <span className="grade__label" style={{ color: gradeColour(rating, palette) }}>
                  {RATING_LABELS[rating]}
                </span>
                <span className="grade__interval">{previews[rating].display}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/*
          Session controls, all in muted ink. They are deliberately the quietest
          thing on the screen: the accent belongs to the action you came to take.
        */}
        <Row tight>
          {engine.canUndo && session.reviewed > 0 ? (
            <TextButton label="Undo" muted onClick={() => void onUndo()} />
          ) : null}
          {!revealed && typingFeasible && mode !== 'typed' ? (
            <TextButton label="Type instead" muted onClick={() => setPreferTyped(true)} />
          ) : null}
          {!revealed && mode === 'typed' ? (
            <TextButton label="Show options" muted onClick={() => setPreferTyped(false)} />
          ) : null}
          <span className="spacer" />
          <TextButton
            label="Bury"
            muted
            onClick={() => void mutate((instance) => instance.setCardBuried(current.card.id))}
          />
          <TextButton
            label="Suspend"
            muted
            onClick={() => void mutate((instance) => instance.setCardSuspended(current.card.id, true))}
          />
        </Row>
      </div>
    </Screen>
  );
}

function gradeColour(rating: Rating, palette: { again: string; hard: string; good: string; easy: string }) {
  return { 1: palette.again, 2: palette.hard, 3: palette.good, 4: palette.easy }[rating];
}

/**
 * Multiple choice.
 *
 * Options stay on screen after answering, marked. Clearing them and showing only
 * the right answer removes the one thing worth seeing: which distractor you fell
 * for.
 */
function ChoiceAnswer({
  options,
  chosenId,
  onChoose,
}: {
  options: AnswerOption[];
  chosenId?: string;
  onChoose: (option: AnswerOption) => void;
}) {
  const answered = chosenId !== undefined;

  return (
    <div className="choices">
      {options.map((option, index) => {
        const chosen = option.id === chosenId;
        const showAsCorrect = answered && option.correct;
        const showAsWrong = answered && chosen && !option.correct;

        return (
          <button
            key={option.id}
            type="button"
            className={`option${showAsCorrect ? ' option--correct' : ''}${
              showAsWrong ? ' option--wrong' : ''
            }${answered && !showAsCorrect && !showAsWrong ? ' option--dimmed' : ''}`}
            onClick={() => !answered && onChoose(option)}
            disabled={answered}
            aria-label={`${index + 1}. ${option.label}`}
          >
            {/*
              One slot, two jobs: the index doubles as the keyboard shortcut, and
              becomes the verdict once answered — a glyph rather than colour
              alone, since the Mandarin tone ramp reuses the grade colours and
              red/green says nothing to a colour-blind reader.
            */}
            <span className="option__index">
              {showAsCorrect ? '✓' : showAsWrong ? '✕' : answered ? '' : index + 1}
            </span>
            <span className="option__text">
              <span className="option__label">{option.label}</span>
              {option.sublabel ? <span className="option__sub">{option.sublabel}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The flashcard.
 *
 * What goes on the front depends on the card kind: production shows the gloss and
 * withholds the target, listening leads with audio and withholds the written
 * form, tone shows the word but not the reading, reading blanks the target out of
 * its example sentence.
 */
function ReviewCard({
  pair,
  revealed,
  onReveal,
  prompt,
}: {
  pair: CardWithEntry;
  revealed: boolean;
  onReveal?: () => void;
  prompt?: string;
}) {
  const { palette, toneColor } = useTheme();
  const { card, entry } = pair;
  const hint = prompt ?? (onReveal ? 'Tap to reveal' : undefined);
  const example = entry.examples[0];
  const frontShowedTarget = card.kind === 'recognition' || card.kind === 'tone' || card.kind === 'script';

  return (
    <div className="card">
      <div className="row row--between">
        <span className="pill">{kindLabel(card.kind)}</span>
        <span className="micro">{entry.partOfSpeech ?? ''}</span>
      </div>

      <div className="front" onClick={revealed ? undefined : onReveal}>
        <CardFront pair={pair} revealed={revealed} />
      </div>

      {revealed ? (
        <div className="rise answer">
          {frontShowedTarget ? null : (
            <ToneText
              text={entry.target}
              {...(entry.tones ? { tones: entry.tones } : {})}
              languageCode={entry.languageCode}
              size={28}
            />
          )}
          <div className="row row--center row--tight">
            <span className="answer__reading">{entry.reading}</span>
            <button
              type="button"
              aria-label="Play pronunciation"
              style={{ color: palette.accent, fontSize: 17 }}
              onClick={() => speak(entry.target, entry.languageCode)}
            >
              ♪
            </button>
          </div>
          <span className="answer__meaning">{entry.meanings.join(', ')}</span>

          {entry.tones && entry.tones.length > 0 ? (
            <div className="row row--center" style={{ gap: 4 }}>
              {entry.tones.map((tone, index) => (
                <span
                  key={`${tone}-${index}`}
                  className="tone-pip"
                  style={{ background: toneColor(tone) }}
                />
              ))}
            </div>
          ) : null}

          {example ? (
            <div className="example">
              <span className="example__target">{example.target}</span>
              <Caption>{example.translation}</Caption>
            </div>
          ) : null}
        </div>
      ) : hint ? (
        <Caption>{hint}</Caption>
      ) : null}
    </div>
  );
}

function CardFront({ pair, revealed }: { pair: CardWithEntry; revealed: boolean }) {
  const { palette } = useTheme();
  const { card, entry } = pair;

  switch (card.kind) {
    case 'production':
      return <span className="prompt-gloss">{entry.meanings.join(', ')}</span>;

    case 'listening':
      return (
        <div className="front__stack">
          <button
            type="button"
            className="speak"
            aria-label="Play audio"
            style={{ background: palette.accentSoft, color: palette.accent }}
            onClick={() => speak(entry.target, entry.languageCode)}
          >
            ▶
          </button>
          <Caption>{revealed ? 'Tap to hear it again' : 'What did you hear?'}</Caption>
        </div>
      );

    case 'reading': {
      const example = entry.examples[0];
      if (!example) break;
      return <span className="prompt-sentence">{example.target.split(entry.target).join('____')}</span>;
    }

    case 'tone':
      return (
        <div className="front__stack">
          <span className="prompt-target">{entry.target}</span>
          <Caption>Which tones?</Caption>
        </div>
      );

    case 'writing':
      return (
        <div className="front__stack">
          <span className="prompt-gloss">{entry.meanings.join(', ')}</span>
          <Caption>{entry.reading}</Caption>
        </div>
      );

    case 'script':
      return <span className="prompt-target">{entry.target}</span>;

    default:
      break;
  }

  return (
    <ToneText
      text={entry.target}
      {...(entry.tones ? { tones: entry.tones } : {})}
      languageCode={entry.languageCode}
      size={entry.target.length > 6 ? 28 : 46}
    />
  );
}
