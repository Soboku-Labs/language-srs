import type { LanguageCode } from '../types/language';

/**
 * The journey: a rank you cannot farm.
 *
 * Every mainstream language app rewards *activity*. XP for minutes spent, streaks
 * for opening the app, leagues for grinding. The well-known consequence is that
 * the number goes up whether or not anything was learned, and people optimise the
 * number — which is rational, because the number is what the app asked for.
 *
 * This app already measures the thing that matters: a word is "known" when every
 * card for it is in review with a stability of a week or more. That is a
 * statement about memory, not about effort, and it cannot be produced by sitting
 * in the app pressing Good. So the rank is derived from it directly. Study badly
 * and the rank does not move, however long you were here.
 *
 * It also never goes down. Stability does not decay when you stop — retrievability
 * does — so a rank earned stays earned. A ladder that demotes you for missing a
 * fortnight is a retention mechanic dressed as an achievement, and this app
 * already has an honest way of telling you your recall has slipped: it shows you
 * your recall.
 *
 * ## Why these ladders
 *
 * A generic "Level 7" says nothing about the language you are learning. Each
 * ladder here is a real ordering from the culture whose language it belongs to,
 * so the rank is a small piece of the subject rather than an app-shaped token:
 *
 * - **Mandarin** climbs the 二十四节气, the twenty-four solar terms of the
 *   Chinese agricultural calendar — UNESCO intangible cultural heritage, and
 *   still how the farming year is spoken about.
 * - **Japanese** climbs 級 to 段, the kyū–dan ladder used by the Kanji Kentei,
 *   by go and shogi, and by the martial and brush arts. It is *the* Japanese
 *   idiom for graded mastery.
 * - **Korean** climbs the consonants of 한글 in dictionary order. Hangul is
 *   Korea's defining cultural invention, the first thing a learner meets, and
 *   the order is the one every Korean dictionary and classroom uses.
 * - **Vietnamese** climbs the 12 con giáp, the Vietnamese zodiac — which is not
 *   the Chinese one: the fourth animal is the cat, not the rabbit, and the
 *   second is the water buffalo rather than the ox.
 *
 * The non-English text here is the part most worth a native speaker's eye before
 * this ships to real learners. The orderings are standard and checkable; the
 * one-line glosses are mine.
 */

export interface JourneyStage {
  /** 0-based position in the ladder. */
  index: number;
  /** As written in the language. For Vietnamese that is already Latin script. */
  native: string;
  /** How to say it. Omitted when `native` is already romanised. */
  romanised?: string;
  /** A few words on what it is. */
  meaning: string;
  /** Words known needed to reach this stage. */
  wordsRequired: number;
}

export interface JourneyLadder {
  languageCode: LanguageCode;
  /** One line naming the tradition, shown once so the ladder is not a mystery. */
  tradition: string;
  stages: JourneyStage[];
}

export interface Journey {
  languageCode: LanguageCode;
  tradition: string;
  stage: JourneyStage;
  /** The stage after this one. Absent at the top of the ladder. */
  next?: JourneyStage;
  /** 1-based, for "4 of 24". */
  stageNumber: number;
  totalStages: number;
  wordsKnown: number;
  /** Words earned since entering this stage. */
  wordsIntoStage: number;
  /** Words still needed for the next stage. Absent at the top. */
  wordsToNext?: number;
  /** 0-1 through the current stage. 1 at the top of the ladder. */
  progress: number;
}

/**
 * Where each ladder's stages sit, in words known.
 *
 * A power curve rather than even spacing. The early stages have to be reachable
 * on a starter deck of a few dozen words, or a new learner climbs nothing for a
 * fortnight; the late ones have to stay meaningful against a syllabus of several
 * thousand, or the ladder is finished before the exam is. An exponent of 2.4
 * gives first steps at 3 and 14 words and still spreads the rest across the
 * whole range.
 */
function spacing(count: number, top: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 0;
    return Math.round(top * (index / (count - 1)) ** 2.4);
  });
}

function ladder(
  languageCode: LanguageCode,
  tradition: string,
  top: number,
  stages: Omit<JourneyStage, 'index' | 'wordsRequired'>[],
): JourneyLadder {
  const points = spacing(stages.length, top);
  return {
    languageCode,
    tradition,
    stages: stages.map((stage, index) => ({ ...stage, index, wordsRequired: points[index]! })),
  };
}

