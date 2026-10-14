import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../types/language';
import { JOURNEYS, getJourney, getLadder, stageEarned } from './index';

describe('the ladders themselves', () => {
  it('has one for every language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getLadder(code).stages.length).toBeGreaterThan(5);
    }
  });

  it('starts every ladder at zero, so a new learner is somewhere rather than nowhere', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getLadder(code).stages[0]!.wordsRequired).toBe(0);
    }
  });

  it('rises strictly, so no two stages can be reached by the same word', () => {
    for (const code of LANGUAGE_CODES) {
      const required = getLadder(code).stages.map((stage) => stage.wordsRequired);
      for (let index = 1; index < required.length; index += 1) {
        expect(required[index]).toBeGreaterThan(required[index - 1]!);
      }
    }
  });

  it('puts the second stage within reach of a starter deck', () => {
    // The seed decks hold about thirty words. A ladder whose first step is at
    // 200 would leave a new learner climbing nothing for a fortnight.
    for (const code of LANGUAGE_CODES) {
      expect(getLadder(code).stages[1]!.wordsRequired).toBeLessThanOrEqual(30);
    }
  });

  it('still has room at the top for a full syllabus', () => {
    for (const code of LANGUAGE_CODES) {
      const stages = getLadder(code).stages;
      expect(stages[stages.length - 1]!.wordsRequired).toBeGreaterThan(3000);
    }
  });

  it('names every stage in the language, with a gloss', () => {
    for (const code of LANGUAGE_CODES) {
      for (const stage of getLadder(code).stages) {
        expect(stage.native.length).toBeGreaterThan(0);
        expect(stage.meaning.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives each language its own ladder rather than one renamed four times', () => {
    const firsts = LANGUAGE_CODES.map((code) => getLadder(code).stages[0]!.native);
    expect(new Set(firsts).size).toBe(LANGUAGE_CODES.length);
  });

  it('romanises what is not already Latin, and does not pad what is', () => {
    for (const stage of JOURNEYS.zh.stages) expect(stage.romanised).toBeTruthy();
    for (const stage of JOURNEYS.ja.stages) expect(stage.romanised).toBeTruthy();
    for (const stage of JOURNEYS.ko.stages) expect(stage.romanised).toBeTruthy();
    // Vietnamese is written in Latin script; a "romanisation" column would be
    // the same string twice.
    for (const stage of JOURNEYS.vi.stages) expect(stage.romanised).toBeUndefined();
  });

  it('keeps the orderings that make each tradition recognisable', () => {
    // Spot checks against the canonical sequences rather than the whole list.
    expect(JOURNEYS.zh.stages[0]!.native).toBe('立春');
    expect(JOURNEYS.zh.stages[23]!.native).toBe('大寒');
    expect(JOURNEYS.ja.stages[10]!.native).toBe('初段');
    expect(JOURNEYS.ko.stages.slice(0, 4).map((s) => s.native)).toEqual(['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ']);
    // The Vietnamese zodiac is not the Chinese one: fourth is the cat.
    expect(JOURNEYS.vi.stages[3]!.meaning).toBe('Cat');
    expect(JOURNEYS.vi.stages[1]!.meaning).toBe('Water buffalo');
  });
});

describe('standing on the ladder', () => {
  it('puts someone who knows nothing on the first stage', () => {
    const journey = getJourney('zh', 0);
    expect(journey.stageNumber).toBe(1);
    expect(journey.stage.native).toBe('立春');
    expect(journey.wordsIntoStage).toBe(0);
  });

  it('advances only when words are actually known', () => {
    const ladder = getLadder('zh').stages;
    const second = ladder[1]!.wordsRequired;

    expect(getJourney('zh', second - 1).stageNumber).toBe(1);
    expect(getJourney('zh', second).stageNumber).toBe(2);
  });

  it('reports what is left to the next stage', () => {
    const second = getLadder('ko').stages[1]!.wordsRequired;
    const journey = getJourney('ko', second - 2);
    expect(journey.wordsToNext).toBe(2);
    expect(journey.next?.native).toBe('ㄴ');
  });

  it('tops out cleanly rather than inventing a stage that does not exist', () => {
    const ladder = getLadder('vi').stages;
    const journey = getJourney('vi', ladder[ladder.length - 1]!.wordsRequired + 5000);

    expect(journey.stageNumber).toBe(ladder.length);
    expect(journey.next).toBeUndefined();
    expect(journey.wordsToNext).toBeUndefined();
    expect(journey.progress).toBe(1);
  });

  it('keeps progress inside the stage between 0 and 1', () => {
    for (const code of LANGUAGE_CODES) {
      for (let known = 0; known < 4000; known += 37) {
        const journey = getJourney(code, known);
        expect(journey.progress).toBeGreaterThanOrEqual(0);
        expect(journey.progress).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never goes backwards as words are added', () => {
    // The property that makes this a rank rather than a score.
    for (const code of LANGUAGE_CODES) {
      let previous = 0;
      for (let known = 0; known < 6000; known += 13) {
        const stage = getJourney(code, known).stageNumber;
        expect(stage).toBeGreaterThanOrEqual(previous);
        previous = stage;
      }
    }
  });

  it('ignores a nonsense count rather than throwing', () => {
    expect(getJourney('zh', -40).stageNumber).toBe(1);
    expect(getJourney('zh', 12.7).wordsKnown).toBe(12);
  });
});

describe('earning a stage', () => {
  it('reports the stage crossed during a session', () => {
    const second = getLadder('ja').stages[1]!.wordsRequired;
    const earned = stageEarned('ja', second - 1, second);
    expect(earned?.native).toBe('九級');
  });

  it('reports nothing when the session did not cross one', () => {
    expect(stageEarned('ja', 0, 1)).toBeUndefined();
  });

  it('reports the stage landed on when several are crossed at once', () => {
    // A bulk import can move someone several stages in one sitting.
    const ladder = getLadder('zh').stages;
    const earned = stageEarned('zh', 0, ladder[4]!.wordsRequired);
    expect(earned?.native).toBe(ladder[4]!.native);
  });

  it('never reports a demotion', () => {
    expect(stageEarned('zh', 900, 100)).toBeUndefined();
  });
});
