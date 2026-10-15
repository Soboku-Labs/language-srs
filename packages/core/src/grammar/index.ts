import type { LanguageCode } from '../types/language';

/**
 * Grammar, as something taught rather than something drilled.
 *
 * A flashcard is good at one job: keeping a fact you already understand from
 * fading. It is bad at the job before that. Nobody learns why Mandarin uses 很
 * where English uses "is" by being shown 很 on a card and asked to recall it —
 * they learn it by being told, shown three examples, and warned about the
 * mistake everyone makes. Which is what this is.
 *
 * The exam levels already carried a `grammarPointTarget`, so this hangs off the
 * same structure the vocabulary does: points belong to a level, and a level
 * knows how many it is supposed to have. What ships here is a beginner subset,
 * and the app says so rather than implying the syllabus is complete — the same
 * rule the vocabulary targets follow.
 *
 * Nothing here is scheduled. A grammar point is read, understood and marked, and
 * the scheduler is left to the cards that practise it.
 */

export interface GrammarExample {
  /** The sentence in the language being learned. */
  target: string;
  /** Pronunciation, where the script does not give it: pinyin, romaji, romaja. */
  reading?: string;
  gloss: string;
}

export interface GrammarPoint {
  id: string;
  languageCode: LanguageCode;
  /** The exam level this belongs to, by its id in `exams/`. */
  levelId: string;
  /** The form itself — 是, は, -이에요 — which is what somebody scans for. */
  form: string;
  title: string;
  /** One line. What this does, in the fewest words that are still true. */
  summary: string;
  /** The shape, as a pattern: "A 是 B". */
  pattern: string;
  explanation: string;
  examples: GrammarExample[];
  /**
   * The mistake learners reliably make.
   *
   * Worth its own field because it is the half that drilling cannot teach and
   * the half that marks somebody out as a beginner for years.
   */
  pitfall?: string;
}

