/**
 * The mark: 門.
 *
 * `mon` is 門 — a gate — which is also what the front page is: four doorways,
 * and choosing one walks you through it. So the mark is the character itself,
 * rather than a monogram that could belong to anything.
 *
 * Drawn as strokes, not set as text. A logo that depends on the viewer having
 * a CJK font installed is not a logo — and an SVG favicon loads no fonts at
 * all, so the character has to be geometry rather than a glyph reference.
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
        門 — the character the product is named after, drawn as strokes.

        Not set as text. The favicon used to be `<text>門</text>` relying on
        Noto Sans SC or PingFang being installed, which renders differently on
        every machine and as an empty box on one with neither. These are ten
        line segments and look the same everywhere, including inside an SVG
        favicon where no font is loaded at all.

        Proportioned against the real glyph rather than invented: two panels,
        three bars each, the inner posts stopping at the lowest bar while the
        outer two carry on down. Checked at 120px, 48px and 22px beside the
        rendered character — at 22px, which is the size in the bar, a version
        with only two bars per panel stopped reading as 門.
      */}
      <g
        stroke="var(--brand)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Left panel. The outer post runs the full height. */}
        <path d="M5.5 9v19" />
        <path d="M5.5 9h7.5" />
        <path d="M5.5 15h7.5" />
        <path d="M5.5 21h7.5" />
        <path d="M13 9v12" />

        {/* Right panel, and the long descender that closes the gate. */}
        <path d="M19 9v12" />
        <path d="M19 9h7.5" />
        <path d="M19 15h7.5" />
        <path d="M19 21h7.5" />
        <path d="M26.5 9v19" />
      </g>
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
