import { useMemo, useState } from 'react';
import {
  LANGUAGE_CODES,
  getCulture,
  getLanguageProfile,
  getTeacher,
  type Appearance,
  type Backdrop,
  type LanguageCode,
} from '@language-srs/core';
import { Scene } from '../components/Scene';
import { TeacherAvatar } from '../components/Teacher';
import { Maker } from '../components/Maker';
import { useAuth, useEngine } from '../providers';
import { useRouter } from '../router';
import { useSettings } from '../settings';
import { useTheme } from '../theme';
import { useTravel } from '../travel';
import { Caption, Rise, Screen, Segmented } from '../ui';

/**
 * Four windows.
 *
 * This page has been rebuilt three times and each version was the same object
 * underneath: a document about an app, with the app's four languages drawn on
 * it as cards. A headline, a grid, an argument, a FAQ. Rearranging those is
 * how it kept coming out feeling like a brochure — because it was one.
 *
 * It is not a document now. Four places are open at once, each with its own
 * sky and its own weather, and choosing one travels into it rather than
 * selecting it from a list. The pointer moves the layers of whichever you are
 * over, so the thing under the cursor is somewhere rather than something.
 *
 * ## What is left of the brochure
 *
 * The argument still exists, under the windows, for anybody who scrolls to
 * find it — some people do want to know why another language app exists before
 * they start. But it is below the horizon, and the first screen is four
 * doorways and nothing else.
 */

/** Why this exists, for whoever scrolls past the doors to ask. */
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
    question: 'How is it taught?',
    answer:
      'Meaning, listening, production and tones are scheduled separately, because recognising a word and being able to say it are different memories that fade at different rates. Grammar is read first and practised afterwards, in four shapes — matching, filling a gap, typing it, and explaining the rule back.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'No. Everything works on this device, offline, with nothing sent anywhere. An account exists for one reason: to carry your deck, every card’s schedule and your whole review history to your phone and back.',
  },
];

