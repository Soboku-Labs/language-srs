import { useMemo, useState } from 'react';
import {
  addDays,
  findExamTrack,
  getExamTracksForLanguage,
  getLanguageProfile,
  suggestDailyNewLimit,
  toDateOnly,
} from '@language-srs/core';
import { useAuth, useEngine } from '../providers';
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
  const { account, signOut } = useAuth();
  const { navigate } = useRouter();

  const code = engine.activeLanguage;
  const profile = useMemo(() => engine.getProfile(code), [engine, revision, code]);
  const available = useMemo(() => engine.getAvailableWordCount(code), [engine, revision, code]);
  const language = getLanguageProfile(code);
  const tracks = getExamTracksForLanguage(code);
  const track = findExamTrack(profile.examTrackId);
  const level = track?.levels.find((candidate) => candidate.id === profile.targetLevelId);

  const [dateDraft, setDateDraft] = useState(profile.examDate ?? '');
  const [dateError, setDateError] = useState<string | undefined>();

  const suggestedNewLimit =
    profile.examDate && DATE_PATTERN.test(profile.examDate)
      ? suggestDailyNewLimit(profile.targetLevelId, engine.now(), profile.examDate, available)
      : undefined;

  const commitDate = async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setDateError(undefined);
      await mutate((instance) => instance.updateProfile(code, { examDate: undefined }));
      return;
    }
    if (!DATE_PATTERN.test(trimmed)) {
      setDateError('Use YYYY-MM-DD, for example 2026-12-06.');
      return;
    }
    setDateError(undefined);
    await mutate((instance) => instance.updateProfile(code, { examDate: trimmed }));
  };

  const shortfall = level ? Math.max(0, level.vocabularyTarget - available) : 0;

  return (
    <Screen>
      <Rise index={0}>
        <Caption>Settings apply to {language.name}. Each language keeps its own.</Caption>
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
                  onClick={() => void mutate((instance) => instance.setExamTrack(code, candidate.id))}
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
                onClick={() =>
                  void mutate((instance) =>
                    instance.updateProfile(code, { targetLevelId: candidate.id }),
                  )
                }
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
          <Row wrap>
            <input
              className="field"
              style={{ flex: 1, minWidth: 160 }}
              value={dateDraft}
              onChange={(event) => setDateDraft(event.target.value)}
              onBlur={() => void commitDate(dateDraft)}
              placeholder="YYYY-MM-DD"
              inputMode="numeric"
              aria-label="Exam date"
            />
            {[30, 90, 180].map((days) => (
              <Choice
                key={days}
                label={`${days}d`}
                selected={false}
                onClick={() => {
                  const next = toDateOnly(addDays(engine.now(), days));
                  setDateDraft(next);
                  void commitDate(next);
                }}
              />
            ))}
          </Row>
          {dateError ? <Caption>{dateError}</Caption> : null}
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
            onChange={(value) => void mutate((i) => i.updateProfile(code, { dailyNewLimit: value }))}
          />
          <Stepper
            label="Reviews"
            value={profile.dailyReviewLimit}
            step={20}
            min={20}
            max={999}
            onChange={(value) => void mutate((i) => i.updateProfile(code, { dailyReviewLimit: value }))}
          />
          <Stepper
            label="Target retention"
            value={Math.round(profile.desiredRetention * 100)}
            step={1}
            min={70}
            max={97}
            suffix="%"
            onChange={(value) =>
              void mutate((i) => i.updateProfile(code, { desiredRetention: value / 100 }))
            }
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
        <Section title="Account">
          <DetailRow label="Signed in as" value={account?.displayName ?? 'Not signed in'} />
          {account?.email ? <DetailRow label="Email" value={account.email} /> : null}
          {account?.provider === 'device' ? (
            <Caption>
              A local profile on this device. Progress is not carried to your other devices.
            </Caption>
          ) : null}
          <TextButton
            label={account?.provider === 'device' ? 'Sign in to an account' : 'Sign out'}
            muted={account?.provider !== 'device'}
            onClick={() => {
              if (account?.provider === 'device') navigate('/sign-in');
              else void signOut();
            }}
          />
        </Section>
      </Rise>

      <Rise index={7}>
        <Section title="More">
          <TextButton
            label="Reset all progress"
            color="var(--critical)"
            onClick={() => void mutate((instance) => instance.reset())}
          />
        </Section>
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
