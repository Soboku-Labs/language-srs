import type { LanguageCode } from '@language-srs/core';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTheme } from './theme';

/**
 * Going from the door into a language.
 *
 * The windows already expanded before the route changed, which was half of it.
 * The other half was missing and it showed: the door and the day are different
 * trees, so at the moment of navigation React unmounts four scenes and mounts a
 * dashboard, and no amount of easing on the window hides a swap of everything
 * on screen. What you saw was a nice expansion followed by a cut.
 *
 * So something has to be on screen across the swap, and it cannot live in
 * either screen — both are unmounted or mounted by it. It lives here, above the
 * routes, and is the only thing that spans the two: a wash in the language's own
 * colour that closes over the expanding window, holds while the route changes
 * underneath it, and opens on the day.
 *
 * The colour is the point. A grey or black cover would read as a loading
 * screen; the destination's own canvas reads as having arrived somewhere, and
 * because the day paints that same colour the veil lifting leaves nothing
 * behind.
 *
 * Under `prefers-reduced-motion` the whole thing is skipped and the route
 * changes at once — somebody who has asked for less movement has not asked for
 * a slower app.
 */

type Phase = 'idle' | 'closing' | 'opening';

interface TravelValue {
  /** The language being travelled to, while it is happening. */
  to?: LanguageCode;
  /** True from the first frame of the journey until the veil has lifted. */
  travelling: boolean;
  /**
   * Cover the screen, run `arrive`, then uncover.
   *
   * `arrive` is awaited under the veil, so whatever it does — switching the
   * active language, which rebuilds the queue, then navigating — happens where
   * it cannot be seen.
   */
  travel(code: LanguageCode, arrive: () => Promise<void>): void;
}

const TravelContext = createContext<TravelValue | undefined>(undefined);

/**
 * How long the veil takes to close, and to open again.
 *
 * Closing is the slower half and overlaps the window's own expansion, which
 * runs for `--duration-travel`; the veil is deliberately a little shorter so
 * the place is still growing when the colour takes over, rather than having
 * stopped and waited. Opening is quicker because by then the day is already
 * underneath and the only thing left is to stop hiding it.
 */
const CLOSING_MS = 460;
const OPENING_MS = 320;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

export function TravelProvider({ children }: { children: ReactNode }) {
  const { colorsFor } = useTheme();
  const [to, setTo] = useState<LanguageCode | undefined>();
  const [phase, setPhase] = useState<Phase>('idle');
  // A second press while the first journey is in flight would run `arrive`
  // twice and leave the veil's timers fighting over the phase.
  const busy = useRef(false);

  const travel = useCallback<TravelValue['travel']>((code, arrive) => {
    if (busy.current) return;

    if (reducedMotion()) {
      busy.current = true;
      void arrive().finally(() => {
        busy.current = false;
      });
      return;
    }

    busy.current = true;
    setTo(code);
    setPhase('closing');

    window.setTimeout(() => {
      void arrive()
        .then(() => {
          setPhase('opening');
          window.setTimeout(() => {
            setPhase('idle');
            setTo(undefined);
            busy.current = false;
          }, OPENING_MS);
        })
        .catch(() => {
          // Nothing arrived, so the veil must not stay shut over the door.
          setPhase('idle');
          setTo(undefined);
          busy.current = false;
        });
    }, CLOSING_MS);
  }, []);

  const value = useMemo<TravelValue>(
    () => ({ ...(to ? { to } : {}), travelling: phase !== 'idle', travel }),
    [to, phase, travel],
  );

  return (
    <TravelContext.Provider value={value}>
      {children}
      {to ? (
        <div
          className={`veil veil--${phase}`}
          aria-hidden="true"
          style={{
            // The destination's canvas, with its accent breathed through the
            // middle so the cover is the place rather than a flat panel.
            ['--veil-canvas' as string]: colorsFor(to).background,
            ['--veil-accent' as string]: colorsFor(to).accentSoft,
          }}
        />
      ) : null}
    </TravelContext.Provider>
  );
}

export function useTravel(): TravelValue {
  const context = useContext(TravelContext);
  if (!context) throw new Error('useTravel must be used inside a TravelProvider');
  return context;
}
