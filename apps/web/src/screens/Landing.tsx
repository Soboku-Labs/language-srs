import { useMemo } from 'react';
import {
  LANGUAGE_CODES,
  getCulture,
  getLanguageProfile,
  getLanguageTheme,
  type LanguageCode,
} from '@language-srs/core';
import { LanguageArt } from '../components/LanguageArt';
import { TeacherCard } from '../components/Teacher';
import { useAuth, useEngine } from '../providers';
import { useRouter } from '../router';
import { Caption, Rise, Screen, TextButton } from '../ui';

/**
 * The door.
 *
 * The app used to open on a password field. Before a visitor had been told what
 * this is, who teaches it or why it exists, it asked them to make an account —
 * which is the wrong order, and meant the only page that explained the product
 * was one nobody signed in ever saw again.
 *
 * So this is the front page, and every launch starts here. It says three things
 * in order: what this is, which language you are here for, and why this exists
 * when a dozen other apps already do. The exam machinery, the readiness maths
 * and the settings all live past the door.
 *
 * ## Nothing is chosen for you
 *
 * The engine creates a Mandarin profile on first run so there is something to
 * schedule against, and it would be easy to let that read as a choice already
 * made. It is not one. A language is shown as yours only once it has review
 * history — so a visitor meets four open doors rather than somebody else's
 * half-finished deck, and somebody signed in comes back to the one they were
 * actually studying.
 */

/** How it is taught, in the three claims that are actually different. */
const METHOD = [
  {
    number: '01',
    title: 'Shaped like your exam',
    body:
      'Pick HSK 4 in June and the scheduler works backwards from the date. It tells you the pace the deck needs, and says so plainly when that pace is no longer reachable.',
  },
  {
    number: '02',
    title: 'Four skills, not one',
    body:
      'Meaning, listening, production and tones are scheduled separately, because recognising a word and being able to say it are different memories that fade at different rates.',
  },
  {
    number: '03',
    title: 'A teacher, not a dashboard',
    body:
      'Each language is taught by somebody with a method and a temperament. They say what they think of the session you just had.',
  },
];

/**
 * Why this exists.
 *
 * Answered rather than avoided: anybody who has looked at language apps before
 * is entitled to ask what another one is for, and a front page that dodges it
 * reads as though there is no answer.
 */
const FAQ = [
  {
    question: 'Why another language app?',
    answer:
      'Because the ones built for streaks are optimising for the wrong thing. A streak measures attendance; an exam measures what you can recall under time pressure. This schedules against a date you have actually booked, and when the two conflict it will tell you to do more today rather than congratulate you for showing up.',
  },
  {
    question: 'What makes it better?',
    answer:
      'It is honest about what it knows. HSK publishes official word lists, so those targets are exact and the app says so; JLPT, TOPIK and the Vietnamese framework do not publish theirs, and every figure derived from them is labelled an estimate rather than dressed up as precision.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'No. Everything works on this device, offline, with nothing sent anywhere. An account exists for one reason: to carry your deck, every card’s schedule and your whole review history to your phone and back.',
  },
  {
    question: 'What happens to my progress?',
    answer:
      'It stays yours. Signed out it never leaves the browser. Signed in it is kept in step across your devices and nowhere else, and you can export every word and review you own as JSON at any time.',
  },
];

