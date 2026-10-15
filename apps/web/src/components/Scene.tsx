import { memo } from 'react';
import { getCulture, type LanguageCode } from '@language-srs/core';
import { LanguageArt } from './LanguageArt';
import { useTheme } from '../theme';

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

function SceneInner({
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
  const { colorsFor } = useTheme();
  const colors = colorsFor(code);
  const culture = getCulture(code);
  return (
    <div
      className={`scene scene--${variant}${className ? ` ${className}` : ''}`}
      // Falls back to its own language's ink when nothing above has set it,
      // so a scene works standing alone as well as inside a window.
      style={{
        ['--scene-accent' as string]: colors.accent,
        ['--scene-wash' as string]: colors.accentSoft,
      }}
      aria-hidden="true"
    >
      {/* Air first. Everything else is read against it. */}
      <div className="scene__sky" />

      {/*
        The weather, for anybody who wants it running.

        Two soft masses of colour that orbit slowly behind everything else —
        the modern mesh-gradient look, but tied to this language's own ink
        rather than dropped on top of it. Present in both settings and still
        in the calm one, so switching is a change of motion rather than a
        change of picture.
      */}
      <div className="scene__weather">
        <span className="scene__mass scene__mass--one" />
        <span className="scene__mass scene__mass--two" />
      </div>

      {/*
        The light in this sky.

        One soft source, off-centre, crossing its own sky on a clock of its
        own. It travels least of anything here because it is furthest away,
        which is what makes the motion read as distance rather than wobble.
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

/** Memoised for the same reason the drawing inside it is. */
export const Scene = memo(SceneInner);
