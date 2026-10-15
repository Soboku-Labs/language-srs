import { Caption, Rise, Screen, Section } from '../ui';

/**
 * What is coming, and how far off it is.
 *
 * Written as a commitment rather than as marketing, which means two rules: no
 * dates, and nothing listed that is not actually being built. A roadmap that
 * promises a quarter is a roadmap that lies twice a year; one that says "next"
 * and "after that" is one that can be kept.
 *
 * It is also the honest place for the things the app does not do yet. A learner
 * who notices there are four languages and wonders whether that is the whole
 * plan deserves an answer in the product rather than in a changelog nobody
 * reads.
 */

type Stage = 'building' | 'next' | 'later';

const STAGES: Record<Stage, { label: string; line: string }> = {
  building: { label: 'Being built', line: 'In progress now.' },
  next: { label: 'Next', line: 'Started or about to be.' },
  later: { label: 'After that', line: 'Decided on, not yet begun.' },
};

const FEATURES: { stage: Stage; title: string; line: string }[] = [
  {
    stage: 'building',
    title: 'A dashboard for each language',
    line: 'Progress, retention per skill and exam readiness for one language at a time, instead of one combined view that averages two languages into a number meaning neither.',
  },
  {
    stage: 'building',
    title: 'Settings that live on your account',
    line: 'Your theme, your pace and your exam are kept on the server rather than in one browser, so a second device opens as the first one left it.',
  },
  {
    stage: 'next',
    title: 'A teacher you can ask',
    line: 'The teacher becomes someone you can talk to — why this word takes that measure word, why your answer was close but wrong — in the middle of a session rather than in a separate app.',
  },
  {
    stage: 'next',
    title: 'Choose where you are going, on a map',
    line: 'The front page becomes a region to pick before a language, so the first thing you do is decide where you want to be understood.',
  },
  {
    stage: 'next',
    title: 'Home screen widgets',
    line: 'What is due, and a card you can answer without opening anything, on iOS and Android.',
  },
  {
    stage: 'later',
    title: 'Many more languages',
    line: 'Four is where this starts, not what it is. The exam tracks, word lists and art are data, so the work is in the data rather than the app.',
  },
  {
    stage: 'later',
    title: 'A Mac app',
    line: 'The same deck on the desktop, with the keyboard shortcuts a long review session deserves.',
  },
  {
    stage: 'later',
    title: 'People to practise with',
    line: 'The goal is to learn the language and make friends. The second half needs its own thinking — what you share, and what is safe to show a stranger — and it is not going to be bolted on.',
  },
];

export function Roadmap() {
  return (
    <Screen>
      <Rise index={0}>
        <Caption>
          What is being built, in the order it is being built. No dates, because a date on a
          roadmap is a promise to break — and nothing here that is not genuinely underway or
          decided.
        </Caption>
      </Rise>

      {(Object.keys(STAGES) as Stage[]).map((stage, index) => {
        const items = FEATURES.filter((feature) => feature.stage === stage);
        if (items.length === 0) return null;

        return (
          <Rise key={stage} index={index + 1}>
            <Section title={STAGES[stage].label}>
              <Caption>{STAGES[stage].line}</Caption>
              <ul className="roadmap">
                {items.map((feature) => (
                  <li key={feature.title} className="roadmap__item">
                    <span className="roadmap__title">{feature.title}</span>
                    <span className="roadmap__line">{feature.line}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </Rise>
        );
      })}

      <Rise index={5}>
        <Section title="Something missing?">
          <Caption>
            This list is short on purpose. If the thing you want is not on it, that is worth
            knowing — it is a better signal than anything we would guess at.
          </Caption>
        </Section>
      </Rise>
    </Screen>
  );
}
