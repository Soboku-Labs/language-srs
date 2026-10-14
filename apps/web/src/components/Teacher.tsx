import {
  getLanguageTheme,
  getTeacher,
  teacherLine,
  type LanguageCode,
  type Teacher,
  type TeacherMood,
} from '@language-srs/core';

/**
 * The teacher.
 *
 * The app is one screen of cards and a scheduler, and that is a hard thing to
 * open at seven in the morning. A named teacher with a stated method gives the
 * routine a voice: a session can be met and closed by somebody rather than by a
 * progress bar.
 *
 * They are already in `@language-srs/core` with their lines, their method and
 * their principles, and the Expo app shows them. The web app did not, which left
 * it the same product with the character taken out.
 */

/**
 * The portrait.
 *
 * Coloured by the *teacher's* own language rather than the active theme, so a
 * row of four on the languages screen reads as four people and not one person in
 * four moods.
 */
export function TeacherAvatar({
  teacher,
  size = 'medium',
}: {
  teacher: Teacher;
  size?: 'small' | 'medium' | 'large';
}) {
  const theme = getLanguageTheme(teacher.languageCode);

  /*
   * The glyph is sized by how much of it there is.
   *
   * Three of the four teachers are one CJK or Hangul character, which wants to
   * be large. Cô Mai's is "Mai" — the contract says one or two characters and
   * Vietnamese has no single-character name to use — and three Latin letters at
   * the size of one 林 overflow the circle. Counted in code points rather than
   * UTF-16 units so a character outside the basic plane does not read as two.
   */
  const length = Array.from(teacher.glyph).length;
  const scale = length === 1 ? 1 : length === 2 ? 0.66 : length === 3 ? 0.6 : 0.46;

  return (
    <span
      className={`avatar avatar--${size}`}
      style={{
        background: theme.colors.accentSoft,
        color: theme.colors.accent,
        ['--glyph-scale' as string]: scale,
      }}
      aria-hidden="true"
    >
      {teacher.glyph}
    </span>
  );
}

/**
 * The teacher, saying the thing this moment calls for.
 *
 * `seed` picks which of the mood's lines to use. Pass something stable for the
 * moment — the day, or the card id — so the line does not change on every
 * render: a sentence that reshuffles while you are reading it is worse than no
 * sentence.
 */
export function TeacherSays({
  code,
  mood,
  seed = 0,
}: {
  code: LanguageCode;
  mood: TeacherMood;
  seed?: string | number;
}) {
  const teacher = getTeacher(code);

  return (
    <div className="says">
      <TeacherAvatar teacher={teacher} size="small" />
      <span className="says__text">
        <span className="says__line">{teacherLine(teacher, mood, seed)}</span>
        <span className="says__name">{teacher.address}</span>
      </span>
    </div>
  );
}

/**
 * Who teaches a language, and how.
 *
 * For the languages screen, where somebody is choosing. The method is the useful
 * part — each teacher stands for a real pedagogical position, and "characters
 * are built, not memorised" tells you more about what studying here will be like
 * than any amount of feature copy.
 */
export function TeacherCard({ code }: { code: LanguageCode }) {
  const teacher = getTeacher(code);

  return (
    <div className="teacher">
      <TeacherAvatar teacher={teacher} size="medium" />
      <div className="teacher__text">
        <span className="teacher__name">
          {teacher.name} <span className="teacher__romanised">{teacher.romanised}</span>
        </span>
        <span className="teacher__method">{teacher.method}</span>
      </div>
    </div>
  );
}