const MANDARIN: GrammarPoint[] = [
  {
    id: 'zh-shi',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    form: '是',
    title: 'Linking two nouns with 是',
    summary: 'Joins a noun to a noun — never a noun to an adjective.',
    pattern: 'A 是 B',
    explanation:
      '是 equates two things: a person and their job, a thing and what it is. It is not the English verb "to be" in general, and the difference matters immediately, because English uses "is" for both "she is a doctor" and "she is tired" while Mandarin uses 是 only for the first.',
    examples: [
      { target: '我是学生。', reading: 'wǒ shì xuéshēng', gloss: 'I am a student.' },
      { target: '他是我哥哥。', reading: 'tā shì wǒ gēge', gloss: 'He is my older brother.' },
      { target: '这不是我的书。', reading: 'zhè bú shì wǒ de shū', gloss: 'This is not my book.' },
    ],
    pitfall: 'Not used before an adjective. "I am tired" is 我很累, never 我是累.',
  },
  {
    id: 'zh-hen-adj',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    form: '很',
    title: 'Adjectives stand as verbs, with 很',
    summary: 'An adjective is already the verb; 很 holds the slot where 是 would be.',
    pattern: 'Subject + 很 + adjective',
    explanation:
      'Mandarin adjectives behave like verbs: 累 means "to be tired", so no linking word is needed. A bare adjective sounds like a comparison, so 很 is normally there to fill the gap — and in that position it is usually much weaker than "very", closer to unstressed filler.',
    examples: [
      { target: '我很累。', reading: 'wǒ hěn lèi', gloss: 'I am tired.' },
      { target: '今天很热。', reading: 'jīntiān hěn rè', gloss: 'It is hot today.' },
      { target: '她的中文很好。', reading: 'tā de zhōngwén hěn hǎo', gloss: 'Her Chinese is good.' },
    ],
    pitfall: 'Translating 很 as "very" every time. 我很好 is "I am fine", not "I am very fine".',
  },
  {
    id: 'zh-bu-mei',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    form: '不 / 没',
    title: 'Two negatives, and when each applies',
    summary: '不 negates the general and the future; 没 negates 有 and what did not happen.',
    pattern: '不 + verb · 没(有) + verb',
    explanation:
      '不 covers habits, preferences and intentions — what is not the case or will not be. 没 says an event did not occur, and it is the only one that negates 有.',
    examples: [
      { target: '我不喝咖啡。', reading: 'wǒ bù hē kāfēi', gloss: 'I do not drink coffee.' },
      { target: '我没去。', reading: 'wǒ méi qù', gloss: 'I did not go.' },
      { target: '我没有钱。', reading: 'wǒ méiyǒu qián', gloss: 'I do not have money.' },
    ],
    pitfall: '不有 does not exist. Not having something is always 没有.',
  },
  {
    id: 'zh-ma',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    form: '吗',
    title: 'Yes-or-no questions with 吗',
    summary: 'Add 吗 to a statement; the word order does not move.',
    pattern: 'Statement + 吗？',
    explanation:
      'Mandarin does not invert anything to ask a question. The sentence stays exactly as it was and 吗 goes on the end — which makes questions markedly easier than in English.',
    examples: [
      { target: '你是学生吗？', reading: 'nǐ shì xuéshēng ma', gloss: 'Are you a student?' },
      { target: '他在家吗？', reading: 'tā zài jiā ma', gloss: 'Is he at home?' },
    ],
    pitfall: 'Not used with a question word already present. 你去哪儿吗 is wrong — 哪儿 is the question.',
  },
  {
    id: 'zh-de-possession',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    form: '的',
    title: 'Linking a modifier with 的',
    summary: 'Whatever describes comes first, joined to what it describes by 的.',
    pattern: 'Modifier + 的 + noun',
    explanation:
      '的 covers possession and description alike, and the modifier always precedes the noun. It is dropped in close relationships and set phrases: 我妈妈 rather than 我的妈妈.',
    examples: [
      { target: '我的书', reading: 'wǒ de shū', gloss: 'my book' },
      { target: '很贵的车', reading: 'hěn guì de chē', gloss: 'an expensive car' },
      { target: '我妈妈', reading: 'wǒ māma', gloss: 'my mother (的 dropped)' },
    ],
  },
  {
    id: 'zh-measure-ge',
    languageCode: 'zh',
    levelId: 'hsk3-1',
    form: '个',
    title: 'Counting needs a measure word',
    summary: 'A number never touches a noun directly.',
    pattern: 'Number + measure word + noun',
    explanation:
      'Every countable noun takes a measure word between the number and the noun. Nouns have one that belongs to them — 本 for books, 只 for certain animals — and 个 is the general one that will be understood anywhere.',
    examples: [
      { target: '三个人', reading: 'sān ge rén', gloss: 'three people' },
      { target: '一本书', reading: 'yì běn shū', gloss: 'one book' },
      { target: '两个苹果', reading: 'liǎng ge píngguǒ', gloss: 'two apples' },
    ],
    pitfall: '二 and 两 both mean two: 二 counts and numbers, 两 goes before a measure word.',
  },
  {
    id: 'zh-le',
    languageCode: 'zh',
    levelId: 'hsk3-2',
    form: '了',
    title: '了 for completion and for change',
    summary: 'Not a past tense — it marks an action completed, or a new state.',
    pattern: 'Verb + 了 · Sentence + 了',
    explanation:
      'After a verb, 了 says the action was carried through. At the end of a sentence it says something has changed and is now the case. Mandarin has no tense: 了 is about completion, which is why it appears in sentences about the future too.',
    examples: [
      { target: '我吃了饭。', reading: 'wǒ chī le fàn', gloss: 'I have eaten.' },
      { target: '下雨了。', reading: 'xià yǔ le', gloss: 'It is raining now (it has started).' },
      { target: '他长大了。', reading: 'tā zhǎng dà le', gloss: 'He has grown up.' },
    ],
    pitfall: 'Attaching 了 to every past sentence. Habits in the past take none: 小时候我常常去 — no 了.',
  },
];

