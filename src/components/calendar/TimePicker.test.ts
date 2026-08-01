import { describe, expect, it } from 'vitest';
import { formatMinutes, parseTimeInput } from './TimePicker';

/**
 * The parser is the whole of the typing affordance, and it is the half of the
 * component a rendering test would not reach: what matters is the set of
 * strings a keyboard can produce, not the two or three a click can.
 */

describe('parseTimeInput', () => {
  it('reads a bare hour', () => {
    expect(parseTimeInput('9')).toBe(540);
    expect(parseTimeInput('09')).toBe(540);
    expect(parseTimeInput('0')).toBe(0);
    expect(parseTimeInput('21')).toBe(1260);
    expect(parseTimeInput('23')).toBe(1380);
  });

  it('reads digits with the minutes on the end', () => {
    expect(parseTimeInput('930')).toBe(570);
    expect(parseTimeInput('0930')).toBe(570);
    expect(parseTimeInput('2130')).toBe(1290);
    expect(parseTimeInput('0000')).toBe(0);
    expect(parseTimeInput('2359')).toBe(1439);
  });

  it('reads a colon', () => {
    expect(parseTimeInput('9:30')).toBe(570);
    expect(parseTimeInput('09:30')).toBe(570);
    expect(parseTimeInput('21:30')).toBe(1290);
    expect(parseTimeInput('0:00')).toBe(0);
    expect(parseTimeInput('23:59')).toBe(1439);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseTimeInput('  9:30 ')).toBe(570);
    expect(parseTimeInput('\t930\n')).toBe(570);
  });

  it('rejects hours and minutes outside a day', () => {
    // 24:00 is a real instant and is not a time of day this app can hold —
    // `endMinutes` tops out at 23:59, so accepting it would round-trip wrong.
    expect(parseTimeInput('24')).toBeNull();
    expect(parseTimeInput('2400')).toBeNull();
    expect(parseTimeInput('99')).toBeNull();
    expect(parseTimeInput('960')).toBeNull();
    expect(parseTimeInput('9:60')).toBeNull();
    expect(parseTimeInput('25:00')).toBeNull();
  });

  it('rejects garbage', () => {
    for (const junk of [
      '',
      '   ',
      'abc',
      '9pm',
      '9:30 PM',
      'nine',
      '-1',
      '-930',
      '9.30',
      '9 30',
      '9:3',
      '9:305',
      '99999',
      '1e3',
      '0x1f',
      '+930',
      '9:30:00',
      ':30',
      '9:',
      '٩:٣٠',
      '１２:００',
      'NaN',
      'Infinity',
    ]) {
      expect(parseTimeInput(junk), junk).toBeNull();
    }
  });

  it('round-trips everything it formats', () => {
    for (let m = 0; m < 24 * 60; m++) {
      expect(parseTimeInput(formatMinutes(m))).toBe(m);
    }
  });
});

describe('formatMinutes', () => {
  it('is 24-hour and zero-padded, matching the bars in the grid', () => {
    expect(formatMinutes(0)).toBe('00:00');
    expect(formatMinutes(540)).toBe('09:00');
    expect(formatMinutes(570)).toBe('09:30');
    expect(formatMinutes(1290)).toBe('21:30');
    expect(formatMinutes(1439)).toBe('23:59');
  });
});
