import { useEffect, useMemo } from 'react';
import { useEngine, useAuth, AuthProvider, EngineProvider } from './providers';
import { SyncProvider } from './sync';
import { SettingsProvider, useSettings } from './settings';
import { TravelProvider } from './travel';
import { RouterProvider, matchPath, useRouter } from './router';
import { ThemeProvider } from './theme';
import { Dashboard } from './screens/Dashboard';
import { Landing } from './screens/Landing';
import { Review } from './screens/Review';
import { Words } from './screens/Words';
import { Word } from './screens/Word';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { Import } from './screens/Import';
import { Learn } from './screens/Learn';
import { Practice } from './screens/Practice';
import { GrammarPoint } from './screens/GrammarPoint';
import { SignIn } from './screens/SignIn';
import { Start } from './screens/Start';
import { Roadmap } from './screens/Roadmap';
import { Write } from './screens/Write';
import { StorageWarning } from './components/StorageWarning';
import { DemoBanner } from './components/DemoBanner';
import { Caption, Screen, TextButton, Title } from './ui';

/**
 * The app shell.
 *
 * Auth wraps the engine, because which account you are decides which slice of
 * storage the engine reads. Sync sits inside both — it needs an account and an
 * engine and renders neither. Settings sits inside those because it reconciles
 * the engine's values against the server's. Theme is innermost because it
 * follows the active language and the appearance, which are both settings.
 */
export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <EngineProvider>
          <SyncProvider>
            <SettingsProvider>
              <Themed />
            </SettingsProvider>
          </SyncProvider>
        </EngineProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

function Themed() {
  const { engine, revision } = useEngine();
  const { appearance, backdrop } = useSettings();
  const language = useMemo(() => engine.activeLanguage, [engine, revision]);

  /*
   * On the document, not on a component.
   *
   * How alive the background is affects the sky, the light, the drawing's
   * layers and the grain over all of it — things in four different places that
   * should never disagree. One attribute at the root means the stylesheet
   * answers the question once.
   */
  useEffect(() => {
    document.documentElement.dataset.backdrop = backdrop;
  }, [backdrop]);

  return (
    <ThemeProvider languageCode={language} appearance={appearance}>
      {/* Inside the theme, because the veil is painted in the destination
          language's colours; above the routes, because it has to still be
          there while they swap. */}
      <TravelProvider>
        <Chrome />
      </TravelProvider>
    </ThemeProvider>
  );
}

/**
 * Page titles, and the back affordance for everything that is not a layer root.
 *
 * `/` and `/home` are roots: the door and the day. Neither gets a back arrow,
 * because there is nothing behind the door, and the day is reached by choosing
 * a language rather than by descending into it.
 *
 * `/review` is deliberately absent too. The loop renders its own chrome — a
 * progress bar and a way out — and a title bar above it would be a second
 * header competing with the card for the only thing that should be looked at.
 */
/** Matches the `<title>` and description in index.html, for the door. */
const DOOR_TITLE = 'Mon \u2014 exam-aligned review for HSK, JLPT, TOPIK';
const DOOR_DESCRIPTION =
  'Spaced repetition built around your exam date. Mandarin, Japanese, Korean and Vietnamese, scheduled so nothing lands after the paper. Free, works offline.';

const TITLES: { pattern: string; title: string; description?: string }[] = [
  { pattern: '/learn', title: 'Grammar', description: 'Grammar points read first, then practised four ways.' },
  { pattern: '/learn/:id', title: 'Grammar', description: 'A grammar point, with its pattern, examples and the pitfall.' },
  { pattern: '/words', title: 'Words', description: 'Every word in your deck, and how well each one is holding.' },
  { pattern: '/word/:id', title: 'Word', description: 'One word: its reading, its meanings and your own notes.' },
  { pattern: '/stats', title: 'Progress', description: 'Retention per skill, your streak and how ready you are for the paper.' },
  { pattern: '/settings', title: 'Settings', description: 'Exam, level, daily amounts and how the app looks.' },
  {
    pattern: '/upcoming',
    title: 'Upcoming',
    description: 'What is being built next for Mon, in the order it is being built.',
  },
  { pattern: '/account', title: 'Account', description: 'Carry your deck and its schedule between devices.' },
  { pattern: '/import', title: 'Add words', description: 'Bring your own word list in, or back yours up.' },
  /*
   * The writing app, all three of its depths.
   *
   * These were missing, so `/write` rendered with no header at all: no title,
   * no back arrow, and nothing else on the screen offering a way out. It was
   * a page you could reach and not leave. The entry that was supposed to add
   * them targeted a one-line version of the row above that had already been
   * reformatted, so the edit silently did nothing — which is why the list
   * below is checked by a test now rather than by reading it.
   */
  { pattern: '/write', title: 'Writing', description: 'Character practice, a chapter at a time.' },
  { pattern: '/write/:book', title: 'Writing', description: 'The chapters of one writing book.' },
  {
    pattern: '/write/:book/:chapter',
    title: 'Writing',
    description: 'One character, as big as the screen allows.',
  },
];

