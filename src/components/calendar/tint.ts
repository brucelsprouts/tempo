/**
 * Every colour a bar draws, from its category's one.
 *
 * Mixed in OKLab rather than sRGB, and in TypeScript rather than with CSS
 * `color-mix()`. OKLab is the space where halfway looks like halfway; doing it
 * here means the colour on screen is the colour `tint.test.ts` measures. A CSS
 * mix would be the same maths with no way to hold it to a contrast floor.
 */

import { DEFAULT_CATEGORY_COLOR } from './constants';

/**
 * `--color-raised`, `--color-ink` and `--color-void` from `globals.css`.
 *
 * Restated because a module cannot read a CSS variable, and checked because a
 * restatement drifts: `tint.test.ts` reads the stylesheet and fails if these
 * stop matching it.
 */
export const RAISED = '#16181c';
export const INK = '#e4e6e9';
export const VOID = '#07080a';

/** The category colour's share of a bar's fill. Chosen on a slider, by eye. */
export const BAR_FILL = 0.5;

/**
 * Ink's share of the secondary text: the time, the due date, the status glyph.
 *
 * Not `--color-dim`: on a 50% fill that measures 2.9–3.6:1. Ink pulled 15%
 * toward the fill stays at 4.9:1 or better on every preset and still reads as
 * the quieter of the two.
 */
export const BAR_SOFT = 0.85;

/**
 * Where a custom colour sits: any hue, at the palette's own lightness and
 * chroma. All 360 hues are inside sRGB there and clear 4.5:1 in every role on a
 * bar, which is what makes a hue slider safe to offer and a free picker not.
 */
export const CUSTOM_L = 0.65;
export const CUSTOM_C = 0.08;

type Lab = readonly [number, number, number];

function channels(hex: string): [number, number, number] {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): Lab {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const byte = (c: number) =>
    Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${rgb.map(byte).join('')}`;
}

/** `a` and `b` mixed in OKLab, `t` being `a`'s share. */
export function mixOklab(a: string, b: string, t: number): string {
  const A = toOklab(a);
  const B = toOklab(b);
  return fromOklab([
    A[0] * t + B[0] * (1 - t),
    A[1] * t + B[1] * (1 - t),
    A[2] * t + B[2] * (1 - t),
  ]);
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Lightness, chroma and hue in degrees. */
export function oklch(hex: string): [number, number, number] {
  const [L, a, b] = toOklab(hex);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

export const hueOf = (hex: string): number => oklch(hex)[2];

/** The colour the custom-hue slider gives at `h` degrees. */
export function customHue(h: number): string {
  const r = (h * Math.PI) / 180;
  return fromOklab([CUSTOM_L, CUSTOM_C * Math.cos(r), CUSTOM_C * Math.sin(r)]);
}

export interface BarColors {
  /** The bar's background. */
  fill: string;
  /** The 3px leading edge, and the hover ring. */
  edge: string;
  /** The title. */
  ink: string;
  /** Time, due date, status glyph, continuation marks. */
  soft: string;
  /** `null` for an uncategorised entry, which wears no chip. */
  chip: { bg: string; fg: string } | null;
}

/**
 * Memoised per colour. A screen draws dozens of bars from about ten colours,
 * and `WeekRow` re-renders on every hover change of an entry in it.
 */
const cache = new Map<string, BarColors>();

export function barColors(color: string | null): BarColors {
  const key = color ?? '';
  const hit = cache.get(key);
  if (hit) return hit;

  const fill = color ? mixOklab(color, RAISED, BAR_FILL) : RAISED;
  const colors: BarColors = {
    fill,
    edge: color ?? DEFAULT_CATEGORY_COLOR,
    ink: INK,
    soft: mixOklab(INK, fill, BAR_SOFT),
    chip: color ? { bg: color, fg: VOID } : null,
  };
  cache.set(key, colors);
  return colors;
}
