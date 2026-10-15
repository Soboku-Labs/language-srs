import { useMemo } from 'react';
import {
  describeStruggle,
  findExamLevel,
  getExaminedSkills,
  getLadder,
  kindLabel,
  type KindRetention,
} from '@language-srs/core';
import { useEngine } from '../providers';
import { Locked } from '../components/Locked';
import { useRouter } from '../router';
import { Caption, DetailRow, Pill, ProgressBar, Rise, Row, Screen, Section, Stat, TextButton, Title } from '../ui';
import { Ladder, RankBand } from '../components/Journey';
import { useTheme } from '../theme';

/**
 * Progress.
 *
 * The detail the dashboard deliberately does not carry, grouped by the question
 * each part answers: where am I, what is coming, how am I doing, what is broken.
 */
export function Stats() {
  const { engine, revision } = useEngine();
  const { palette } = useTheme();
  const { navigate } = useRouter();

  const view = useMemo(() => {
    const profile = engine.getProfile();
    return {
      profile,
      level: findExamLevel(profile.targetLevelId),
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
      struggling: engine.getStrugglingCards(),
      journey: engine.getJourney(),
    };
  }, [engine, revision]);

  const { profile, level, stats, readiness, struggling, journey } = view;
  const peak = Math.max(1, ...stats.forecast.map((day) => day.due));
  const scheduled = stats.forecast.reduce((total, day) => total + day.due, 0);
  const weakest = stats.retentionByKind[0];

  /**
   * One row per word, not per card.
   *
   * A word with five cards all going badly was listing the same word five times,
   * which reads as five separate problems and pushes everything else off.
   */
  const strugglingWords = useMemo(() => {
    const byEntry = new Map<string, (typeof struggling)[number] & { cardCount: number }>();
    for (const row of struggling) {
      const seen = byEntry.get(row.entry.id);
      if (seen) seen.cardCount += 1;
      else byEntry.set(row.entry.id, { ...row, cardCount: 1 });
    }
    return [...byEntry.values()];
  }, [struggling]);

  return (
    <Screen>
      {/*
        "Ready" is a claim about the exam and is only made when there is an exam
        to be ready for. Without a date this is progress through the deck.
      */}
      <Rise index={0}>
        <div className="stack--tight stack">
          <Title>
            {readiness.examDate
              ? `${Math.round(readiness.score * 100)}% ready`
              : `${Math.round(readiness.coverage * 100)}% of your deck`}
          </Title>
          <ProgressBar value={readiness.examDate ? readiness.score : readiness.coverage} />
          <Caption>{readiness.headline}</Caption>
        </div>
      </Rise>

      <Rise index={1}>
        <Section title="Your journey">
          <RankBand journey={journey} />
          <Caption>{journey.tradition}.</Caption>
          <Ladder journey={journey} stages={getLadder(profile.languageCode).stages} />
        </Section>
      </Rise>

      <Rise index={2}>
        <Row between>
          <Stat label="known" value={String(stats.coverage.entriesKnown)} />
          <Stat label="learning" value={String(stats.coverage.learningCards)} color={palette.hard} />
          <Stat label="in review" value={String(stats.coverage.reviewCards)} color={palette.good} />
          <Stat label="unseen" value={String(stats.coverage.newCards)} color={palette.textMuted} />
        </Row>
      </Rise>

      <Rise index={3}>
        <Section title="Next two weeks">
          {/* An all-zero chart renders as a row of stubs that look like data. */}
          {scheduled === 0 ? (
            <Caption>Nothing scheduled yet — reviews appear here once today&apos;s cards graduate.</Caption>
          ) : (
            <>
              <div className="chart">
                {stats.forecast.map((day) => (
                  <div key={day.day} className="chart__column">
                    <div className="chart__area">
                      {day.due > 0 ? (
                        <div
                          className="chart__bar"
                          style={{
                            height: `${(day.due / peak) * 100}%`,
                            background:
                              day.due > profile.dailyReviewLimit ? palette.warning : palette.accent,
                          }}
                        />
                      ) : null}
                    </div>
                    <span className="chart__label">{day.day.slice(8)}</span>
                  </div>
                ))}
              </div>
              <Caption>
                {stats.forecast.some((day) => day.due > profile.dailyReviewLimit)
                  ? `Amber days exceed your ${profile.dailyReviewLimit}-review cap; the overflow rolls forward.`
                  : 'Reviews already scheduled. New cards are governed by your daily limit.'}
              </Caption>
            </>
          )}
        </Section>
      </Rise>

      <Rise index={4}>
        <Section title="How it is going">
          {stats.retention.reviews === 0 ? (
            <Caption>No graduated reviews yet — these appear once cards start coming back.</Caption>
          ) : (
            <>
              <DetailRow label="Recalled" value={`${Math.round(stats.retention.trueRetention * 100)}%`} />
              <DetailRow
                label="Model predicted"
                value={`${Math.round(stats.retention.predictedRetention * 100)}%`}
              />
              <DetailRow label="Seconds per card" value={stats.retention.averageSecondsPerCard.toFixed(1)} />
              <Caption>{describeCalibration(stats.retention.calibrationGap)}</Caption>
            </>
          )}
          <DetailRow label="Current streak" value={`${stats.streak.current} days`} />
          <DetailRow label="Longest streak" value={`${stats.streak.longest} days`} />
        </Section>
      </Rise>

      {/*
        These exams are sectioned by skill and the queue already mirrors that
        mix, so one overall retention figure averages away the only thing it
        could have told the learner.
      */}
      {stats.retentionByKind.length > 1 ? (
        <Rise index={5}>
          {/*
            Per-skill retention is the view that only starts meaning something
            after a few weeks, which is exactly when somebody has decided this
            is worth keeping. The streak and the week above it stay free: those
            are what make the first few sessions feel like they went somewhere,
            and charging for them would be charging for the thing that works.
          */}
          <Locked feature="fullProgress">
          <Section title="By skill">
            {stats.retentionByKind.map((row) => (
              <div key={row.kind} className="skill">
                <span className="skill__label">{kindLabel(row.kind)}</span>
                <span className="track skill__track">
                  <span
                    className="track__fill"
                    style={{
                      width: `${Math.max(2, Math.round(row.trueRetention * 100))}%`,
                      background:
                        row.trueRetention >= profile.desiredRetention ? palette.good : palette.warning,
                    }}
                  />
                </span>
                <span className="skill__value">{Math.round(row.trueRetention * 100)}%</span>
              </div>
            ))}
            <Caption>{describeWeakestSkill(stats.retentionByKind, profile.desiredRetention)}</Caption>
            {weakest && weakest.trueRetention < profile.desiredRetention ? (
              <TextButton
                label={`Drill ${kindLabel(weakest.kind).toLowerCase()}`}
                onClick={() => navigate(`/review?mode=cram&kind=${weakest.kind}`)}
              />
            ) : null}
          </Section>
          </Locked>
        </Rise>
      ) : null}

      {strugglingWords.length > 0 ? (
        <Rise index={6}>
          <Section title="Fighting you">
            {strugglingWords.slice(0, 6).map((row) => (
              <button
                key={row.entry.id}
                type="button"
                className="struggle"
                onClick={() => navigate(`/word/${encodeURIComponent(row.entry.id)}`)}
              >
                <span className="struggle__target">{row.entry.target}</span>
                <span className="struggle__why">
                  {row.cardCount > 1 ? `${row.cardCount} cards · ` : ''}
                  {describeStruggle(row)}
                </span>
              </button>
            ))}
            {strugglingWords.length > 6 ? <Caption>and {strugglingWords.length - 6} more</Caption> : null}
            <Caption>
              Usually the card is badly worded rather than the word being hard. Open one to add a note,
              start it over, or set it aside.
            </Caption>
          </Section>
        </Rise>
      ) : null}

      {level ? (
        <Rise index={7}>
          <Section title={`What ${level.shortName} tests`}>
            <Row wrap>
              {getExaminedSkills(level).map((skill) => (
                <Pill key={skill} label={skill} />
              ))}
            </Row>
            {level.sections.map((section) => (
              <DetailRow
                key={section.id}
                label={section.name}
                value={[
                  section.questionCount ? `${section.questionCount} questions` : undefined,
                  section.durationMinutes ? `${section.durationMinutes} min` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </Section>
        </Rise>
      ) : null}
    </Screen>
  );
}

/**
 * Turn the calibration gap into advice.
 *
 * Positive means intervals are too long for this learner; sharply negative means
 * they are paying for retention they are not asking for.
 */
function describeCalibration(gap: number): string {
  if (Math.abs(gap) < 0.05) return 'The scheduler is well calibrated to you.';
  if (gap > 0) {
    return `The scheduler is ${Math.round(gap * 100)} points optimistic. Raising target retention shortens intervals.`;
  }
  return `You are recalling ${Math.round(-gap * 100)} points better than predicted. Lowering target retention would cut your daily load.`;
}

/** Name the weakest skill, or say there isn't one. */
function describeWeakestSkill(rows: KindRetention[], desired: number): string {
  const weakest = rows[0];
  if (!weakest) return '';
  if (weakest.trueRetention >= desired) {
    return `Every skill is at or above your ${Math.round(desired * 100)}% target.`;
  }
  const gap = Math.round((desired - weakest.trueRetention) * 100);
  return `${kindLabel(weakest.kind)} is ${gap} points below your target — the weakest of ${rows.length} skills.`;
}