/** 二十四节气 — the twenty-four solar terms, in calendar order from the start of spring. */
const MANDARIN = ladder(
  'zh',
  'The twenty-four solar terms of the Chinese agricultural calendar',
  6000,
  [
    { native: '立春', romanised: 'lìchūn', meaning: 'Start of spring' },
    { native: '雨水', romanised: 'yǔshuǐ', meaning: 'Rain water' },
    { native: '惊蛰', romanised: 'jīngzhé', meaning: 'Insects awaken' },
    { native: '春分', romanised: 'chūnfēn', meaning: 'Spring equinox' },
    { native: '清明', romanised: 'qīngmíng', meaning: 'Clear and bright' },
    { native: '谷雨', romanised: 'gǔyǔ', meaning: 'Grain rain' },
    { native: '立夏', romanised: 'lìxià', meaning: 'Start of summer' },
    { native: '小满', romanised: 'xiǎomǎn', meaning: 'Grain buds' },
    { native: '芒种', romanised: 'mángzhòng', meaning: 'Grain in ear' },
    { native: '夏至', romanised: 'xiàzhì', meaning: 'Summer solstice' },
    { native: '小暑', romanised: 'xiǎoshǔ', meaning: 'Minor heat' },
    { native: '大暑', romanised: 'dàshǔ', meaning: 'Major heat' },
    { native: '立秋', romanised: 'lìqiū', meaning: 'Start of autumn' },
    { native: '处暑', romanised: 'chùshǔ', meaning: 'End of heat' },
    { native: '白露', romanised: 'báilù', meaning: 'White dew' },
    { native: '秋分', romanised: 'qiūfēn', meaning: 'Autumn equinox' },
    { native: '寒露', romanised: 'hánlù', meaning: 'Cold dew' },
    { native: '霜降', romanised: 'shuāngjiàng', meaning: 'Frost descends' },
    { native: '立冬', romanised: 'lìdōng', meaning: 'Start of winter' },
    { native: '小雪', romanised: 'xiǎoxuě', meaning: 'Minor snow' },
    { native: '大雪', romanised: 'dàxuě', meaning: 'Major snow' },
    { native: '冬至', romanised: 'dōngzhì', meaning: 'Winter solstice' },
    { native: '小寒', romanised: 'xiǎohán', meaning: 'Minor cold' },
    { native: '大寒', romanised: 'dàhán', meaning: 'Major cold' },
  ],
);

/** 級 to 段 — counting down through the kyū grades, then up through the dan ranks. */
const JAPANESE = ladder(
  'ja',
  'The kyū and dan grades, as used by the Kanji Kentei and the brush and board arts',
  10000,
  [
    { native: '十級', romanised: 'jukkyū', meaning: 'Tenth grade' },
    { native: '九級', romanised: 'kyūkyū', meaning: 'Ninth grade' },
    { native: '八級', romanised: 'hachikyū', meaning: 'Eighth grade' },
    { native: '七級', romanised: 'nanakyū', meaning: 'Seventh grade' },
    { native: '六級', romanised: 'rokkyū', meaning: 'Sixth grade' },
    { native: '五級', romanised: 'gokyū', meaning: 'Fifth grade' },
    { native: '四級', romanised: 'yonkyū', meaning: 'Fourth grade' },
    { native: '三級', romanised: 'sankyū', meaning: 'Third grade' },
    { native: '二級', romanised: 'nikyū', meaning: 'Second grade' },
    { native: '一級', romanised: 'ikkyū', meaning: 'First grade' },
    { native: '初段', romanised: 'shodan', meaning: 'First rank' },
    { native: '二段', romanised: 'nidan', meaning: 'Second rank' },
    { native: '三段', romanised: 'sandan', meaning: 'Third rank' },
    { native: '四段', romanised: 'yondan', meaning: 'Fourth rank' },
  ],
);