export function Landing() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const { account, isSignedIn } = useAuth();
  const { navigate } = useRouter();

  const state = useMemo(() => {
    // Started means *reviewed*, not merely having a profile — see above.
    const started = LANGUAGE_CODES.filter(
      (code) => engine.hasProfile(code) && engine.getAllCards(code).some((card) => card.reps > 0),
    );
    const active = engine.activeLanguage;
    const resume = started.includes(active) ? active : started[0];

    return {
      started: new Set(started),
      resume,
      waiting: resume ? waitingFor(engine, resume) : 0,
    };
    // revision is the engine's change counter; the engine object itself is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  const open = async (code: LanguageCode) => {
    await setActiveLanguage(code);
    navigate('/home');
  };

  return (
    <Screen layer="door">
      <Rise index={0}>
        <div className="masthead">
          <div className="masthead__top">
            <span className="wordmark">mon</span>
            <TextButton
              label={isSignedIn ? (account?.displayName ?? 'Account') : 'Sign in'}
              muted
              onClick={() => navigate(isSignedIn ? '/settings' : '/sign-in')}
            />
          </div>
          <h1 className="masthead__headline">
            Four languages.
            <br />
            Four teachers.
          </h1>
          <p className="masthead__standfirst">
            Spaced repetition for Mandarin, Japanese, Korean and Vietnamese, shaped like the exam you
            are sitting. Choose a language and meet the person who takes you through it.
          </p>
        </div>
      </Rise>

      {/*
        Only for somebody who has actually studied. Offering to "continue" a
        language nobody has opened would greet a first-time visitor with
        somebody else's progress — and it is the one row here that is about
        them rather than about the product, so it sits above the explaining.
      */}
      {state.resume ? (
        <Rise index={1}>
          <button type="button" className="resume" onClick={() => void open(state.resume!)}>
            <span className="resume__label">Continue</span>
            <span className="resume__language">{getLanguageProfile(state.resume).name}</span>
            <span className="resume__count">
              {state.waiting > 0 ? `${state.waiting} waiting` : 'Nothing due — study ahead'}
            </span>
          </button>
        </Rise>
      ) : null}

      <Rise index={2}>
        <section className="method">
          <h2 className="section__title">How it is taught</h2>
          {METHOD.map((item) => (
            <div key={item.title} className="method__row">
              <span className="method__number">{item.number}</span>
              <div>
                <h3 className="method__title">{item.title}</h3>
                <p className="method__body">{item.body}</p>
              </div>
            </div>
          ))}
        </section>
      </Rise>

      <Rise index={3}>
        <h2 className="section__title">Choose a language</h2>
      </Rise>

      <div className="places">
        {LANGUAGE_CODES.map((code, index) => {
          const profile = getLanguageProfile(code);
          const theme = getLanguageTheme(code);
          const culture = getCulture(code);

          return (
            <Rise key={code} index={4 + index}>
              {/*
                Drawn in its own language's ink rather than the active theme's,
                so four of these read as four places instead of one place in
                four shades.
              */}
              <button
                type="button"
                className={`place${state.started.has(code) ? ' place--started' : ''}`}
                // The card borrows the language's accent for its own chrome,
                // scoped here rather than on `:root` so four of them can be on
                // screen at once without fighting.
                style={{
                  ['--place-accent' as string]: theme.colors.accent,
                  ['--place-wash' as string]: theme.colors.accentSoft,
                }}
                onClick={() => void open(code)}
              >
                <LanguageArt code={code} className="place__art" animate={false} />

                <span className="place__head">
                  <span className="place__name">
                    {profile.name}
                    <span className="place__endonym"> · {profile.endonym}</span>
                  </span>
                  {state.started.has(code) ? <span className="place__badge">Started</span> : null}
                </span>

                <span className="place__where">
                  {culture.cityLocal} · {culture.countryLocal}
                </span>
                <span className="place__line">{culture.line}</span>

                <TeacherCard code={code} />
              </button>
            </Rise>
          );
        })}
      </div>

      <Rise index={8}>
        <section className="faq">
          <h2 className="section__title">Why this exists</h2>
          {FAQ.map((item) => (
            <details key={item.question} className="faq__item">
              <summary className="faq__question">{item.question}</summary>
              <p className="faq__answer">{item.answer}</p>
            </details>
          ))}
        </section>
      </Rise>

      <Rise index={9}>
        <Caption>
          Your cards, history and schedule stay on this device unless you sign in, in which case they
          are kept in step across the devices you use and nowhere else.
        </Caption>
      </Rise>
    </Screen>
  );
}

function waitingFor(engine: ReturnType<typeof useEngine>['engine'], code: LanguageCode): number {
  if (!engine.hasProfile(code)) return 0;
  const queue = engine.getQueue({ code });
  return queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;
}
