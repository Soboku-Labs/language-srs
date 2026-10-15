import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The router.
 *
 * Hand-written, because the route set is nine fixed paths that this app owns.
 * A routing library is the right call when routes are dynamic, nested or
 * code-split; here it would be fifteen kilobytes to do what the History API
 * already does, in an app whose entire reason for existing is not carrying
 * runtimes it does not need.
 *
 * Paths rather than hashes, so links are real URLs and a learner can bookmark a
 * word. That needs the host to serve `index.html` for unknown paths — the
 * GitHub Pages build copies it to `404.html`, exactly as the Expo build did.
 */

export interface Route {
  path: string;
  /** Path segments captured from `:name` placeholders. */
  params: Record<string, string>;
  /** Everything after `?`. */
  query: URLSearchParams;
}

interface RouterValue extends Route {
  navigate: (to: string, options?: { replace?: boolean }) => void;
  back: () => void;
}

const RouterContext = createContext<RouterValue | undefined>(undefined);

/** The app's base path, so a project-site deployment still links correctly. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function currentPath(): string {
  const path = window.location.pathname.slice(BASE.length) || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const onPop = () => {
      setPath(currentPath());
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    const [nextPath = '/', nextSearch = ''] = to.split('?');
    const url = `${BASE}${nextPath}${nextSearch ? `?${nextSearch}` : ''}`;

    if (options.replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);

    setPath(nextPath);
    setSearch(nextSearch ? `?${nextSearch}` : '');
    // A new screen starts at the top. Without this, opening a word from halfway
    // down the deck list lands you halfway down the word.
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({
      path,
      params: {},
      query: new URLSearchParams(search),
      navigate,
      back: () => window.history.back(),
    }),
    [path, search, navigate],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const context = useContext(RouterContext);
  if (!context) throw new Error('useRouter must be used inside a RouterProvider');
  return context;
}

/**
 * Match a path against a pattern, capturing `:name` segments.
 *
 * Returns the captured params, or undefined for no match — so a caller can
 * distinguish "matched with no params" from "did not match", which a bare object
 * cannot express.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return undefined;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!;
    const actual = pathParts[index]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
    else if (expected !== actual) return undefined;
  }
  return params;
}

/**
 * An internal link.
 *
 * A real anchor, so the browser's own affordances work — middle-click, copy
 * link address, open in a new tab — with the click intercepted for navigation
 * when it is an ordinary left-click with no modifier.
 */
export function Link({
  to,
  className,
  children,
  ...rest
}: { to: string; className?: string; children: ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  const { navigate } = useRouter();

  return (
    <a
      {...rest}
      href={`${BASE}${to}`}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