/** 한글 자음 — the fourteen basic consonants, in dictionary order. */
const KOREAN = ladder(
  'ko',
  'The fourteen basic consonants of Hangul, in dictionary order',
  10000,
  [
    { native: 'ㄱ', romanised: 'giyeok', meaning: 'g / k' },
    { native: 'ㄴ', romanised: 'nieun', meaning: 'n' },
    { native: 'ㄷ', romanised: 'digeut', meaning: 'd / t' },
    { native: 'ㄹ', romanised: 'rieul', meaning: 'r / l' },
    { native: 'ㅁ', romanised: 'mieum', meaning: 'm' },
    { native: 'ㅂ', romanised: 'bieup', meaning: 'b / p' },
    { native: 'ㅅ', romanised: 'siot', meaning: 's' },
    { native: 'ㅇ', romanised: 'ieung', meaning: 'ng, or silent' },
    { native: 'ㅈ', romanised: 'jieut', meaning: 'j' },
    { native: 'ㅊ', romanised: 'chieut', meaning: 'ch' },
    { native: 'ㅋ', romanised: 'kieuk', meaning: 'aspirated k' },
    { native: 'ㅌ', romanised: 'tieut', meaning: 'aspirated t' },
    { native: 'ㅍ', romanised: 'pieup', meaning: 'aspirated p' },
    { native: 'ㅎ', romanised: 'hieut', meaning: 'h' },
  ],
);

/** 12 con giáp — the Vietnamese zodiac. The fourth animal is the cat, not the rabbit. */
const VIETNAMESE = ladder(
  'vi',
  'The twelve animals of the Vietnamese zodiac',
  8000,
  [
    { native: 'Tý', meaning: 'Rat' },
    { native: 'Sửu', meaning: 'Water buffalo' },
    { native: 'Dần', meaning: 'Tiger' },
    { native: 'Mão', meaning: 'Cat' },
    { native: 'Thìn', meaning: 'Dragon' },
    { native: 'Tỵ', meaning: 'Snake' },
    { native: 'Ngọ', meaning: 'Horse' },
    { native: 'Mùi', meaning: 'Goat' },
    { native: 'Thân', meaning: 'Monkey' },
    { native: 'Dậu', meaning: 'Rooster' },
    { native: 'Tuất', meaning: 'Dog' },
    { native: 'Hợi', meaning: 'Pig' },
  ],
);

export const JOURNEYS: Record<LanguageCode, JourneyLadder> = {
  zh: MANDARIN,
  ja: JAPANESE,
  ko: KOREAN,
  vi: VIETNAMESE,
};

export function getLadder(code: LanguageCode): JourneyLadder {
  const found = JOURNEYS[code];
  if (!found) throw new Error(`No journey ladder for ${code}`);
  return found;
}

/**
 * Where a learner stands, from the words they actually know.
 *
 * `wordsKnown` is `coverage.entriesKnown` — words whose every card is in review
 * at a week's stability or better. Pass anything else and the rank stops meaning
 * what it says.
 */
export function getJourney(code: LanguageCode, wordsKnown: number): Journey {
  const { stages, tradition } = getLadder(code);
  const known = Math.max(0, Math.floor(wordsKnown));

  // The last stage whose requirement has been met. Stage one requires nothing,
  // so there is always an answer.
  let index = 0;
  for (let candidate = stages.length - 1; candidate >= 0; candidate -= 1) {
    if (known >= stages[candidate]!.wordsRequired) {
      index = candidate;
      break;
    }
  }

  const stage = stages[index]!;
  const next = stages[index + 1];
  const wordsIntoStage = known - stage.wordsRequired;

  return {
    languageCode: code,
    tradition,
    stage,
    ...(next ? { next } : {}),
    stageNumber: index + 1,
    totalStages: stages.length,
    wordsKnown: known,
    wordsIntoStage,
    ...(next ? { wordsToNext: next.wordsRequired - known } : {}),
    progress: next ? wordsIntoStage / (next.wordsRequired - stage.wordsRequired) : 1,
  };
}

/**
 * Whether crossing from one count to another earns a new stage.
 *
 * Used at the end of a session to decide whether there is something to celebrate.
 * Takes both counts rather than a journey, because the interesting moment is the
 * transition and the app only ever sees the two ends of it.
 */
export function stageEarned(
  code: LanguageCode,
  wordsBefore: number,
  wordsAfter: number,
): JourneyStage | undefined {
  const before = getJourney(code, wordsBefore);
  const after = getJourney(code, wordsAfter);
  return after.stageNumber > before.stageNumber ? after.stage : undefined;
}
