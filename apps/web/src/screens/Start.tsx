import { useMemo, useState } from 'react';
import {
  cardKindsForLanguage,
  addDays,
  getExamTracksForLanguage,
  getLanguageProfile,
  getTeacher,
  usesCharacterWriting,
  suggestDailyNewLimit,
  toDateOnly,
  type CardKind,
  type LanguageCode,
} from '@language-srs/core';
import { TeacherAvatar } from '../components/Teacher';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { useSettings } from '../settings';
import { BigButton, Caption, Choice, Row, Screen, Section, TextButton, Title } from '../ui';
import { DateField } from '../components/DateField';

/**
 * What do you want from this language?
 *
 * Choosing a language used to drop you straight into a deck that had already
 * decided: the first exam track the app lists, its lowest level, fifteen new
 * cards a day, no date. All reasonable defaults, and all invisible — the
 * settings screen existed but nothing sent anybody there, so the answer to
 * "what am I being taught and why" was buried two taps behind a review queue
 * that had already started.
 *
 * Asked once, when it is the only thing you could be thinking about, and never
 * again: `setUpAt` on the profile is the record that somebody answered. Every
 * answer here is also in Settings afterwards, so this is a head start rather
 * than a gate — which is why the skip is a real option and not a dark pattern
 * with a sad face on it.
 *
 * ## Why these four questions
 *
 * The exam and the level decide which words exist at all. The date decides
 * whether the scheduler is pacing you or racing you. The shape decides which
 * memories get built, and is the one most people do not know they are allowed
 * to choose — an exam-faithful mix is right for somebody sitting the paper and
 * quite wrong for somebody who wants to talk to their in-laws.
 */

/**
 * The shapes a training programme can take, for one language.
 *
 * Stated as whole choices rather than eight toggles. Eight checkboxes labelled
 * with card kinds asks a learner to design a curriculum out of vocabulary they
 * do not have; four named intentions ask them what they want, which they do
 * know. The toggles still exist in Settings for anybody who wants them.
 *
 * `kinds: undefined` means "do not override" — the exam level's own weights
 * decide, which is the exam-faithful behaviour and why it is the default.
 *
 * Built from the language rather than written out once. The first version was
 * a constant, and it offered a Japanese learner "the tones that make it land"
 * — Japanese has no tones, and the `tone` cards it promised would never have
 * been generated. Both the wording and the card kinds now come from
 * `tonal` and `scripts`, so a language that gains either gets the right
 * description without this file being touched.
 */
function shapesFor(code: LanguageCode): {
  id: string;
  name: string;
  line: string;
  kinds?: CardKind[];
}[] {
  const { tonal } = getLanguageProfile(code);
  const handwritten = usesCharacterWriting(code);
  const available = cardKindsForLanguage(code);

  /** Everything this language has, minus the kinds a shape deliberately drops. */
  const without = (...drop: CardKind[]) =>
    available.filter((kind: CardKind) => !drop.includes(kind));

  return [
    {
      id: 'exam',
      name: 'Sitting the exam',
      line: 'The mix the paper actually tests, in the proportions it tests them.',
    },
    {
      id: 'understand',
      name: 'Reading and listening',
      line: handwritten
        ? 'Understanding first. No handwriting, no producing from cold.'
        : 'Understanding first. Nothing you have to produce from cold.',
      kinds: without('production', 'writing'),
    },
    {
      id: 'speak',
      name: 'Speaking to people',
      line: tonal
        ? 'Producing the word yourself, and the tones that make it land.'
        : 'Producing the word yourself, by meaning and by ear.',
      kinds: without('writing', 'reading'),
    },
    {
      id: 'everything',
      name: 'All of it',
      line: handwritten
        ? 'Every kind of card, including writing the characters by hand.'
        : 'Every kind of card this language has.',
      kinds: without(),
    },
  ];
}

