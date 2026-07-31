import type { LanguageCode } from '../types/language';

/**
 * A teacher per language.
 *
 * The app is one screen of cards and a scheduler, and that is a hard thing to
 * open at seven in the morning. A named teacher with a stated method gives the
 * routine a voice: the landing page can say *how* a language is taught here
 * rather than only listing it, and a session can be met and closed by somebody
 * rather than by a progress bar.
 *
 * They are characters, not personas in the marketing sense — each one stands for
 * a real pedagogical position, and the position is the useful part. Lín Mò pulls
 * characters apart because that is how hanzi are learned; Cô Mai leads with the
 * ear because Vietnamese tone contrasts are inaudible until they are trained.
 *
 * This is data in core for the same reason the palettes are: the app, the web
 * build and eventually the widgets all show the same teacher, and a character
 * defined three times is three characters.
 */

/** What the teacher says, by moment. */
export interface TeacherLines {
  /** On the dashboard, when work is waiting. */
  greeting: string[];
  /** After a card was recalled — Good or Easy. */
  recalled: string[];
  /** After a lapse — Again or Hard. Never scolding; a lapse is the system working. */
  lapsed: string[];
  /** At the end of a session. */
  finished: string[];
  /** On the dashboard with nothing due. */
  idle: string[];
}

export type TeacherMood = keyof TeacherLines;

export interface Teacher {
  id: string;
  languageCode: LanguageCode;
  /** Name as written in the language, e.g. 林墨. */
  name: string;
  /** Romanised name, e.g. "Lín Mò". */
  romanised: string;
  /** What a learner would actually call them, e.g. "Lín lǎoshī". */
  address: string;
  /** One or two characters, used as the portrait. */
  glyph: string;
  /** Who they are, in one line. */
  bio: string;
  /** How they teach, in one sentence. This is what the landing page shows. */
  method: string;
  /** The three things they insist on. */
  principles: string[];
  lines: TeacherLines;
}

const LIN_MO: Teacher = {
  id: 'teacher-zh',
  languageCode: 'zh',
  name: '林墨',
  romanised: 'Lín Mò',
  address: 'Lín lǎoshī',
  glyph: '林',
  bio: 'Calligrapher first, teacher second. Keeps a brush on the desk and uses it.',
  method:
    'Characters are built, not memorised — every hanzi comes apart into pieces you already know, and the tone is drilled as part of the word rather than as an afterthought.',
  principles: [
    'Learn the components before the character.',
    'A word without its tone is not a word yet.',
    'Write it once by hand and you will not lose it.',
  ],
  lines: {
    greeting: [
      'Ink is ready. Shall we begin?',
      'A short sitting beats a long one tomorrow.',
      'Today’s characters are waiting patiently.',
    ],
    recalled: ['That one has settled.', 'Good — the stroke order is in your hand now.', 'Held. Next.'],
    lapsed: [
      'Look at the components again, not the whole.',
      'Forgetting is the price of the interval. It will come back sooner.',
      'Say it aloud with the tone. That is usually the missing half.',
    ],
    finished: [
      'Enough for today. The brush is cleaned.',
      'Well sat. Come back tomorrow and these will be easier.',
      'That is a page filled.',
    ],
    idle: ['Nothing due. Rest is part of the method.', 'The ink is dry — come back when the cards ripen.'],
  },
};

const MORI_AOI: Teacher = {
  id: 'teacher-ja',
  languageCode: 'ja',
  name: '森 葵',
  romanised: 'Mori Aoi',
  address: 'Mori-sensei',
  glyph: '森',
  bio: 'Teaches out of a small room lined with dictionaries, none of them open.',
  method:
    'Kana until they are invisible, then kanji through the words that use them — a reading is learned in company, never alone.',
  principles: [
    'Kana before anything, and quickly.',
    'A kanji is learned inside a word, not on a list.',
    'Recognise, then produce. Never the other way round.',
  ],
  lines: {
    greeting: ['Shall we? A few minutes is plenty.', 'Ready when you are.', 'Small and often. That is the whole trick.'],
    recalled: ['Yes — that reading is yours.', 'Clean.', 'You did not hesitate. That is the sign.'],
    lapsed: [
      'Fine. Read it in the example sentence and it will stick better.',
      'That reading has a twin. Learn them as a pair.',
      'No harm — it will return sooner now.',
    ],
    finished: ['That is today done. Nicely.', 'Enough. Consistency beats volume.', 'Good session. Same time tomorrow?'],
    idle: ['Nothing waiting. Read something you enjoy instead.', 'Clear for now — the schedule will find you.'],
  },
};

