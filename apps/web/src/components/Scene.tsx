import { useRef } from 'react';
import { getCulture, getLanguageTheme, type LanguageCode } from '@language-srs/core';
import { LanguageArt } from './LanguageArt';
import { useParallax } from '../motion/parallax';

/**
 * A place, with air in it.
 *
 * The drawings were already good and already built in layers — sky, buildings,
 * the small bright thing in front. What they were missing was everything
 * around them: they sat in a 320×120 box on a flat beige page, which makes a
 * picture of somewhere rather than somewhere.
 *
 * A scene puts the same drawing inside weather. Light comes from a point in
 * its sky, the far distance is hazed, the ground has a horizon, and the layers
 * sit at different depths so moving across them moves them against each other.
 * None of the artwork changed; what changed is that it now has a sky above it
 * and ground under it.
 *
 * ## Why not photographs
 *
 * The same reason as before, and more so at this size: a photograph of a
 * country is a claim about it, and at full-bleed it is a loud one. Line art
 * under weather reads as a place without insisting on which corner of it.
 */

export function Scene({
  code,
  className,
  /**
   * How much of the scene is sky.
   *
   * A window wants a lot — it is mostly air with a horizon near the bottom. A
   * backdrop behind a screenful of text wants almost none, because its job is
   * to tint the room rather than to be looked at.
   */
  variant = 'window',
}: {
  code: LanguageCode;
  className?: string;
  variant?: 'window' | 'backdrop';
}) {
  const theme = getLanguageTheme(code);
  const culture = getCulture(code);
  const ref = useRef<HTMLDivElement>(null);

  useParallax(ref);

  return (
    <div
      ref={ref}
      className={`scene scene--${variant}${className ? ` ${className}` : ''}`}
      // Falls back to its own language's ink when nothing above has set it,
      // so a scene works standing alone as well as inside a window.
      style={{
        ['--scene-accent' as string]: theme.colors.accent,
        ['--scene-wash' as string]: theme.colors.accentSoft,
      }}
      aria-hidden="true"
    >
      {/* Air first. Everything else is read against it. */}
      <div className="scene__sky" />

      {/*
        The light in this sky.

        One soft source, placed off-centre and drifting with the pointer at the
        shallowest depth of anything here — the sun moves least because it is
        furthest away, which is the only reason parallax reads as distance
        rather than as wobble.
      */}
      <div className="scene__light" />

      {/*
        Haze before the drawing, not over it.

        It is the air the place stands in, so it belongs behind — put in front
        it is fog thick enough to bury a pagoda, which is exactly what happened
        the first time.
      */}
      <div className="scene__haze" />

      {/*
        The drawing keeps its own proportions and lies along the floor.

        Filling the window with it instead — slicing a 320x120 drawing into a
        tall column — crops a pagoda into three unrecognisable lines. A horizon
        band is what a window onto somewhere actually looks like.
      */}
      <LanguageArt code={code} className="scene__art" animate={false} fit="meet" />

      {/* Just enough shade under the name to keep it off the rooflines. */}
      <div className="scene__scrim" />

      <span className="scene__label">{culture.cityLocal}</span>
    </div>
  );
}