const JAPANESE: GrammarPoint[] = [
  {
    id: 'ja-wa',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'は',
    title: 'は marks the topic',
    summary: 'Sets what the sentence is about — not necessarily its subject.',
    pattern: 'Topic + は + comment',
    explanation:
      'は announces the thing under discussion and everything after it is the comment. It is written は but pronounced "wa" in this role. Because it marks a topic rather than a subject, it can sit on something that is not doing the action at all.',
    examples: [
      { target: '私は学生です。', reading: 'watashi wa gakusei desu', gloss: 'I am a student.' },
      { target: '今日は暑いです。', reading: 'kyō wa atsui desu', gloss: 'Today is hot.' },
    ],
    pitfall: 'Written は, never わ, when it is the particle.',
  },
  {
    id: 'ja-wa-ga',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'は / が',
    title: 'は against が',
    summary: 'は takes what is already known; が introduces or picks out.',
    pattern: 'Known + は · New + が',
    explanation:
      'が marks the subject as new information or as the one singled out. は takes something already in play and comments on it. The clearest contrast is in answers: a question word is always answered with が, because the answer is precisely the new part.',
    examples: [
      { target: '猫がいます。', reading: 'neko ga imasu', gloss: 'There is a cat. (new)' },
      { target: '猫は好きです。', reading: 'neko wa suki desu', gloss: 'As for cats, I like them.' },
      { target: '誰が来ましたか。', reading: 'dare ga kimashita ka', gloss: 'Who came?' },
    ],
    pitfall: 'Answering a 誰 or 何 question with は. The new information takes が.',
  },
  {
    id: 'ja-desu',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'です',
    title: 'です and the level you are speaking at',
    summary: 'Politeness is grammar here, not tone of voice.',
    pattern: 'Noun / adjective + です',
    explanation:
      'です closes a polite sentence; だ is its plain counterpart used with people you are close to. Japanese encodes the relationship between speakers in the verb ending itself, so the choice is made in every sentence whether you intend it or not.',
    examples: [
      { target: 'これは本です。', reading: 'kore wa hon desu', gloss: 'This is a book.' },
      { target: '学生でした。', reading: 'gakusei deshita', gloss: 'I was a student.' },
    ],
    pitfall: 'い-adjectives are already complete: 高いです is polite, 高いだ is not Japanese.',
  },
  {
    id: 'ja-wo',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'を',
    title: 'を marks the direct object',
    summary: 'The thing the verb is done to, and the verb comes last.',
    pattern: 'Object + を + verb',
    explanation:
      'Japanese puts the verb at the end, and を tags what is being acted on. Because the particles carry the roles, the order of the parts before the verb can move without the meaning changing.',
    examples: [
      { target: 'パンを食べます。', reading: 'pan o tabemasu', gloss: 'I eat bread.' },
      { target: '本を読みました。', reading: 'hon o yomimashita', gloss: 'I read a book.' },
    ],
    pitfall: 'Written を, and pronounced "o".',
  },
  {
    id: 'ja-ni-de',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'に / で',
    title: 'に against で',
    summary: 'に is where something is or goes; で is where something happens.',
    pattern: 'Place + に + exist/go · Place + で + action',
    explanation:
      'に marks a destination, a point in time, or where something exists. で marks the setting an action is carried out in. The same place word takes either, and the particle is what decides the meaning.',
    examples: [
      { target: '学校に行きます。', reading: 'gakkō ni ikimasu', gloss: 'I go to school.' },
      { target: '学校で勉強します。', reading: 'gakkō de benkyō shimasu', gloss: 'I study at school.' },
      { target: '七時に起きます。', reading: 'shichi-ji ni okimasu', gloss: 'I get up at seven.' },
    ],
  },
  {
    id: 'ja-masu-negative',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'ません',
    title: 'Negating the polite verb',
    summary: 'ます becomes ません; past adds でした.',
    pattern: 'Verb stem + ません / ませんでした',
    explanation:
      'The polite form inflects on the ending rather than with a separate word. Four endings cover the whole grid: ます, ません, ました, ませんでした.',
    examples: [
      { target: '飲みません。', reading: 'nomimasen', gloss: 'I do not drink.' },
      { target: '行きませんでした。', reading: 'ikimasen deshita', gloss: 'I did not go.' },
    ],
  },
  {
    id: 'ja-no',
    languageCode: 'ja',
    levelId: 'jlpt-n5',
    form: 'の',
    title: 'の links noun to noun',
    summary: 'Possession and description, with the owner first.',
    pattern: 'A の B',
    explanation:
      'の joins two nouns so that A describes or owns B. It chains freely, and each の narrows what follows it.',
    examples: [
      { target: '私の本', reading: 'watashi no hon', gloss: 'my book' },
      { target: '日本語の先生', reading: 'nihongo no sensei', gloss: 'a Japanese teacher' },
    ],
    pitfall: 'The order is the reverse of English "of": 日本語の先生, not 先生の日本語.',
  },
];