const SEO_HAEUN: Teacher = {
  id: 'teacher-ko',
  languageCode: 'ko',
  name: '서하은',
  romanised: 'Seo Ha-eun',
  address: 'Seo seonsaengnim',
  glyph: '서',
  bio: 'Came to teaching from linguistics and never quite left the phonology behind.',
  method:
    'Hangul is a machine: learn the parts, assemble the blocks, then spend your time where the meaning actually lives — the endings.',
  principles: [
    'Hangul in a week, then never romanise again.',
    'Blocks, not letters. Read the syllable whole.',
    'The ending carries the sentence. Drill those hardest.',
  ],
  lines: {
    greeting: ['Let us do a short set.', 'Ready? Blocks first, meanings after.', 'A steady ten minutes.'],
    recalled: ['Good. That block reads itself now.', 'Correct — and quickly.', 'That one is stable.'],
    lapsed: [
      'Break it into the syllable blocks and try again.',
      'That ending changes the sentence. Worth the second look.',
      'A lapse is information. The scheduler heard it.',
    ],
    finished: ['Done, and done properly.', 'That is the set. Rest the ear.', 'Good work — the hard ones came back.'],
    idle: ['Nothing due. Listen to something instead.', 'Clear. Come back when the queue fills.'],
  },
};

const CO_MAI: Teacher = {
  id: 'teacher-vi',
  languageCode: 'vi',
  name: 'Nguyễn Thị Mai',
  romanised: 'Nguyen Thi Mai',
  address: 'Cô Mai',
  glyph: 'Mai',
  bio: 'Grew up between the Northern and Southern accents and teaches both without apology.',
  method:
    'Six tones by ear before anything else — minimal pairs, drilled until hỏi and ngã stop being the same word wearing different hats.',
  principles: [
    'The tone is the word. Get it first.',
    'Hear the pair before you read it.',
    'Northern in the drills, both in the ear.',
  ],
  lines: {
    greeting: ['Ready to listen?', 'A few minutes on the tones and we are done.', 'Ears first, eyes after.'],
    recalled: ['Đúng rồi — that is the tone.', 'Yes. You heard the difference.', 'That pair is safe now.'],
    lapsed: [
      'Say both members of the pair aloud. The contrast is easier than either one alone.',
      'Hỏi dips and comes back up. Ngã breaks in the middle.',
      'Miss it now, keep it later. That is the arrangement.',
    ],
    finished: ['Giỏi lắm. That is enough for today.', 'Done — your ear did the work.', 'Good. Tomorrow, the same again.'],
    idle: ['Nothing waiting. Put on some music with words.', 'Clear for now. The tones will keep.'],
  },
};

export const TEACHERS: Record<LanguageCode, Teacher> = {
  zh: LIN_MO,
  ja: MORI_AOI,
  ko: SEO_HAEUN,
  vi: CO_MAI,
};

export function getTeacher(code: LanguageCode): Teacher {
  const teacher = TEACHERS[code];
  if (!teacher) throw new Error(`No teacher for language: ${code}`);
  return teacher;
}

/**
 * Pick one of a teacher's lines for a moment.
 *
 * Deterministic in `seed` rather than random, deliberately. A line chosen with
 * `Math.random()` changes on every re-render, so the teacher appears to change
 * their mind mid-sentence whenever anything else on the screen updates. Callers
 * pass something stable for the moment being described — a card id, the number of
 * cards reviewed — and get the same line for as long as that moment lasts.
 */
export function teacherLine(teacher: Teacher, mood: TeacherMood, seed: number | string = 0): string {
  const lines = teacher.lines[mood];
  const index = typeof seed === 'number' ? Math.floor(Math.abs(seed)) : hash(seed);
  // Every mood ships at least one line, asserted in teachers.test.ts.
  return lines[index % lines.length]!;
}

/** FNV-1a, for turning a card id into a stable line choice. */
function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
