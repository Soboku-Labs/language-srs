import { useMemo } from 'react';
import {
  describePlace,
  findExamLevel,
  getLanguageProfile,
  kindLabel,
  type CardKind,
} from '@language-srs/core';
import { LanguageArt } from '../components/LanguageArt';
import { TeacherSays } from '../components/Teacher';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Row, Screen, Stat, TextButton, Title } from '../ui';
import { DayProgress, RankBand } from '../components/Journey';

/**
 * The dashboard.
 *
 * Two loops and one action. The day is the hero and it ends; the rank sits under
 * the action and moves on the scale of weeks. Nothing here rises because the app
 * was opened — every number is one the learner can verify on another screen.
 */
export function Dashboard() {
  const { engine, revision } = useEngine();
  const { navigate } = useRouter();

  const view = useMemo(() => {
    const profile = engine.getProfile();
    return {
      profile,
      language: getLanguageProfile(profile.languageCode),
      level: findExamLevel(profile.targetLevelId),
      queue: engine.getQueue(),
      stats: engine.getStats(),
      readiness: engine.getReadiness(),
      journey: engine.getJourney(),
      goal: engine.getDailyGoal(),
    };
  }, [engine, revision]);

  const { profile, language, level, queue, stats, readiness, journey, goal } = view;
  // The calendar day, as the seed for the teacher's greeting.
  const today = engine.now().slice(0, 10);
  const waiting = queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;

  return (
    <Screen>
      {/* Tapping the language is how you switch it — no menu needed. */}
      <Rise index={0}>
        <button type="button" className="header" onClick={() => navigate('/languages')}>
          <span className="header__text">
            <Title>{language.name}</Title>
            <Caption>
              {level?.shortName} · {describePlace(profile.languageCode)}
              {profile.examDate ? ` · ${describeCountdown(readiness.daysToExam)}` : ''}
            </Caption>
          </span>
          <span className="header__chevron" aria-hidden="true">
            ›
          </span>
        </button>
      </Rise>

      <Rise index={1}>
        <div className="hero hero--placed">
          <LanguageArt code={profile.languageCode} className="hero__art" />
          {goal.complete ? (
            <>
              {/*
                The close. A tick rather than a zero, because "0 cards waiting" is
                an absence and this is an achievement — and nothing underneath it
                proposes more work.
              */}
              <span className="hero__count hero__count--done">✓</span>
              <span className="hero__label">
                {goal.target > 0 ? 'Done for today' : 'Nothing due today'}
              </span>
              <Caption>
                {goal.drillsLeft > 0
                  ? `${goal.drillsLeft} drill${goal.drillsLeft === 1 ? '' : 's'} still on short steps`
                  : queue.nextDueAt
                    ? `Next lands ${formatRelative(queue.nextDueAt)}`
                    : 'Raise your daily new-card limit to keep going'}
              </Caption>
            </>
          ) : (
            <>
              <span className="hero__count">{goal.remaining}</span>
              <span className="hero__label">
                {goal.done > 0
                  ? `left of ${goal.target} today`
                  : goal.remaining === 1
                    ? 'card today'
                    : 'cards today'}
              </span>
            </>
          )}
          <div className="hero__segments">
            <DayProgress goal={goal} />
          </div>
        </div>
      </Rise>

      <Rise index={2}>
        <BigButton
          label={goal.complete ? 'Study ahead' : goal.done > 0 ? 'Keep going' : 'Study'}
          {...(waiting > 0 ? { hint: describeMix(queue.kindMix) } : {})}
          onClick={() => navigate('/review')}
        />
      </Rise>

      {/*
        The teacher, under the button rather than above it.

        It is an invitation, not an instruction, so it sits after the thing it is
        inviting you to do. Seeded by the day: the line is the same every time
        you open the app this morning and different tomorrow, which is the
        difference between a greeting and a slot machine.
      */}
      <Rise index={3}>
        <TeacherSays
          code={profile.languageCode}
          mood={waiting > 0 ? 'greeting' : 'idle'}
          seed={today}
        />
      </Rise>

      {/* The long loop. Tapping it opens the whole ladder on the progress screen. */}
      <Rise index={4}>
        <RankBand journey={journey} onClick={() => navigate('/stats')} />
      </Rise>

      {/*
        The quiet panels under the button. There is one thing to do here — study
        what is due — and making these equally loud would turn a dashboard into a
        menu.

        No "Learn new" or "Cram" links: `buildStudyQueue` interleaves kinds by
        the exam level's weights and takes no mode, so a session that drills only
        new words or only the weakest does not exist to link to. Offering the
        button anyway would be the worst version of this screen — a promise the
        app cannot keep.
      */}
      <Rise index={5}>
        <div className="modes">
          <ModeLink
            label="Words"
            detail={`${stats.coverage.entriesStarted} started`}
            onClick={() => navigate('/words')}
          />
          <ModeLink
            label="Progress"
            detail={profile.examDate ? describeCountdown(readiness.daysToExam) : 'streak and retention'}
            onClick={() => navigate('/stats')}
          />
        </div>
      </Rise>

      <Rise index={6}>
        <Row between>
          <Stat label="day streak" value={String(stats.streak.current)} />
          {/*
            "Words known" is deliberately absent: the rank band above states it
            in the sentence that explains the rank, and the same number twice on
            one screen is the restatement this design keeps removing.
          */}
          <Stat
            label={profile.examDate ? 'exam ready' : 'deck learned'}
            value={`${Math.round((profile.examDate ? readiness.score : readiness.coverage) * 100)}%`}
          />
        </Row>
      </Rise>

      <Rise index={7}>
        <Row center>
          <TextButton label="Progress" onClick={() => navigate('/stats')} />
          <TextButton label="Settings" muted onClick={() => navigate('/settings')} />
        </Row>
      </Rise>
    </Screen>
  );
}

/**
 * A secondary way in: a name, and one line saying what is behind it.
 *
 * The detail line is the point. "Cram" alone is a guess about what will happen;
 * "Cram · 12 days to go" is a reason to tap it or not.
 */
function ModeLink({
  label,
  detail,
  disabled,
  onClick,
}: {
  label: string;
  detail: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mode"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}, ${detail}`}
    >
      <span className="mode__label">{label}</span>
      <span className="mode__detail">{detail}</span>
    </button>
  );
}

/** "listening, meaning and tones" — the session mix as a phrase, not a chart. */
function describeMix(mix: Partial<Record<CardKind, number>>): string {
  const kinds = Object.entries(mix)
    .filter((entry): entry is [CardKind, number] => (entry[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind]) => kindLabel(kind).toLowerCase());

  if (kinds.length === 0) return '';
  if (kinds.length === 1) return kinds[0]!;
  return `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
}

function describeCountdown(days?: number): string {
  if (days === undefined) return '';
  if (days < 0) return 'exam passed';
  if (days === 0) return 'exam today';
  if (days === 1) return 'exam tomorrow';
  return `${days} days to go`;
}

function formatRelative(at: string): string {
  const hours = (Date.parse(at) - Date.now()) / 3_600_000;
  if (hours < 1) return 'within the hour';
  if (hours < 24) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)} days`;
}
