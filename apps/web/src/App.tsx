import { useEffect, useMemo } from 'react';
import { useEngine, AuthProvider, EngineProvider } from './providers';
import { SyncProvider } from './sync';
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
import { StorageWarning } from './components/StorageWarning';
import { Caption, Screen, TextButton, Title } from './ui';

/**
 * The app shell.
 *
 * Auth wraps the engine, because which account you are decides which slice of
 * storage the engine reads. Sync sits inside both — it needs an account and an
 * engine and renders neither. Theme is innermost because it follows the active
 * language, which is engine state.
 */
export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <EngineProvider>
          <SyncProvider>
            <Themed />
          </SyncProvider>
        </EngineProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

function Themed() {
  const { engine, revision } = useEngine();
  const language = useMemo(() => engine.activeLanguage, [engine, revision]);
  const backdrop = useMemo(() => engine.backdrop, [engine, revision]);
  const appearance = useMemo(() => engine.appearance, [engine, revision]);

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
      <Chrome />
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
const TITLES: { pattern: string; title: string }[] = [
  { pattern: '/learn', title: 'Grammar' },
  { pattern: '/learn/:id', title: 'Grammar' },
  { pattern: '/words', title: 'Words' },
  { pattern: '/word/:id', title: 'Word' },
  { pattern: '/stats', title: 'Progress' },
  { pattern: '/settings', title: 'Settings' },
  { pattern: '/account', title: 'Account' },
  { pattern: '/import', title: 'Add words' },
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

  useEffect(() => {
    document.title = titled ? `${titled.title} · Mon` : 'Mon';
  }, [titled]);

  return (
    <>
      {/* Above the header, because unsaved work outranks knowing where you are. */}
      <StorageWarning />
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

function Routes() {
  const { path } = useRouter();
  const { navigate } = useRouter();

  if (path === '/sign-in') return <SignIn />;

  // The door, the day, the loop.
  if (path === '/' || path === '') return <Landing />;
  if (path === '/home') return <Dashboard />;
  if (path === '/review') return <Review />;

  if (path === '/learn') return <Learn />;
  if (path === '/words') return <Words />;
  if (path === '/stats') return <Stats />;
  if (path === '/settings') return <Settings />;
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
