import { beforeEach, describe, expect, it } from 'vitest';
import { useEntryFocus } from './entry-focus';

const focus = () => useEntryFocus.getState();

beforeEach(() => {
  useEntryFocus.setState({ hovered: null, carried: new Set() });
});

describe('entry focus', () => {
  it('lights one entry at a time', () => {
    focus().hover('a');
    focus().hover('b');
    expect(focus().hovered).toBe('b');
  });

  it('does not let one bar’s leave clear another bar’s hover', () => {
    // Whatever order the browser fires them in, a leave that arrives after the
    // next bar's enter must not clear it.
    focus().hover('a');
    focus().hover('b');
    focus().unhover('a');
    expect(focus().hovered).toBe('b');
    focus().unhover('b');
    expect(focus().hovered).toBeNull();
  });

  it('lights nothing while entries are being carried', () => {
    focus().carry(['a', 'b']);
    focus().hover('c');
    expect(focus().hovered).toBeNull();
    expect(focus().carried.has('a')).toBe(true);

    focus().drop();
    expect(focus().carried.size).toBe(0);
    focus().hover('c');
    expect(focus().hovered).toBe('c');
  });
});
