import type { DailyGoal, Journey, JourneyStage } from '@mon/core';

/**
 * The two loops, on the web.
 *
 * Same two mechanics as the Expo app and for the same reasons: a day that ends,
 * and a rank earned by words that have actually stuck. See docs/DESIGN.md.
 */

/**
 * Today, as a row of segments.
 *
 * A segment is a card, so the thing fills by discrete units of work you did and
 * on a twelve-card day you can count your way to the end by eye.
 */
export function DayProgress({ goal }: { goal: DailyGoal }) {
  const segments = Math.min(Math.max(goal.target, 1), 12);
  const filled = goal.target === 0 ? segments : (goal.done / goal.target) * segments;

  return (
    <div
      className="segments"
      role="progressbar"
      aria-valuenow={Math.round(goal.progress * 100)}
      aria-label="Today's progress"
    >
      {Array.from({ length: segments }, (_, index) => {
        const whole = index + 1 <= Math.floor(filled);
        // The partially-done segment is dimmed rather than clipped: it reads as
        // "in progress" without claiming a precision a segment cannot carry.
        const partial = !whole && index < filled;
        return (
          <span
            key={index}
            className={`segment${whole ? ' segment--full' : partial ? ' segment--part' : ''}`}
          />
        );
      })}
    </div>
  );
}

/**
 * The rank.
 *
 * The native glyph is the hero, because it is the part worth recognising — a
 * learner should come to know 立春 or ㄷ or Mão as a place they have been. The
 * line underneath says words known, which is the actual unit, so the rank can
 * always be checked against the deck.
 */
export function RankBand({ journey, onClick }: { journey: Journey; onClick?: () => void }) {
  const label = journey.stage.romanised ?? journey.stage.native;
  const body = (
    <>
      <span className="rank__glyph">{journey.stage.native}</span>
      <span className="rank__text">
        <span className="rank__name">
          {label}
          <span className="rank__meaning"> · {journey.stage.meaning}</span>
        </span>
        <span className="rank__detail">
          {journey.wordsToNext !== undefined
            ? `${journey.wordsKnown} words known · ${journey.wordsToNext} more to ${
                journey.next?.romanised ?? journey.next?.native
              }`
            : `${journey.wordsKnown} words known · top of the ladder`}
        </span>
        <span className="track rank__track">
          <span
            className="track__fill"
            style={{ width: `${Math.max(2, Math.round(journey.progress * 100))}%` }}
          />
        </span>
      </span>
      <span className="rank__count">
        {journey.stageNumber}
        <span className="rank__total">/{journey.totalStages}</span>
      </span>
    </>
  );

  if (!onClick) return <div className="rank">{body}</div>;

  return (
    <button
      type="button"
      className="rank"
      onClick={onClick}
      aria-label={`Rank ${label}, ${journey.stage.meaning}, stage ${journey.stageNumber} of ${journey.totalStages}`}
    >
      {body}
    </button>
  );
}

/**
 * The whole ladder.
 *
 * Every stage ahead is listed with its price in words rather than hidden behind
 * a lock. A system that conceals what it wants from you is a slot machine; this
 * one is a syllabus.
 */
export function Ladder({ journey, stages }: { journey: Journey; stages: JourneyStage[] }) {
  return (
    <ol className="ladder">
      {stages.map((stage) => {
        const reached = stage.index < journey.stageNumber - 1;
        const current = stage.index === journey.stageNumber - 1;
        return (
          <li
            key={stage.index}
            className={`ladder__row${current ? ' ladder__row--current' : reached ? ' ladder__row--done' : ''}`}
            {...(current ? { 'aria-current': 'step' as const } : {})}
          >
            <span className="ladder__glyph">{stage.native}</span>
            <span className="ladder__text">
              <span className="ladder__name">{stage.romanised ?? stage.native}</span>
              <span className="ladder__meaning">{stage.meaning}</span>
            </span>
            <span className="ladder__words">
              {current ? 'you are here' : `${stage.wordsRequired} words`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
