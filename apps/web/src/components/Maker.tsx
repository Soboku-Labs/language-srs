/**
 * Who made this.
 *
 * One line, at the bottom, in the quietest type on the page. A product that
 * announces its maker above the thing it does has the ratio wrong — nobody
 * opened a review queue to find out who built it — but a product that never
 * says is anonymous, and anonymous software is harder to trust with a year of
 * somebody's study history.
 *
 * Deliberately not a logo, a badge or a banner. It reads the way a colophon
 * reads at the back of a book.
 */
export function Maker() {
  return (
    <p className="maker">
      <span className="maker__line">Mon is a product by</span>
      <span className="maker__name">Suboku Labs</span>
    </p>
  );
}
