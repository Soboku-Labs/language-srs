import { findGrammarPoint, getGrammarPoints, getExamLevel } from '@language-srs/core';
import { useEngine } from '../providers';
import { useRouter } from '../router';
import { BigButton, Caption, Rise, Row, Screen, TextButton, Title } from '../ui';

/**
 * One grammar point, taught.
 *
 * The order is the order somebody actually needs it in: the shape first,
 * because that is what they came to check; then why it is that shape; then
 * examples, which are what the explanation is really made of; then the mistake
 * everyone makes, which is the half drilling cannot teach.
 *
 * Marking it understood is a claim by the learner, not a score. Nothing is
 * tested here and nothing is scheduled — the cards do that — so the button says
 * what it does and can be taken back.
 */
export function GrammarPoint({ id }: { id: string }) {
  const { engine, revision, mutate } = useEngine();
  const { navigate } = useRouter();
  void revision;

  const point = findGrammarPoint(id);

  if (!point) {
    return (
      <Screen>
        <Title>Not found</Title>
        <Caption>No grammar point with that name.</Caption>
        <TextButton label="Back to the syllabus" onClick={() => navigate('/learn')} />
      </Screen>
    );
  }

  const learned = engine.isGrammarLearned(point.id);
  const due = engine.grammarDue(point.id);
  const siblings = getGrammarPoints(point.languageCode);
  const index = siblings.findIndex((candidate) => candidate.id === point.id);
  const next = siblings[index + 1];

  return (
    <Screen>
      <Rise index={0}>
        <div className="stack stack--tight">
          <span className="point__form point__form--large">{point.form}</span>
          <Title>{point.title}</Title>
          <Caption>
            {getExamLevel(point.levelId).name} · {point.summary}
          </Caption>
        </div>
      </Rise>

      <Rise index={1}>
        {/* The shape, set apart, because it is what somebody scans for when
            they are checking rather than learning. */}
        <div className="pattern">{point.pattern}</div>
      </Rise>

      <Rise index={2}>
        <p className="prose">{point.explanation}</p>
      </Rise>

      <Rise index={3}>
        <section className="section">
          <h2 className="section__title">Examples</h2>
          {point.examples.map((example) => (
            <div key={example.target} className="example">
              <span className="example__target">{example.target}</span>
              {example.reading ? <span className="example__reading">{example.reading}</span> : null}
              <span className="example__gloss">{example.gloss}</span>
            </div>
          ))}
        </section>
      </Rise>

      {point.pitfall ? (
        <Rise index={4}>
          <div className="pitfall">
            <span className="pitfall__label">Watch out</span>
            <span className="pitfall__body">{point.pitfall}</span>
          </div>
        </Rise>
      ) : null}

      {/*
        Reading it is not the test.

        This used to end in "mark as understood", which asked the learner to
        judge their own understanding at the moment it was freshest — when that
        judgement is worth least. It leads into practice instead, and the
        practice is what moves the point along.
      */}
      <Rise index={5}>
        <BigButton
          label={learned ? 'Practise this' : 'Try it'}
          hint={
            learned
              ? due
                ? `Last practised ${describeAgo(engine.grammarLearnedAt(point.id), engine.now())} · next ${describeDue(due, engine.now())}`
                : undefined
              : 'Four short exercises, then it comes back later'
          }
          onClick={() => {
            if (!learned) void mutate((instance) => instance.setGrammarLearned(point.id, true));
            navigate(`/practice/${point.id}`);
          }}
        />
      </Rise>

      <Rise index={6}>
        <Row between>
          <TextButton label="All grammar" muted onClick={() => navigate('/learn')} />
          {next ? (
            <TextButton label={`Next · ${next.form}`} onClick={() => navigate(`/learn/${next.id}`)} />
          ) : null}
        </Row>
      </Rise>
    </Screen>
  );
}

/** "2 days ago", loosely. */
function describeAgo(at: string | undefined, now: string): string {
  if (!at) return 'recently';
  const days = Math.round((Date.parse(now) - Date.parse(at)) / 86_400_000);
  if (Number.isNaN(days) || days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** "in 3 days", or "now" when it is waiting. */
function describeDue(due: string, now: string): string {
  const days = Math.round((Date.parse(due) - Date.parse(now)) / 86_400_000);
  if (Number.isNaN(days)) return 'soon';
  if (days <= 0) return 'now';
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
