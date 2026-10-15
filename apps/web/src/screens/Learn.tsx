import { useMemo } from 'react';
import {
  getExamLevel,
  getGrammarPoints,
  getLanguageProfile,
  type GrammarPoint,
} from '@language-srs/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { Caption, Rise, Screen } from '../ui';

/**
 * The syllabus.
 *
 * Reviewing is one way of learning, not the only one, and until this the app
 * behaved as though it were: everything a learner could do was answer a card.
 * A card is good at keeping a fact from fading and bad at the job before that.
 * Nobody works out why Mandarin uses 很 where English uses "is" by being shown
 * 很 and asked to recall it.
 *
 * So this is the other half — grammar as something read, understood and ticked
 * off, grouped by the exam level it belongs to, with the shape of the course
 * visible rather than inferred from a queue count.
 *
 * It is honest about being a subset. The levels carry a published target for
 * how many points they contain; what ships here is a beginner selection, and
 * the screen says so instead of letting a short list imply a short syllabus.
 */

interface LevelGroup {
  levelId: string;
  name: string;
  /** What the published standard says the level contains, where it says. */
  target?: number;
  points: GrammarPoint[];
  learned: number;
}

export function Learn() {
  const { engine, revision } = useEngine();
  const { navigate } = useRouter();
  const code = engine.activeLanguage;

  const groups = useMemo<LevelGroup[]>(() => {
    const byLevel = new Map<string, GrammarPoint[]>();
    for (const point of getGrammarPoints(code)) {
      const existing = byLevel.get(point.levelId);
      if (existing) existing.push(point);
      else byLevel.set(point.levelId, [point]);
    }

    return [...byLevel.entries()].map(([levelId, points]) => {
      const level = getExamLevel(levelId);
      return {
        levelId,
        name: level.name,
        ...(level.grammarPointTarget ? { target: level.grammarPointTarget } : {}),
        points,
        learned: engine.countGrammarLearned(points.map((point) => point.id)),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, code]);

  const profile = getLanguageProfile(code);
  const total = groups.reduce((sum, group) => sum + group.points.length, 0);
  const done = groups.reduce((sum, group) => sum + group.learned, 0);

  return (
    <Screen>
      <Rise index={0}>
        <Caption>
          {total === 0
            ? `No grammar notes for ${profile.name} yet.`
            : `${done} of ${total} points marked as understood. Reading one does not add anything to your deck — the cards practise it, these explain it.`}
        </Caption>
      </Rise>

      {groups.map((group, index) => (
        <Rise key={group.levelId} index={1 + index}>
          <section className="syllabus">
            <div className="syllabus__head">
              <h2 className="section__title">{group.name}</h2>
              <span className="syllabus__count">
                {group.learned}/{group.points.length}
              </span>
            </div>

            {group.target && group.target > group.points.length ? (
              // Said plainly rather than implied. The published standard lists
              // far more than ships here, and a bare "6/6" would read as a
              // finished level.
              <Caption>
                {group.points.length} of about {group.target} points in the published standard.
              </Caption>
            ) : null}

            <div className="points">
              {group.points.map((point) => {
                const learned = engine.isGrammarLearned(point.id);
                return (
                  <button
                    key={point.id}
                    type="button"
                    className={`point${learned ? ' point--learned' : ''}`}
                    onClick={() => navigate(`/learn/${point.id}`)}
                  >
                    <span className="point__form">{point.form}</span>
                    <span className="point__text">
                      <span className="point__title">{point.title}</span>
                      <span className="point__summary">{point.summary}</span>
                    </span>
                    {learned ? (
                      <span className="point__check" aria-label="Understood">
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        </Rise>
      ))}
    </Screen>
  );
}
