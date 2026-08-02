import { describe, expect, it } from 'vitest';
import { formatWhen, normalizeWhen, parseDateInput, type WhenValue } from './when';

/**
 * The invariant and the parser are the two halves of this that a rendering test
 * would not reach: one is a rule about combinations no click sequence produces in
 * order, and the other is about the set of strings a keyboard can make.
 */

const base: WhenValue = {
  startDate: '2026-08-04',
  endDate: '2026-08-04',
  allDay: true,
  startMinutes: 9 * 60,
  endMinutes: 10 * 60,
};

describe('normalizeWhen', () => {
  it('leaves a well-formed value alone', () => {
    const v = { ...base, endDate: '2026-08-06' };
    expect(normalizeWhen(v)).toEqual(v);
  });

  it('pulls a backwards end date up to the start', () => {
    expect(normalizeWhen({ ...base, startDate: '2026-08-06' })).toMatchObject({
      startDate: '2026-08-06',
      endDate: '2026-08-06',
    });
  });

  it('never moves the start', () => {
    // The field you were not editing does not get rewritten under you.
    const v = normalizeWhen({ ...base, startDate: '2026-08-10', endDate: '2026-01-01' });
    expect(v.startDate).toBe('2026-08-10');
  });

  it('pulls a backwards end time up, but only within one day', () => {
    expect(
      normalizeWhen({ ...base, allDay: false, startMinutes: 600, endMinutes: 540 }).endMinutes,
    ).toBe(600);
  });

  it('leaves an overnight range alone', () => {
    // Friday 22:00 → Saturday 02:00 is ordinary, so the floor cannot be "always the
    // start time".
    expect(
      normalizeWhen({
        ...base,
        allDay: false,
        endDate: '2026-08-05',
        startMinutes: 22 * 60,
        endMinutes: 2 * 60,
      }).endMinutes,
    ).toBe(120);
  });

  it('fixes the date before judging the time', () => {
    // An inverted date normalises down to one day, and that day's times then have to
    // obey the same-day rule they were exempt from a moment ago.
    expect(
      normalizeWhen({
        ...base,
        allDay: false,
        startDate: '2026-08-05',
        endDate: '2026-08-04',
        startMinutes: 22 * 60,
        endMinutes: 2 * 60,
      }),
    ).toMatchObject({ endDate: '2026-08-05', endMinutes: 22 * 60 });
  });

  it('keeps the times while all-day, so toggling back is free', () => {
    expect(normalizeWhen({ ...base, allDay: true })).toMatchObject({
      startMinutes: 540,
      endMinutes: 600,
    });
  });
});

describe('formatWhen', () => {
  it('distinguishes a span from a duration by its arrow', () => {
    expect(formatWhen(base)).toBe('2026-08-04');
    expect(formatWhen({ ...base, endDate: '2026-08-06' })).toBe('2026-08-04 → 2026-08-06');
    expect(formatWhen({ ...base, allDay: false })).toBe('2026-08-04 09:00 – 10:00');
    expect(formatWhen({ ...base, allDay: false, endDate: '2026-08-06' })).toBe(
      '2026-08-04 09:00 → 2026-08-06 10:00',
    );
  });

  it('omits the end time when hasEnd is false', () => {
    expect(formatWhen({ ...base, allDay: false }, false)).toBe('2026-08-04 09:00');
  });
});

describe('parseDateInput', () => {
  const ref = '2026-08-04';
  const at = (s: string) => parseDateInput(s, ref);

  it('takes the canonical form exactly', () => {
    expect(at('2026-08-04')).toBe('2026-08-04');
    expect(at('2027-1-9')).toBe('2027-01-09');
    expect(at('  2026-08-04  ')).toBe('2026-08-04');
  });

  it('reads month-first numerics, with the year optional', () => {
    expect(at('8/4')).toBe('2026-08-04');
    expect(at('12/25')).toBe('2026-12-25');
    expect(at('8/4/2027')).toBe('2027-08-04');
    expect(at('8-4-27')).toBe('2027-08-04');
    expect(at('8.4.2027')).toBe('2027-08-04');
  });

  it('reads a bare day as a day of the month on screen', () => {
    expect(at('12')).toBe('2026-08-12');
    expect(at('1')).toBe('2026-08-01');
    expect(parseDateInput('12', '2026-02-01')).toBe('2026-02-12');
  });

  it('reads month names from three letters up, either way round', () => {
    expect(at('aug 4')).toBe('2026-08-04');
    expect(at('August 4')).toBe('2026-08-04');
    expect(at('august 4, 2027')).toBe('2027-08-04');
    expect(at('4 aug')).toBe('2026-08-04');
    expect(at('4 september 2027')).toBe('2027-09-04');
    expect(at('dec 25')).toBe('2026-12-25');
  });

  it('rejects a day the month does not have', () => {
    // `civil` will format any three numbers; only the round-trip catches this.
    expect(at('2026-02-31')).toBeNull();
    expect(at('2/30')).toBeNull();
    expect(at('feb 31')).toBeNull();
    // A bare day is judged against the month on screen, so the same string is a date
    // in August and is not one in September.
    expect(at('31')).toBe('2026-08-31');
    expect(parseDateInput('31', '2026-09-01')).toBeNull();
  });

  it('keeps the leap day where it exists and refuses it where it does not', () => {
    expect(at('2028-02-29')).toBe('2028-02-29');
    expect(at('2027-02-29')).toBeNull();
  });

  it('rejects garbage', () => {
    for (const junk of [
      '',
      '   ',
      'abc',
      'ju 4', // two letters names no month
      'aug',
      '4',
      'aug 32',
      '13/1',
      '0/4',
      '8/0',
      '2026',
      '2026-13-01',
      '4th august',
      '8//4',
      '-8/4',
      '٢٠٢٦-٠٨-٠٤',
    ]) {
      // A bare `4` is a legal day, so it is checked separately below.
      if (junk === '4') continue;
      expect(at(junk), junk).toBeNull();
    }
    expect(at('4')).toBe('2026-08-04');
  });
});
