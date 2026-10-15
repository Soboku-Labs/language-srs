/**
 * A date, picked from a calendar.
 *
 * This was a text box expecting `YYYY-MM-DD`, validated with a regular
 * expression and an error message for getting it wrong. That is a form asking
 * somebody to be a date parser: it rejects `6/12/2026`, it rejects `2026-6-6`,
 * and the one thing a person booking an exam actually wants — to see which day
 * of the week it falls on and count the weeks — it cannot do at all.
 *
 * `type="date"` is the native control, so it brings the platform's own
 * calendar, the platform's own locale for displaying it, and keyboard entry
 * that already understands what people type. It also makes the value
 * impossible to get wrong: the browser hands back `YYYY-MM-DD` or nothing,
 * which is exactly the `DateOnly` the engine stores. The validation and its
 * error message are gone because the state they guarded against cannot happen.
 *
 * `min` matters more than it looks. An exam date in the past turns the
 * scheduler's exam pressure into a division by a negative number of days, and
 * the honest place to prevent that is the control rather than a check after.
 */
export function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  /** `YYYY-MM-DD`, or empty for no date. */
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="datefield">
      <span className="datefield__label">{label}</span>
      <input
        type="date"
        className="field datefield__input"
        value={value}
        {...(min ? { min } : {})}
        {...(max ? { max } : {})}
        /*
         * `onChange`, not `onBlur`.
         *
         * A native picker closes on selection without the input losing focus,
         * so committing on blur meant choosing a date from the calendar and
         * seeing nothing happen until you clicked elsewhere.
         */
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