const KOREAN: GrammarPoint[] = [
  {
    id: 'ko-eun-neun',
    languageCode: 'ko',
    levelId: 'topik-1',
    form: '은 / 는',
    title: 'The topic marker, and which form to use',
    summary: 'Marks what the sentence is about; the form follows the final sound.',
    pattern: 'Consonant + 은 · Vowel + 는',
    explanation:
      'Korean particles come in pairs and the choice is phonetic: 은 after a word ending in a consonant, 는 after a vowel. The particle itself marks the topic — the thing being spoken about, often with a sense of contrast.',
    examples: [
      { target: '저는 학생이에요.', reading: 'jeo-neun haksaeng-ieyo', gloss: 'I am a student.' },
      { target: '이름은 민수예요.', reading: 'ireum-eun Minsu-yeyo', gloss: 'My name is Minsu.' },
    ],
    pitfall: 'The pairing is by sound, not meaning — 은 and 는 are one particle, not two.',
  },
  {
    id: 'ko-i-ga',
    languageCode: 'ko',
    levelId: 'topik-1',
    form: '이 / 가',
    title: 'The subject marker',
    summary: 'Marks who or what performs; 이 after a consonant, 가 after a vowel.',
    pattern: 'Consonant + 이 · Vowel + 가',
    explanation:
      'Where 은/는 sets the topic, 이/가 marks the grammatical subject, and it is what new information takes. Both can appear in one sentence: the topic frames it and the subject acts within that frame.',
    examples: [
      { target: '사람이 많아요.', reading: 'sarami manayo', gloss: 'There are a lot of people.' },
      { target: '제가 할게요.', reading: 'jega halgeyo', gloss: 'I will do it.' },
    ],
  },
  {
    id: 'ko-eul-reul',
    languageCode: 'ko',
    levelId: 'topik-1',
    form: '을 / 를',
    title: 'The object marker',
    summary: 'Marks what is acted on; the verb goes last.',
    pattern: 'Object + 을/를 + verb',
    explanation:
      'Korean is subject-object-verb, and 을 (after a consonant) or 를 (after a vowel) tags the object. In casual speech the marker is often dropped when context makes the role obvious.',
    examples: [
      { target: '밥을 먹어요.', reading: 'babeul meogeoyo', gloss: 'I eat rice.' },
      { target: '영화를 봐요.', reading: 'yeonghwareul bwayo', gloss: 'I watch a film.' },
    ],
  },
  {
    id: 'ko-ieyo',
    languageCode: 'ko',
    levelId: 'topik-1',
    form: '이에요 / 예요',
    title: 'Saying what something is',
    summary: 'The polite copula; 이에요 after a consonant, 예요 after a vowel.',
    pattern: 'Noun + 이에요/예요',
    explanation:
      'This is the everyday polite ending for "is". 입니다 is its formal counterpart, used in announcements, presentations and to people markedly senior.',
    examples: [
      { target: '학생이에요.', reading: 'haksaeng-ieyo', gloss: 'I am a student.' },
      { target: '의사예요.', reading: 'uisa-yeyo', gloss: 'I am a doctor.' },
      { target: '학생입니다.', reading: 'haksaeng-imnida', gloss: 'I am a student. (formal)' },
    ],
  },
  {
    id: 'ko-e-eseo',
    languageCode: 'ko',
    levelId: 'topik-1',
    form: '에 / 에서',
    title: '에 against 에서',
    summary: '에 is where something is or goes; 에서 is where something happens.',
    pattern: 'Place + 에 + go/exist · Place + 에서 + action',
    explanation:
      'The split matches Japanese に and で closely. 에 marks a destination, a location of existence, or a time; 에서 marks the place an activity is carried out, and also a point of origin.',
    examples: [
      { target: '집에 가요.', reading: 'jibe gayo', gloss: 'I go home.' },
      { target: '집에서 일해요.', reading: 'jibeseo ilhaeyo', gloss: 'I work at home.' },
    ],
  },
  {
    id: 'ko-negation',
    languageCode: 'ko',
    levelId: 'topik-1',
    form: '안 / -지 않다',
    title: 'Two ways to say no',
    summary: '안 before the verb, or -지 않다 attached to it.',
    pattern: '안 + verb · Verb stem + 지 않다',
    explanation:
      'Both negate, and they are interchangeable in most sentences. 안 is shorter and dominates speech; -지 않다 is a little more formal and more usual in writing. 못 is separate again and means unable rather than unwilling.',
    examples: [
      { target: '안 먹어요.', reading: 'an meogeoyo', gloss: 'I do not eat it.' },
      { target: '먹지 않아요.', reading: 'meokji anayo', gloss: 'I do not eat it.' },
      { target: '못 가요.', reading: 'mot gayo', gloss: 'I cannot go.' },
    ],
    pitfall: 'With 하다 verbs, 안 splits them: 공부 안 해요, not 안 공부해요.',
  },
];

