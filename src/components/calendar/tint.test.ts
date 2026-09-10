import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, DEFAULT_CATEGORY_COLOR } from './constants';
import {
  BAR_FILL,
  barColors,
  contrast,
  CUSTOM_C,
  CUSTOM_L,
  customHue,
  hueOf,
  INK,
  mixOklab,
  oklch,
  RAISED,
  VOID,
} from './tint';

/** WCAG AA for small text — the floor every piece of text on a bar must clear. */
const FLOOR = 4.5;

function expectReadable(color: string) {
  const bar = barColors(color);
  expect(contrast(bar.ink, bar.fill)).toBeGreaterThanOrEqual(FLOOR);
  expect(contrast(bar.soft, bar.fill)).toBeGreaterThanOrEqual(FLOOR);
  expect(contrast(bar.chip!.fg, bar.chip!.bg)).toBeGreaterThanOrEqual(FLOOR);
}

describe('bar colours', () => {
  it.each(CATEGORY_PALETTE.map((c) => [c]))('%s keeps every text on the bar at 4.5:1', (color) => {
    expectReadable(color);
  });

  it('mixes the category colour into the bar grey at BAR_FILL', () => {
    expect(barColors('#b8705c').fill).toBe(mixOklab('#b8705c', RAISED, BAR_FILL));
  });

  it('leaves an uncategorised entry on the plain bar, with no chip', () => {
    const bar = barColors(null);
    expect(bar.fill).toBe(RAISED);
    expect(bar.edge).toBe(DEFAULT_CATEGORY_COLOR);
    expect(bar.chip).toBeNull();
    expect(contrast(bar.soft, bar.fill)).toBeGreaterThanOrEqual(FLOOR);
  });

  it('hands back the same object for the same colour', () => {
    expect(barColors('#7d9a6d')).toBe(barColors('#7d9a6d'));
  });
});

describe('mixing and contrast', () => {
  it('returns the endpoints at 1 and 0', () => {
    expect(mixOklab('#b8705c', RAISED, 1)).toBe('#b8705c');
    expect(mixOklab('#b8705c', RAISED, 0)).toBe(RAISED);
  });

  it('measures black on white at 21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

describe('custom hue', () => {
  const hues = Array.from({ length: 360 }, (_, h) => h);

  it('stays inside sRGB at every hue', () => {
    // A clamped channel would drag lightness or chroma off target. Landing
    // within 8-bit rounding of both is what "in gamut" looks like from outside.
    for (const h of hues) {
      const [L, C] = oklch(customHue(h));
      expect(Math.abs(L - CUSTOM_L)).toBeLessThan(0.005);
      expect(Math.abs(C - CUSTOM_C)).toBeLessThan(0.005);
    }
  });

  it('keeps every text on the bar at 4.5:1 at every hue', () => {
    for (const h of hues) expectReadable(customHue(h));
  });

  it('reads its own hue back within a degree', () => {
    for (const h of hues) {
      const drift = Math.abs(((hueOf(customHue(h)) - h + 540) % 360) - 180);
      expect(drift).toBeLessThan(1);
    }
  });
});

describe('the tokens tint.ts restates', () => {
  const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');
  const token = (name: string) =>
    css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();

  it('still match globals.css', () => {
    expect(token('raised')).toBe(RAISED);
    expect(token('ink')).toBe(INK);
    expect(token('void')).toBe(VOID);
  });
});
