/**
 * The mark: a gate.
 *
 * `mon` is 門 — a gate — which is also what the front page is: four doorways,
 * and choosing one walks you through it. So the mark is the thing the product
 * is named after and built around, rather than a monogram that could belong to
 * anything.
 *
 * Drawn as paths, not set as text. The favicon was `<text>門</text>` relying on
 * Noto Sans SC or PingFang being installed, which means it renders differently
 * on every machine and renders as a blank square on a machine with neither — a
 * logo that depends on the viewer having the right font is not a logo. These
 * are three rectangles and two lines; they look the same everywhere.
 *
 * The orange is the product's own and never a language's. Switching from
 * Mandarin to Korean repaints most of the app; it must not repaint this.
 */
export function Logo({ size = 22, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      /* Decorative beside the wordmark, which already says "mon" — so no title
         unless a caller is using the mark on its own. */
      {...(title ? { role: 'img' } : { 'aria-hidden': 'true' })}
    >
      {title ? <title>{title}</title> : null}
      {/*
        An arched gateway, and the opening you walk through.

        Three constructions were drawn and compared at 110px, 44px and 22px.
        A torii reads as a table once it is small; two door panels — closer to
        the literal 門 — go busy and lose the gap between them. The arch is the
        only one that still says "gateway" at the size it actually appears in
        the bar, and it is also the shape the app is built on: the door page is
        four openings, and choosing one walks you in.
      */}
      <path
        d="M5 28V15a11 11 0 0 1 22 0v13"
        stroke="var(--brand)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M12.5 28v-6a3.5 3.5 0 0 1 7 0v6"
        stroke="var(--brand)"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark and the name, which is what the bar shows. */
export function Wordmark() {
  return (
    <span className="brand">
      <Logo />
      <span className="wordmark">mon</span>
    </span>
  );
}
