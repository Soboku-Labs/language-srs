import { useEffect, useMemo } from 'react';
import { useAuth, useEngine, AuthProvider, EngineProvider } from './providers';
import { RouterProvider, matchPath, useRouter } from './router';
import { ThemeProvider } from './theme';
import { Dashboard } from './screens/Dashboard';
import { Review } from './screens/Review';
import { Words } from './screens/Words';
import { Word } from './screens/Word';
import { Stats } from './screens/Stats';
import { Settings } from './screens/Settings';
import { Languages } from './screens/Languages';
import { Import } from './screens/Import';
import { SignIn } from './screens/SignIn';
import { Caption, Screen, TextButton, Title } from './ui';

/**
 * The app shell.
 *
 * Auth wraps the engine, because which account you are decides which slice of
 * storage the engine reads. Theme is innermost because it follows the active
 * language, which is engine state.
 */
export function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <EngineProvider>
          <Themed />
        </EngineProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

function Themed() {
  const { engine, revision } = useEngine();
  const language = useMemo(() => engine.activeLanguage, [engine, revision]);

  return (
    <ThemeProvider languageCode={language}>
      <Chrome />
    </ThemeProvider>
  );
}

/** Page titles, and the back affordance for everything that is not the dashboard. */
const TITLES: { pattern: string; title: string }[] = [
  { pattern: '/review', title: 'Review' },
  { pattern: '/words', title: 'Words' },
  { pattern: '/word/:id', title: 'Word' },
  { pattern: '/stats', title: 'Progress' },
  { pattern: '/settings', title: 'Settings' },
  { pattern: '/languages', title: 'Languages' },
  { pattern: '/import', title: 'Add words' },
];

function Chrome() {
  const { path, navigate, back } = useRouter();
  const { isSignedIn } = useAuth();

  const titled = TITLES.find((candidate) => matchPath(candidate.pattern, path));

  /**
   * First run sends a visitor to sign-in once.
   *
   * A redirect rather than a wall: every other route stays reachable, because a
   * deep link into a specific word should not be swallowed by a login form for
   * someone who simply chose the device profile.
   */
  useEffect(() => {
    if (!isSignedIn && path !== '/sign-in') navigate('/sign-in', { replace: true });
  }, [isSignedIn, path, navigate]);

  useEffect(() => {
    document.title = titled ? `${titled.title} · Mon` : 'Mon';
  }, [titled]);

  return (
    <>
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

function Routes() {
  const { path } = useRouter();
  const { navigate } = useRouter();

  if (path === '/sign-in') return <SignIn />;
  if (path === '/' || path === '') return <Dashboard />;
  if (path === '/review') return <Review />;
  if (path === '/words') return <Words />;
  if (path === '/stats') return <Stats />;
  if (path === '/settings') return <Settings />;
  if (path === '/languages') return <Languages />;
  if (path === '/import') return <Import />;

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