const VIETNAMESE: GrammarPoint[] = [
  {
    id: 'vi-la',
    languageCode: 'vi',
    levelId: 'vsl-1',
    form: 'là',
    title: 'là joins two nouns',
    summary: 'Used between nouns, and left out before adjectives.',
    pattern: 'A là B',
    explanation:
      'là equates one noun with another. Before an adjective it is dropped entirely, because Vietnamese adjectives work as verbs in their own right — the same split Mandarin makes with 是 and 很.',
    examples: [
      { target: 'Tôi là sinh viên.', gloss: 'I am a student.' },
      { target: 'Đây là bạn tôi.', gloss: 'This is my friend.' },
      { target: 'Tôi mệt.', gloss: 'I am tired. (no là)' },
    ],
    pitfall: '"Tôi là mệt" is wrong. An adjective needs no là.',
  },
  {
    id: 'vi-khong',
    languageCode: 'vi',
    levelId: 'vsl-1',
    form: 'không',
    title: 'không negates, and also asks',
    summary: 'Before the verb it means not; at the end it makes a question.',
    pattern: 'Subject + không + verb · Subject + có + verb + không?',
    explanation:
      'The same word does both jobs and position decides which. Before the verb it negates. Wrapped around the verb as có … không it forms a yes-or-no question.',
    examples: [
      { target: 'Tôi không hiểu.', gloss: 'I do not understand.' },
      { target: 'Bạn có khỏe không?', gloss: 'Are you well?' },
      { target: 'Anh không đi.', gloss: 'He is not going.' },
    ],
  },
  {
    id: 'vi-tense-markers',
    languageCode: 'vi',
    levelId: 'vsl-1',
    form: 'đã / đang / sẽ',
    title: 'Time is a word, not an ending',
    summary: 'Verbs never change; a marker goes in front when time is not obvious.',
    pattern: 'Subject + đã/đang/sẽ + verb',
    explanation:
      'đã marks completion, đang something in progress, sẽ something to come. They are omitted whenever the time is already clear from context or from a word such as "yesterday", which is most of the time in ordinary speech.',
    examples: [
      { target: 'Tôi đã ăn.', gloss: 'I ate / I have eaten.' },
      { target: 'Tôi đang ăn.', gloss: 'I am eating.' },
      { target: 'Tôi sẽ ăn.', gloss: 'I will eat.' },
    ],
    pitfall: 'Using a marker in every sentence. "Hôm qua tôi ăn phở" needs no đã.',
  },
  {
    id: 'vi-adjective-order',
    languageCode: 'vi',
    levelId: 'vsl-1',
    form: 'noun + adjective',
    title: 'The describing word comes second',
    summary: 'Opposite to English: the noun leads.',
    pattern: 'Noun + adjective',
    explanation:
      'Vietnamese places modifiers after what they modify, which reverses English order throughout — and the habit has to be rebuilt deliberately, because it applies to almost every description.',
    examples: [
      { target: 'nhà đẹp', gloss: 'a beautiful house (house beautiful)' },
      { target: 'cà phê sữa đá', gloss: 'iced milk coffee (coffee milk ice)' },
    ],
  },
  {
    id: 'vi-classifiers',
    languageCode: 'vi',
    levelId: 'vsl-1',
    form: 'con / cái',
    title: 'Classifiers before the noun',
    summary: 'Counting and pointing need a classifier, chosen by what the thing is.',
    pattern: 'Number + classifier + noun',
    explanation:
      'con is used for animals and things treated as animate; cái is the general one for inanimate objects. Others are more specific — quyển for books, chiếc for vehicles and single items of a pair.',
    examples: [
      { target: 'hai con mèo', gloss: 'two cats' },
      { target: 'một cái bàn', gloss: 'one table' },
      { target: 'quyển sách này', gloss: 'this book' },
    ],
  },
  {
    id: 'vi-pronouns',
    languageCode: 'vi',
    levelId: 'vsl-1',
    form: 'anh / chị / em',
    title: 'Pronouns carry the relationship',
    summary: 'Which word means "I" depends on who you are speaking to.',
    pattern: 'Kinship term as pronoun',
    explanation:
      'Vietnamese mostly uses kinship terms where English uses pronouns, chosen by relative age and relationship: anh for an older male, chị for an older female, em for someone younger. The same person is anh to one listener and em to another, and the choice is made every time either party speaks.',
    examples: [
      { target: 'Anh khỏe không?', gloss: 'Are you well? (to an older man)' },
      { target: 'Em cảm ơn anh.', gloss: 'Thank you. (younger speaker to older man)' },
    ],
    pitfall: 'tôi is neutral and safe but distant; among friends it can sound cold.',
  },
];

const ALL: GrammarPoint[] = [...MANDARIN, ...JAPANESE, ...KOREAN, ...VIETNAMESE];

const BY_ID = new Map(ALL.map((point) => [point.id, point]));

/** Every point shipped for a language, in teaching order. */
export function getGrammarPoints(code: LanguageCode): GrammarPoint[] {
  return ALL.filter((point) => point.languageCode === code);
}

/** The points belonging to one exam level. */
export function getGrammarPointsForLevel(levelId: string): GrammarPoint[] {
  return ALL.filter((point) => point.levelId === levelId);
}

export function findGrammarPoint(id: string): GrammarPoint | undefined {
  return BY_ID.get(id);
}