export function Start() {
  const { engine, revision } = useEngine();
  const { updateLanguage } = useSettings();
  const { navigate } = useRouter();

  const code: LanguageCode = engine.activeLanguage;
  const language = getLanguageProfile(code);
  const teacher = getTeacher(code);
  const profile = useMemo(() => engine.getProfile(code), [engine, revision, code]);

  const tracks = getExamTracksForLanguage(code);
  const [trackId, setTrackId] = useState(profile.examTrackId);
  const track = tracks.find((candidate) => candidate.id === trackId) ?? tracks[0];
  const levels = useMemo(
    () => [...(track?.levels ?? [])].sort((left, right) => left.order - right.order),
    [track],
  );

  const [levelId, setLevelId] = useState(
    () => (levels.find((level) => level.id === profile.targetLevelId) ?? levels[0])?.id ?? '',
  );
  const [examDate, setExamDate] = useState<string>(profile.examDate ?? '');
  const [shape, setShape] = useState('exam');
  const [saving, setSaving] = useState(false);

  const shapes = useMemo(() => shapesFor(code), [code]);
  const chosen = shapes.find((candidate) => candidate.id === shape) ?? shapes[0]!;
  const level = levels.find((candidate) => candidate.id === levelId);

  /*
   * The pace, worked out rather than asked for.
   *
   * Asking "how many new words a day?" of somebody who has not started is
   * asking them to guess at something the app can derive: the level's word
   * count and the date they just gave are enough. Without a date it stays at
   * the default, because there is nothing to pace against.
   */
  const suggested =
    examDate && levelId ? suggestDailyNewLimit(levelId, engine.now(), examDate) : undefined;

  const begin = async () => {
    setSaving(true);
    try {
      await updateLanguage(
        {
          examTrackId: trackId,
          targetLevelId: levelId,
          // Null clears it, which is what an empty field means here.
          examDate: examDate ? examDate : null,
          ...(chosen.kinds ? { enabledCardKinds: chosen.kinds } : {}),
          ...(suggested !== undefined ? { dailyNewLimit: suggested } : {}),
          setUpAt: engine.now(),
        },
        code,
      );
      navigate('/home', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  /** Leave the defaults in place, but do not ask again. */
  const skip = async () => {
    setSaving(true);
    try {
      await updateLanguage({ setUpAt: engine.now() }, code);
      navigate('/home', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen layer="day">
      <header className="start__head">
        <TeacherAvatar teacher={teacher} size="large" />
        <div>
          <Title>{language.name}</Title>
          <Caption>
            {teacher.romanised} will take you through it. A few questions first — all of them
            changeable later.
          </Caption>
        </div>
      </header>

      {tracks.length > 1 ? (
        <Section title="Which exam">
          <Row wrap>
            {tracks.map((candidate) => (
              <Choice
                key={candidate.id}
                label={candidate.name}
                selected={candidate.id === trackId}
                onClick={() => {
                  setTrackId(candidate.id);
                  // The level ids belong to the track, so keeping the old one
                  // would leave a profile pointing at a level that is not in
                  // the track it claims to be studying.
                  const first = [...candidate.levels].sort((l, r) => l.order - r.order)[0];
                  if (first) setLevelId(first.id);
                }}
              />
            ))}
          </Row>
          {track?.note ? <Caption>{track.note}</Caption> : null}
        </Section>
      ) : null}

      <Section title={tracks.length > 1 ? 'Which level' : `Which ${track?.name ?? 'level'}`}>
        <Row wrap>
          {levels.map((candidate) => (
            <Choice
              key={candidate.id}
              label={candidate.shortName}
              selected={candidate.id === levelId}
              onClick={() => setLevelId(candidate.id)}
            />
          ))}
        </Row>
        {level ? (
          <>
            <Caption>{level.description}</Caption>
            <Caption>
              {level.vocabularyTarget.toLocaleString()} words
              {level.characterTarget
                ? ` and ${level.characterTarget.toLocaleString()} characters`
                : ''}
              . Everything at this level and below is in scope.
            </Caption>
            {track && !track.targetsAreOfficial ? (
              <Caption>{track.authority} publishes no word list, so that is an estimate.</Caption>
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="Have you booked a date?">
        <DateField
          label="Exam date"
          value={examDate}
          min={toDateOnly(engine.now())}
          onChange={setExamDate}
        />
        <Row wrap>
          {[30, 90, 180].map((days) => (
            <Choice
              key={days}
              label={`In ${days} days`}
              selected={false}
              onClick={() => setExamDate(toDateOnly(addDays(engine.now(), days)))}
            />
          ))}
          {examDate ? (
            <Choice label="No date yet" selected={false} onClick={() => setExamDate('')} />
          ) : null}
        </Row>
        <Caption>
          {examDate
            ? 'Intervals will tighten as it approaches, so nothing is scheduled to land after the paper.'
            : 'Optional. Without one the scheduler paces you for retention instead of for a deadline.'}
        </Caption>
        {suggested !== undefined ? (
          <Caption loud>
            To cover the level by then: about {suggested} new words a day. That is what you will
            start on.
          </Caption>
        ) : null}
      </Section>

      <Section title="What do you want out of it?">
        <div className="shapes">
          {shapes.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`shape${candidate.id === shape ? ' shape--on' : ''}`}
              aria-pressed={candidate.id === shape}
              onClick={() => setShape(candidate.id)}
            >
              <span className="shape__name">{candidate.name}</span>
              <span className="shape__line">{candidate.line}</span>
            </button>
          ))}
        </div>
        {/* The examples are drawn from the language too, so this does not
            offer handwriting to somebody studying Vietnamese. */}
        <Caption>
          This decides which kinds of card get made — recognising a word, producing it, hearing it
          {usesCharacterWriting(code) ? ', writing it by hand' : ''}. Changeable whenever, card by
          card, in Settings.
        </Caption>
      </Section>

      <BigButton
        label={saving ? 'Setting up…' : 'Start learning'}
        onClick={() => void begin()}
        disabled={saving || !levelId}
      />
      <TextButton label="Skip — use the defaults" muted onClick={() => void skip()} />
    </Screen>
  );
}