export function Landing() {
  const { engine, revision, setActiveLanguage } = useEngine();
  const { appearance, backdrop, setAppearance, setBackdrop } = useSettings();
  const { account, isSignedIn } = useAuth();
  const { navigate } = useRouter();
  const { colorsFor } = useTheme();

  /** The window being looked into, which widens to take more of the row. */
  const [open, setOpen] = useState<LanguageCode | undefined>();
  const { to: travelling, travel } = useTravel();

  const state = useMemo(() => {
    // Started means *reviewed*. The engine creates a Mandarin profile on first
    // run so there is something to schedule against, and letting that read as a
    // choice already made would greet a visitor with somebody else's progress.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision]);

  /*
   * Going in.
   *
   * The window expands while a wash in the language's own colour closes over
   * it, the route changes underneath, and the wash lifts on the other side.
   * The timing and the veil live in `travel.tsx`, because the veil has to
   * outlive this screen — the swap it exists to hide is this screen being
   * unmounted.
   *
   * Where it lands depends on whether anybody has ever said what they want
   * from this language. A profile exists from the moment a language is
   * touched, so its existence proves nothing; `setUpAt` is the answer, and
   * having reviewed cards counts too — somebody mid-deck should not be
   * stopped and asked to set up the thing they are already doing.
   */
  const enter = (code: LanguageCode) => {
    const asked =
      engine.hasProfile(code) &&
      (Boolean(engine.getProfile(code).setUpAt) ||
        engine.getAllCards(code).some((card) => card.reps > 0));

    travel(code, async () => {
      await setActiveLanguage(code);
      navigate(asked ? '/home' : '/start');
    });
  };

  return (
    <Screen layer="door" flush>
      <Rise index={0}>
        <header className="topbar">
          <div className="topbar__brand">
            <span className="wordmark">mon</span>
            <span className="topbar__line">
              Exam-shaped review for Mandarin, Japanese, Korean and Vietnamese.
            </span>
          </div>

          {/*
            The two settings worth reaching without going into settings.

            Both are about how the app looks while you are looking at it, so
            asking somebody to choose a language, open the day, and find a
            settings screen before they can turn the motion down is the wrong
            way round. They are in the bar, on the page the backgrounds are
            actually on.
          */}
          <nav className="topbar__controls">
            <Segmented
              label="Appearance"
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'Auto' },
              ]}
              value={appearance}
              onChange={(value) => void setAppearance(value as Appearance)}
            />
            <Segmented
              label="Background"
              options={[
                { value: 'calm', label: 'Calm' },
                { value: 'living', label: 'Living' },
              ]}
              value={backdrop}
              onChange={(value) => void setBackdrop(value as Backdrop)}
            />
            <button
              type="button"
              className="topbar__account"
              onClick={() => navigate(isSignedIn ? '/settings' : '/sign-in')}
            >
              {isSignedIn ? (account?.displayName ?? 'Account') : 'Sign in'}
            </button>
          </nav>
        </header>
      </Rise>

      {/*
        Somebody who has studied is not here to choose. A strip above the
        windows, small enough not to become the subject of the page.
      */}
      {state.resume ? (
        <button type="button" className="resume" onClick={() => enter(state.resume!)}>
          <span className="resume__label">Continue</span>
          <span className="resume__language">{getLanguageProfile(state.resume).name}</span>
          <span className="resume__count">
            {state.waiting > 0 ? `${state.waiting} waiting` : 'Nothing due — study ahead'}
          </span>
        </button>
      ) : null}

      <div className={`windows${travelling ? ' windows--travelling' : ''}`}>
        {LANGUAGE_CODES.map((code) => {
          const profile = getLanguageProfile(code);
          const culture = getCulture(code);
          const teacher = getTeacher(code);
          const started = state.started.has(code);

          return (
            <button
              key={code}
              type="button"
              className={`window${open === code ? ' window--open' : ''}${
                travelling === code ? ' window--entering' : ''
              }${travelling && travelling !== code ? ' window--leaving' : ''}`}
              onPointerEnter={() => setOpen(code)}
              onPointerLeave={() => setOpen(undefined)}
              onFocus={() => setOpen(code)}
              onBlur={() => setOpen(undefined)}
              onClick={() => enter(code)}
              aria-label={`${profile.name} — ${culture.city}`}
              /* A stable hook for the browser tests. Three redesigns have
                 renamed this element's class, and each rename silently broke
                 suites that selected on it; the language a door opens is not
                 going to change. */
              data-language={code}
              // On the window rather than the scene inside it: the name plate
              // is the scene's sibling, so an accent set on the scene never
              // reaches it and every endonym came out Mandarin red.
              style={{
                ['--scene-accent' as string]: colorsFor(code).accent,
                ['--scene-wash' as string]: colorsFor(code).accentSoft,
              }}
            >
              <Scene code={code} />

              <span className="window__plate">
                <span className="window__endonym">{profile.endonym}</span>
                <span className="window__name">{profile.name}</span>

                {/* Only once there is room for it — see the stylesheet. */}
                <span className="window__more">
                  <span className="window__line">{culture.line}</span>
                  <span className="window__teacher">
                    <TeacherAvatar teacher={teacher} size="small" />
                    <span className="window__teacher-name">{teacher.romanised}</span>
                  </span>
                </span>

                {started ? <span className="window__badge">Started</span> : null}
              </span>
            </button>
          );
        })}
      </div>

      <section className="below">
        <h2 className="section__title">Why this exists</h2>
        <div className="faq">
          {FAQ.map((item) => (
            <details key={item.question} className="faq__item">
              <summary className="faq__question">{item.question}</summary>
              <p className="faq__answer">{item.answer}</p>
            </details>
          ))}
        </div>

        <Caption>
          Your cards, history and schedule stay on this device unless you sign in, in which case they
          are kept in step across the devices you use and nowhere else.
        </Caption>

        {/*
          Below the argument, because somebody who has read this far is the
          one person on this page who might want to know what is coming.
        */}
        <button type="button" className="below__link" onClick={() => navigate('/upcoming')}>
          What&rsquo;s coming next
        </button>

        <Maker />
      </section>
    </Screen>
  );
}

function waitingFor(engine: ReturnType<typeof useEngine>['engine'], code: LanguageCode): number {
  if (!engine.hasProfile(code)) return 0;
  const queue = engine.getQueue({ code });
  return queue.breakdown.due + queue.breakdown.fresh + queue.breakdown.learning;
}
