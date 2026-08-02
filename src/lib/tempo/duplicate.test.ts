import { describe, expect, it } from 'vitest';
import { copyTitle, splitCopySuffix } from './duplicate';

describe('splitting a copy suffix', () => {
  it('leaves a plain title alone', () => {
    expect(splitCopySuffix('Standup')).toEqual({ base: 'Standup', n: 0 });
  });

  it('reads the number off a copy', () => {
    expect(splitCopySuffix('Standup (1)')).toEqual({ base: 'Standup', n: 1 });
    expect(splitCopySuffix('Standup (12)')).toEqual({ base: 'Standup', n: 12 });
  });

  it('keeps parentheses that are part of the name', () => {
    expect(splitCopySuffix('Standup (weekly)')).toEqual({ base: 'Standup (weekly)', n: 0 });
    expect(splitCopySuffix('Q3 (2026)')).toEqual({ base: 'Q3', n: 2026 });
  });

  it('only takes the last group', () => {
    expect(splitCopySuffix('Sprint (2) review (3)')).toEqual({
      base: 'Sprint (2) review',
      n: 3,
    });
  });

  it('ignores a zero or a negative, which it never writes', () => {
    expect(splitCopySuffix('Standup (0)')).toEqual({ base: 'Standup (0)', n: 0 });
    expect(splitCopySuffix('Standup (-1)')).toEqual({ base: 'Standup (-1)', n: 0 });
  });

  it('reads a bare counter as having no base', () => {
    expect(splitCopySuffix('(1)')).toEqual({ base: '', n: 1 });
  });
});

describe('naming a copy', () => {
  it('appends (1) when the name is free', () => {
    expect(copyTitle('Standup', new Set(['Standup']))).toBe('Standup (1)');
  });

  it('skips names already taken', () => {
    expect(copyTitle('Standup', new Set(['Standup', 'Standup (1)']))).toBe('Standup (2)');
    expect(
      copyTitle('Standup', new Set(['Standup', 'Standup (1)', 'Standup (2)'])),
    ).toBe('Standup (3)');
  });

  it('counts from the base, so a copy of a copy does not nest', () => {
    expect(copyTitle('Standup (1)', new Set(['Standup', 'Standup (1)']))).toBe('Standup (2)');
  });

  it('fills a hole rather than counting past it', () => {
    expect(copyTitle('Standup', new Set(['Standup', 'Standup (2)']))).toBe('Standup (1)');
  });

  it('does not care whether the original is in the set', () => {
    expect(copyTitle('Standup', new Set())).toBe('Standup (1)');
  });

  it('drops the separator when there is no base to separate', () => {
    expect(copyTitle('', new Set(['']))).toBe('(1)');
  });

  /** The one input this module generates itself, so it must not nest. */
  it('counts on from a name it produced', () => {
    expect(copyTitle('(1)', new Set(['(1)']))).toBe('(2)');
  });
});

describe('naming a batch of copies', () => {
  /** What the store does: each name it hands out joins the set for the next. */
  function nameAll(sources: string[], existing: string[]): string[] {
    const taken = new Set(existing);
    return sources.map((title) => {
      const next = copyTitle(title, taken);
      taken.add(next);
      return next;
    });
  }

  it('does not hand the same name to two copies', () => {
    expect(nameAll(['Standup', 'Standup'], ['Standup'])).toEqual([
      'Standup (1)',
      'Standup (2)',
    ]);
  });

  it('numbers copies of different entries independently', () => {
    expect(nameAll(['Standup', 'Retro'], ['Standup', 'Retro'])).toEqual([
      'Standup (1)',
      'Retro (1)',
    ]);
  });

  it('keeps counting when a copy is duplicated alongside its original', () => {
    expect(nameAll(['Standup', 'Standup (1)'], ['Standup', 'Standup (1)'])).toEqual([
      'Standup (2)',
      'Standup (3)',
    ]);
  });
});
