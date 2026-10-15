import { useMemo, useState } from 'react';
import {
  addDays,
  findExamTrack,
  getExamTracksForLanguage,
  getLanguageProfile,
  suggestDailyNewLimit,
  toDateOnly,
} from '@language-srs/core';
import { SyncStatus } from '../components/SyncStatus';
import { useAuth, useEngine } from '../providers';
import { useSettings } from '../settings';
import { DateField } from '../components/DateField';
import { Maker } from '../components/Maker';
import { useRouter } from '../router';
import { Caption, Choice, DetailRow, Rise, Row, Screen, Section, TextButton } from '../ui';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Settings.
 *
 * Grouped into the questions a learner actually has — which exam, which level,
 * when, how much per day — with explanation only where a choice is genuinely
 * non-obvious.
 */
export function Settings() {
  const { engine, revision, mutate } = useEngine();
  const {
    backdrop,
    dayStartHour,
    setBackdrop,
    setDayStartHour,
    setExamTrack,
    updateLanguage,
    error,
  } = useSettings();
  const { account, synced, canSignIn, signOut } = useAuth();
  const { navigate } = useRouter();

  const code = engine.activeLanguage;
  const profile = useMemo(() => engine.getProfile(code), [engine, revision, code]);
  const available = useMemo(() => engine.getAvailableWordCount(code), [engine, revision, code]);
  const language = getLanguageProfile(code);
  const tracks = getExamTracksForLanguage(code);
  const track = findExamTrack(profile.examTrackId);
  const level = track?.levels.find((candidate) => candidate.id === profile.targetLevelId);

  const [dateDraft, setDateDraft] = useState(profile.examDate ?? '');

  const suggestedNewLimit =
    profile.examDate && DATE_PATTERN.test(profile.examDate)
      ? suggestDailyNewLimit(profile.targetLevelId, engine.now(), profile.examDate)
      : undefined;

  /*
   * No format check any more.
   *
   * `<input type="date">` returns `YYYY-MM-DD` or an empty string and cannot
   * return anything else, so the pattern test and its error message were
   * guarding a state the control makes impossible.
   */
  const commitDate = async (value: string) => {
    await updateLanguage({ examDate: value ? value : null });
  };

  const shortfall = level ? Math.max(0, level.vocabularyTarget - available) : 0;

  return (
    <Screen>
      <Rise index={0}>
        <Caption>
          Exam, level and daily amounts apply to {language.name}. Your day and the background
          apply everywhere.
        </Caption>
        {/*
          Said, not hidden, and not undone. A failed push leaves the setting
          applied here — rolling back a choice somebody just made because the
          network blinked is worse than it being a moment behind the server.
        */}
        {error ? <Caption>Saved on this device. Not reaching the server: {error}</Caption> : null}
      </Rise>

      {tracks.length > 1 ? (
        <Rise index={1}>
          <Section title="Exam">
            <Row wrap>
              {tracks.map((candidate) => (
                <Choice
                  key={candidate.id}
                  label={candidate.name}
                  selected={candidate.id === profile.examTrackId}
                  onClick={() => void setExamTrack(candidate.id)}
                />
              ))}
            </Row>
            {track?.note ? <Caption>{track.note}</Caption> : null}
          </Section>
        </Rise>
      ) : null}

      <Rise index={2}>
        <Section title="Level">
          <Row wrap>
            {(track?.levels ?? []).map((candidate) => (
              <Choice
                key={candidate.id}
                label={candidate.shortName}
                selected={candidate.id === profile.targetLevelId}
                onClick={() => void updateLanguage({ targetLevelId: candidate.id })}
              />
            ))}
          </Row>
          {level ? (
            <>
              <Caption>{level.description}</Caption>
              {/*
                Two rows, because they are two different facts. "Target
                vocabulary: 500 words" run together with the deck size was the
                screen's worst lie — it promised 500 words to study when the deck
                holds a few dozen.
              */}
              <DetailRow
                label="The exam covers"
                value={`${level.vocabularyTarget.toLocaleString()} words${
                  level.characterTarget ? ` · ${level.characterTarget.toLocaleString()} characters` : ''
                }`}
              />
              <DetailRow
                label="In your deck"
                value={`${available.toLocaleString()} word${available === 1 ? '' : 's'}`}
              />
              {shortfall > 0 ? (
                <>
                  <Caption>
                    {available === 0
                      ? 'No words for this level yet.'
                      : `${shortfall.toLocaleString()} of the exam's words are not in your deck yet.`}
                  </Caption>
                  <TextButton label="Add words" onClick={() => navigate('/import')} />
                </>
              ) : null}
              {track && !track.targetsAreOfficial ? (
                <Caption>{track.authority} publishes no word list, so this is an estimate.</Caption>
              ) : null}
            </>
          ) : null}
        </Section>
      </Rise>

      <Rise index={3}>
        <Section title="Exam date">
          {/*
            A calendar, not a text box expecting YYYY-MM-DD. Somebody booking
            an exam wants to see which day of the week it lands on and count
            the weeks to it, which a text box cannot do — and the native
            control cannot return a malformed date, so the format error this
            section used to show is gone with the thing that caused it.
          */}
          <DateField
            label="Exam date"
            value={dateDraft}
            min={toDateOnly(engine.now())}
            onChange={(next) => {
              setDateDraft(next);
              void commitDate(next);
            }}
          />
          <Row wrap>
            {[30, 90, 180].map((days) => (
              <Choice
                key={days}
                label={`In ${days} days`}
                selected={false}
                onClick={() => {
                  const next = toDateOnly(addDays(engine.now(), days));
                  setDateDraft(next);
                  void commitDate(next);
                }}
              />
            ))}
            {dateDraft ? (
              <Choice
                label="Clear"
                selected={false}
                onClick={() => {
                  setDateDraft('');
                  void commitDate('');
                }}
              />
            ) : null}
          </Row>
          <Caption>
            With a date set, intervals tighten as the exam approaches so nothing lands after the paper.
          </Caption>
          {suggestedNewLimit !== undefined ? (
            <Caption>
              To cover what is in your deck by then: about {suggestedNewLimit} new words a day.
            </Caption>
          ) : null}
        </Section>
      </Rise>

      <Rise index={4}>
        <Section title="Each day">
          <Stepper
            label="New cards"
            value={profile.dailyNewLimit}
            step={5}
            min={0}
            max={200}
            onChange={(value) => void updateLanguage({ dailyNewLimit: value })}
          />
          <Stepper
            label="Reviews"
            value={profile.dailyReviewLimit}
            step={20}
            min={20}
            max={999}
            onChange={(value) => void updateLanguage({ dailyReviewLimit: value })}
          />
          <Stepper
            label="Target retention"
            value={Math.round(profile.desiredRetention * 100)}
            step={1}
            min={70}
            max={97}
            suffix="%"
            onChange={(value) => void updateLanguage({ desiredRetention: value / 100 })}
          />
          <Caption>
            Higher retention means shorter intervals and more reviews. 90% is where most learners get
            the best return.
          </Caption>
        </Section>
      </Rise>

      <Rise index={5}>
        <Section title="Vocabulary">
          <DetailRow label={`Words for ${language.name}`} value={String(engine.getEntries(code).length)} />
          <TextButton label="Add or back up words" onClick={() => navigate('/import')} />
        </Section>
      </Rise>

      <Rise index={6}>
        <Section title="Your day">
          {/*
            A user setting, not a language one — and until now one with no
            control at all: it was stored on each language's profile, defaulted
            to four, and could not be changed from anywhere in the app.
          */}
          <Stepper
            label="Day starts at"
            value={dayStartHour}
            step={1}
            min={0}
            max={23}
            suffix=":00"
            onChange={(value) => void setDayStartHour(value)}
          />
          <Caption>
            Reviews before this hour count towards the previous day, so finishing at 2am does not
            start a second day's work. Applies to every language.
          </Caption>
        </Section>
      </Rise>

      <Rise index={6}>
        <Section title="Background">
          {/*
            Applies everywhere, not to this language. The four places keep
            their own ink either way — what changes is whether the weather in
            them is running.
          */}
          <Row wrap>
            <Choice
              label="Calm"
              selected={backdrop === 'calm'}
              onClick={() => void setBackdrop('calm')}
            />
            <Choice
              label="Living"
              selected={backdrop === 'living'}
              onClick={() => void setBackdrop('living')}
            />
          </Row>
          <Caption>
            {backdrop === 'living'
              ? 'The sky moves, the light crosses it and the drawing drifts. Nothing is added — the same scene, awake.'
              : 'The scene is a still drawing. It answers the pointer and otherwise holds its breath.'}
          </Caption>
          <Caption>
            Kept with your account, so it is the same on your phone. If your system asks for
            reduced motion, the background stays still whichever is chosen.
          </Caption>
        </Section>
      </Rise>

      <Rise index={7}>
        <Section title="Account">
          <DetailRow
            label={synced ? 'Signed in as' : 'Using this device as'}
            value={account?.displayName ?? 'Not signed in'}
          />
          {account?.email ? <DetailRow label="Email" value={account.email} /> : null}

          {synced ? (
            <SyncStatus />
          ) : (
            <>
              <Caption>
                A local profile in this browser. Progress is not carried to your other devices, and
                nothing is sent anywhere.
              </Caption>
              {canSignIn ? (
                <TextButton
                  label="Create an account to sync"
                  onClick={() => navigate('/sign-in')}
                />
              ) : null}
            </>
          )}

          <TextButton
            label="Sign out"
            muted
            onClick={() => {
              // The deck stays behind, under this account's own storage prefix,
              // so signing back in finds it again rather than an empty one.
              void signOut();
            }}
          />
        </Section>
      </Rise>

      <Rise index={7}>
        <Section title="More">
          <TextButton label="What's coming next" onClick={() => navigate('/upcoming')} />
          <TextButton
            label="Reset all progress"
            color="var(--critical)"
            onClick={() => void mutate((instance) => instance.reset())}
          />
        </Section>
      </Rise>

      <Rise index={8}>
        <Maker />
      </Rise>
    </Screen>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <span className="stepper__label">{label}</span>
      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span className="stepper__value">
        {value}
        {suffix}
      </span>
      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(Math.min(max, value + step))}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}