function Chrome() {
  const { path, navigate, back } = useRouter();

  const titled = TITLES.find((candidate) => matchPath(candidate.pattern, path));

  /*
   * Nothing is redirected to sign-in any more.
   *
   * The front page used to bounce a first-time visitor straight to a password
   * field for an app they had been told nothing about. Signing in is an offer —
   * it carries progress to a second device — and the app is complete without
   * it, so it is reached from the door rather than standing in front of it.
   */

  /*
   * Title and description, kept in step with the route.
   *
   * The description matters because this is one HTML document serving every
   * path: without updating it, a link shared from /upcoming carries the front
   * page's description, and every page a crawler reaches claims to be the
   * same page. The title on the door is the full one rather than the bare
   * brand — "Mon" alone tells somebody scanning a list of tabs or results
   * nothing.
   */
  useEffect(() => {
    document.title = titled ? `${titled.title} · Mon` : DOOR_TITLE;

    const description = titled?.description ?? DOOR_DESCRIPTION;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', description);
    document
      .querySelector('meta[property="og:title"]')
      ?.setAttribute('content', titled ? `${titled.title} · Mon` : DOOR_TITLE);
  }, [titled]);

  return (
    <>
      {/* Above the header, because unsaved work outranks knowing where you are. */}
      <StorageWarning />
      {/* And above that in importance but below it on screen: losing work is
          urgent, being in the demo is a standing condition. */}
      <DemoBanner />
      {titled ? (
        <header className="chrome">
          <button type="button" className="chrome__back" onClick={back} aria-label="Go back">
            ‹
          </button>
          <span className="chrome__title">{titled.title}</span>
        </header>
      ) : null}
      <Routes />
    </>
  );
}

/** Sends the browser somewhere else without leaving a step in the history. */
function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => navigate(to, { replace: true }), [navigate, to]);
  return null;
}

/**
 * Which screens anybody can see without an account.
 *
 * The door, so somebody arriving can tell what this is before being asked for
 * an email; the sign-in page itself, which would otherwise be unreachable;
 * and what is coming next, which is a page about the product rather than part
 * of it.
 */
const OPEN = new Set(['', '/', '/sign-in', '/upcoming']);

function Routes() {
  const { path } = useRouter();
  const { navigate } = useRouter();
  const { synced, demo, canSignIn } = useAuth();

  /*
   * Studying needs an account.
   *
   * The app used to be complete without one and said so. That has changed on
   * purpose: an account is how somebody who finds this useful can be reached
   * again, and it is free — no card, now or later. The demo exists so nobody
   * has to hand over an email to find out whether they want to.
   *
   * Conditional on there being a server, and that is not a hedge. Requiring
   * an account that cannot be created is a locked door with no key: the
   * deployed site has no API today, and a build without one would be a blank
   * product rather than a stricter one. The moment `VITE_API_URL` is set, the
   * requirement applies with nothing here to change.
   */
  if (canSignIn && !synced && !demo && !OPEN.has(path)) {
    return <Redirect to={`/sign-in?new=1&from=${encodeURIComponent(path)}`} />;
  }

  if (path === '/sign-in') return <SignIn />;

  // The door, the day, the loop.
  if (path === '/' || path === '') return <Landing />;
  if (path === '/home') return <Dashboard />;
  if (path === '/review') return <Review />;
  // Asked once per language, before the first session rather than after it.
  if (path === '/start') return <Start />;

  if (path === '/learn') return <Learn />;
  if (path === '/words') return <Words />;
  if (path === '/stats') return <Stats />;
  if (path === '/settings') return <Settings />;
  if (path === '/upcoming') return <Roadmap />;
  // One route family, because the books, their chapters and a page of one are
  // a single activity that the back button should walk out through.
  if (path === '/write' || path.startsWith('/write/')) return <Write />;
  if (path === '/import') return <Import />;

  // The picker is the door now. Kept so a bookmark from the old structure
  // lands somewhere sensible rather than on "not found".
  if (path === '/languages') return <Redirect to="/" />;

  const practice = matchPath('/practice/:id', path);
  if (practice?.id) return <Practice id={practice.id} />;

  const grammar = matchPath('/learn/:id', path);
  if (grammar?.id) return <GrammarPoint id={grammar.id} />;

  const word = matchPath('/word/:id', path);
  if (word?.id) return <Word id={word.id} />;

  return (
    <Screen>
      <Title>Not found</Title>
      <Caption>No screen lives at {path}.</Caption>
      <TextButton label="Back home" onClick={() => navigate('/')} />
    </Screen>
  );
}
