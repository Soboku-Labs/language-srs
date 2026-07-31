import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from '../types/language';
import { TEACHERS, getTeacher, teacherLine, type TeacherMood } from './index';

const MOODS: TeacherMood[] = ['greeting', 'recalled', 'lapsed', 'finished', 'idle'];

describe('teachers', () => {
  it('gives every supported language a teacher', () => {
    for (const code of LANGUAGE_CODES) {
      expect(getTeacher(code).languageCode).toBe(code);
    }
  });

  it('rejects an unknown language rather than returning a broken teacher', () => {
    // @ts-expect-error deliberately invalid, mirroring bad stored state
    expect(() => getTeacher('es')).toThrow(/No teacher for language/);
  });

  it('gives each teacher a distinct identity', () => {
    const teachers = Object.values(TEACHERS);
    expect(new Set(teachers.map((teacher) => teacher.id)).size).toBe(teachers.length);
    expect(new Set(teachers.map((teacher) => teacher.address)).size).toBe(teachers.length);
    expect(new Set(teachers.map((teacher) => teacher.glyph)).size).toBe(teachers.length);
  });

  /**
   * The glyph is rendered as a portrait in a fixed circle. Anything longer than a
   * short monogram either overflows it or has to be shrunk until it is unreadable.
   */
  it('keeps portrait glyphs to a monogram', () => {
    for (const teacher of Object.values(TEACHERS)) {
      expect(teacher.glyph.length, teacher.id).toBeGreaterThan(0);
      expect(teacher.glyph.length, teacher.id).toBeLessThanOrEqual(3);
    }
  });

  it('states a method for every teacher, since that is what the landing page shows', () => {
    for (const teacher of Object.values(TEACHERS)) {
      expect(teacher.method.length, teacher.id).toBeGreaterThan(40);
      expect(teacher.principles, teacher.id).toHaveLength(3);
      for (const principle of teacher.principles) expect(principle.length).toBeGreaterThan(0);
    }
  });

  it('has at least one line for every moment', () => {
    for (const teacher of Object.values(TEACHERS)) {
      for (const mood of MOODS) {
        expect(teacher.lines[mood].length, `${teacher.id}.${mood}`).toBeGreaterThan(0);
        for (const line of teacher.lines[mood]) expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('teacherLine', () => {
  it('returns a line from the requested mood', () => {
    const teacher = getTeacher('zh');
    expect(teacher.lines.lapsed).toContain(teacherLine(teacher, 'lapsed', 3));
  });

  it('wraps rather than returning undefined past the end of the list', () => {
    const teacher = getTeacher('ja');
    expect(typeof teacherLine(teacher, 'greeting', 9_999)).toBe('string');
  });

  /**
   * The whole reason this takes a seed instead of calling Math.random: a line that
   * changes on every render makes the teacher look like they are stammering.
   */
  it('is stable for the same seed and varies across seeds', () => {
    const teacher = getTeacher('ko');
    expect(teacherLine(teacher, 'greeting', 1)).toBe(teacherLine(teacher, 'greeting', 1));

    const seen = new Set(teacher.lines.greeting.map((_, index) => teacherLine(teacher, 'greeting', index)));
    expect(seen.size).toBe(teacher.lines.greeting.length);
  });

  it('accepts a string seed, so a card id can choose the line', () => {
    const teacher = getTeacher('vi');
    const line = teacherLine(teacher, 'recalled', 'vi-xinchao:recognition');
    expect(teacher.lines.recalled).toContain(line);
    expect(teacherLine(teacher, 'recalled', 'vi-xinchao:recognition')).toBe(line);
  });

  it('handles a negative seed without falling off the list', () => {
    const teacher = getTeacher('zh');
    expect(teacher.lines.idle).toContain(teacherLine(teacher, 'idle', -3));
  });
});
