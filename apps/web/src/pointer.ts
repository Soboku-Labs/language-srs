import { useEffect, useState } from 'react';

/**
 * Whether this device can be drawn on with a finger.
 *
 * `(pointer: coarse)` asks the question that matters — is the primary pointer
 * a finger — rather than `maxTouchPoints`, which is non-zero on a laptop with
 * a touchscreen that nobody touches, and on some desktops with none at all.
 * `any-pointer: coarse` is the fallback for a tablet in a keyboard case, where
 * the primary pointer is the trackpad but the screen is right there.
 *
 * Watched rather than read once: a Surface or an iPad gains and loses its
 * keyboard mid-session, and a handwriting card that stays hidden because of
 * how the device was held at launch is a card the learner never sees again.
 */
const QUERY = '(pointer: coarse), (any-pointer: coarse)';

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => window.matchMedia?.(QUERY).matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.(QUERY);
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return coarse;
}
