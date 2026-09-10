# Entry Readability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every entry on Tempo's grid readable and identifiable at a glance (tinted category fills, a category chip, taller bars), give categories ten colours plus a custom hue, fix four grid problems, and rework the entry form (ENTRY instead of TASK/EVENT, repeat every N, custom reminders, and Google-style "which dates?" when editing a repeating entry).

**Architecture:** Colour is computed in one pure, tested module (`tint.ts`, OKLab mixing) and applied as inline styles, so what renders is what the contrast test measures. Hover and drag state for split entries lives in a tiny zustand store so both halves of an entry answer together. Every new rule (repeat interval, reminder labels, series split, one-date patch, month readout, lasso row search) is a pure function with its own test file; components only wire them up.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · Zustand 5 · dnd-kit · TanStack Virtual 3.17 · Vitest 4 (node environment).

**Spec:** [`docs/superpowers/specs/2026-09-10-entry-readability-design.md`](../specs/2026-09-10-entry-readability-design.md). Read it before Task 1 — it holds the *why* behind every number here.

---

## Before you start

- **Branch.** Work on `entry-readability`. It already holds three commits: the spec (`e02df25`, `e628f37`) and a prerequisite recurrence fix (`28bcd2f`) that Sections D and E build on. The working tree should be clean: `git status --short` prints nothing.
- **Next.js.** `AGENTS.md` warns that this Next.js has breaking changes and says to read `node_modules/next/dist/docs/` before writing Next-specific code. This plan touches no Next APIs — only client components, CSS, zustand and pure TypeScript. If a task ever pushes you into routing, config or server code, stop and read those docs first.
- **Baselines** (measured on `28bcd2f`):
  - Tests: `npx vitest run` → **10 files, 303 tests, all passing.**
  - Types: `npx tsc --noEmit -p .` → **exit 0, no output.**
  - Lint: `npx eslint src` → **5 errors, 12 warnings**, all pre-existing: `src/app/offline/page.tsx` (2 errors), `src/components/calendar/YearView.tsx` (2 errors), and `ContinuousCalendar.tsx:682` `no-explicit-any` (Task 3 removes that one). **Never add a lint error.** After Task 3 the error count should be 4.
- **The preview harness.** `.claude/launch.json` defines a dev server named `tempo` (`npm run dev`, port 3000). Open `http://localhost:3000/preview`: the real shell on fixture data. **Writes there fail and roll back by design** (fixture ids aren't UUIDs and there's no session) — to verify a save you watch the optimistic change appear, then the error banner. The store tests are what prove writes.
- **Commits.** One per task, imperative subject, body saying why. End every message with the co-author trailer your harness gives you. Stage explicit paths only — never `git add -A` or `git add .`.
- **House style.** Comments explain decisions (the *why*), in full sentences, British spelling ("colour") — match the surrounding code. No new dependencies.

## Everything that was asked for, and where it is done

| Request (from the conversation) | Task(s) |
|---|---|
| A category tag chip on each entry, so five "Final Exam" entries can be told apart | 7, 8 |
| Entries taller (double), except birthdays | 4 |
| Category colour that stands out more than a 2px side edge | 2, 7, 8 |
| Compare Notion and other calendars | Done in the design; findings in the spec |
| Solid vs tinted — settled on a 50% fill | 2 (`BAR_FILL`) |
| The month label in the top left matching where you're looking | 11 |
| Hovering an entry that wraps into the next week highlights both halves | 6, 7 |
| More category colours (ten) and custom colours | 9, 10 |
| Padding under a busy day's entries | 5 |
| Remove TASK as an option; call an event an entry | 12 |
| Custom intervals between repeats | 13 |
| Custom reminder times (e.g. an hour before) | 14 |
| Google/Notion-style logic for changing one date of a series | 15, 16, 17, 18 |
| Found along the way: lasso fails below tall rows | 3 |
| Found along the way: the form wipes a weekday set / end date on save | 13 |
| Found along the way: a reminder vanishes from the form after switching timed ↔ all-day | 14 |
| Found along the way: saving a task from the form resets `doing` to `todo` | 12 |
| Found along the way: the draft preview would sit on top of bars at the new heights | 5 |

## Files

**Created**

| File | Responsibility |
|---|---|
| `src/components/calendar/tint.ts` | Every colour a bar draws: OKLab mixing, contrast, bar colours, custom hue |
| `src/components/calendar/tint.test.ts` | Contrast floor for every preset and every custom hue; token drift |
| `src/components/calendar/CategoryChip.tsx` | The category name as a solid chip, shared by grid and day panel |
| `src/components/calendar/entry-focus.ts` | Which entry is hovered and which are being carried |
| `src/components/calendar/entry-focus.test.ts` | Hover/carry semantics |
| `src/components/calendar/readout.ts` | Which month the screen is showing |
| `src/components/calendar/readout.test.ts` | Readout cases |
| `src/components/calendar/repeat.ts` | The repeat rule the form describes, built on the stored rule |
| `src/components/calendar/repeat.test.ts` | Rule-building cases |
| `src/components/calendar/scope.ts` | What a form change means for one date; whether a split is allowed |
| `src/components/calendar/scope.test.ts` | Scope cases |
| `src/components/calendar/ScopePrompt.tsx` | The CHANGE WHICH DATES? question |
| `src/lib/tempo/split.ts` | One series cut in two at a date |
| `src/lib/tempo/split.test.ts` | Split cases, including expansion equivalence |

**Modified**

| File | What changes |
|---|---|
| `src/app/preview/harness.tsx` | Five course categories, a finals week, a repeating lecture |
| `src/lib/tempo/layout.ts` | `KIND_HEIGHT`; new `rowsInBand` |
| `src/lib/tempo/layout.test.ts` | Heights restated; `rowsInBand` tests |
| `src/components/calendar/constants.ts` | `ROW_PAD_B`, `MIN_ROW_H` comment, ten-colour palette |
| `src/components/calendar/WeekRow.tsx` | Row floor, draft placement, `categoryFor` |
| `src/components/calendar/EventBar.tsx` | Full rewrite: fill, edge, chip, layout per kind, linked hover/drag |
| `src/components/calendar/ContinuousCalendar.tsx` | `rowsInBand`, `categoryFor`, carry/drop, month readout |
| `src/app/globals.css` | Bar rules, width tiers, hover ring, hue slider |
| `src/components/calendar/DayView.tsx` | Fills, edges, chips, readable secondary text |
| `src/components/calendar/TasksPane.tsx` | Chips |
| `src/components/calendar/Settings.tsx` | Ten swatches, custom hue slider |
| `src/components/calendar/EventForm.tsx` | Types, repeat every N, custom reminders, the scope question |
| `src/components/calendar/ListView.tsx` | Type label ENTRY |
| `src/components/calendar/DayModal.tsx` | Tab label ENTRIES |
| `src/lib/tempo/reminders.ts` | Exported bounds; label and lead helpers |
| `src/lib/tempo/reminders.test.ts` | Helper tests |
| `src/lib/store/calendar-store.ts` | `wouldChange`, `editOccurrence`, `splitSeries` |
| `src/lib/store/calendar-store.test.ts` | Tests for the three |
| `docs/DESIGN.md` | §15 and §16 |

---

### Task 0: Preflight

- [ ] **Step 1: Confirm the branch and a clean tree**

Run: `git branch --show-current; git status --short; git log --oneline -3`
Expected: `entry-readability`, no status lines, and the top commit is `Add the entry readability implementation plan` (this document), with `e628f37` and `28bcd2f` just below it.

- [ ] **Step 2: Record the baselines**

Run: `npx vitest run` → `Tests  303 passed (303)`.
Run: `npx tsc --noEmit -p .` → no output, exit 0.
Run: `npx eslint src` → `✖ 17 problems (5 errors, 12 warnings)`.

If any of these differ, stop and find out why before changing anything.

---

### Task 1: Preview fixtures for the finals-week scenario

Every later visual check uses these: five entries titled "Final Exam" in five course categories, all ten palette colours on screen at once, an uncategorised entry, and a repeating lecture for Section E.

**Files:**
- Modify: `src/app/preview/harness.tsx`

- [ ] **Step 1: Import `startOfWeek`**

Replace the civil import line:

```ts
import { addDays, instantFromCivil, startOfMonth, todayIn, type CivilDate } from '@/lib/tempo/civil';
```

with:

```ts
import {
  addDays,
  instantFromCivil,
  startOfMonth,
  startOfWeek,
  todayIn,
  type CivilDate,
} from '@/lib/tempo/civil';
```

- [ ] **Step 2: Add the course categories**

Replace the whole `CATEGORIES` constant with:

```ts
const CATEGORIES: Category[] = [
  { id: 'c1', name: 'personal', color: '#7d9a6d', sortOrder: 0 },
  { id: 'c2', name: 'work', color: '#6d8bb0', sortOrder: 1 },
  { id: 'c3', name: 'school', color: '#b8705c', sortOrder: 2 },
  { id: 'c4', name: 'admin', color: '#8a9096', sortOrder: 3 },
  // Five courses and a club, so all ten presets are on screen at once. The
  // palette's close pairs can only be judged side by side.
  { id: 'c5', name: 'CS4442', color: '#8f6da8', sortOrder: 4 },
  { id: 'c6', name: 'STATS 2244', color: '#5aa39a', sortOrder: 5 },
  { id: 'c7', name: 'PHIL 2700', color: '#b06d8b', sortOrder: 6 },
  { id: 'c8', name: 'ECON 1022', color: '#947a30', sortOrder: 7 },
  { id: 'c9', name: 'MATH 2155', color: '#128e99', sortOrder: 8 },
  { id: 'c10', name: 'chess club', color: '#a8936d', sortOrder: 9 },
];
```

- [ ] **Step 3: Add the finals week**

Directly after the `timed()` function, add:

```ts
/**
 * Five entries with one title, told apart only by their categories — the case
 * the category chips exist for — plus a multi-day task, a club and an entry
 * with no category, whose plain grey bar has to stay distinct from every tint.
 */
function finalsWeek(monday: CivilDate): TempoEvent[] {
  const day = (n: number) => addDays(monday, n);
  return [
    timed('f1', 'Final Exam', day(0), 9 * 60, 12 * 60, { categoryId: 'c6' }),
    timed('f2', 'Final Exam', day(1), 14 * 60, 17 * 60, { categoryId: 'c7' }),
    timed('f3', 'Final Exam', day(2), 9 * 60, 12 * 60, { categoryId: 'c8' }),
    timed('f4', 'Final Exam', day(3), 19 * 60, 22 * 60, { categoryId: 'c5' }),
    timed('f5', 'Final Exam', day(4), 12 * 60, 15 * 60, { categoryId: 'c9' }),
    base('f6', 'Final project', {
      kind: 'assignment',
      status: 'doing',
      startDate: day(0),
      endDate: day(2),
      categoryId: 'c5',
    }),
    timed('f7', 'Chess club', day(1), 18 * 60, 19 * 60, { categoryId: 'c10' }),
    timed('f8', 'Coffee with Jo', day(4), 16 * 60, 17 * 60),
  ];
}
```

- [ ] **Step 4: Put them in the fixtures**

In `fixtures()`, after the `'x1'` (`Term starts`) entry and before the closing `];`, add:

```ts
    // A class that repeats, so the form's CHANGE WHICH DATES? question has
    // something to ask about.
    timed('l1', 'Lecture', d(0), 10 * 60, 11 * 60 + 30, {
      recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [2, 4] },
      categoryId: 'c5',
    }),

    // Finals, two weeks out, Monday to Friday.
    ...finalsWeek(addDays(startOfWeek(today), 15)),
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p .` → exit 0.
Start the preview (`tempo` in `.claude/launch.json`), open `/preview`, scroll two weeks down: five "Final Exam" bars Monday–Friday, still in the old grey style. Tuesday and Thursday show a Lecture.

- [ ] **Step 6: Commit**

```bash
git add src/app/preview/harness.tsx
git commit -m "Seed the preview with a finals week in five course categories"
```

---

### Task 2: The colour module

**Files:**
- Create: `src/components/calendar/tint.ts`
- Test: `src/components/calendar/tint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/tint.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/calendar/tint.test.ts`
Expected: FAIL — `Failed to resolve import "./tint"`.

- [ ] **Step 3: Write the module**

Create `src/components/calendar/tint.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/components/calendar/tint.test.ts`
Expected: PASS — all tests green (the palette is still eight colours; Task 9 adds two and this same test covers them).

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/tint.ts src/components/calendar/tint.test.ts
git commit -m "Add the bar colour module, held to a 4.5:1 contrast floor"
```

---

### Task 3: The lasso finds rows by searching, not guessing

**Files:**
- Modify: `src/lib/tempo/layout.ts` (append after `occurrencesInMarquee`)
- Modify: `src/lib/tempo/layout.test.ts`
- Modify: `src/components/calendar/ContinuousCalendar.tsx` (the imports, the constants block, `getWeekRange` near line 681)

- [ ] **Step 1: Write the failing test**

In `src/lib/tempo/layout.test.ts`, change the import on line 3 to:

```ts
import { KIND_HEIGHT, LANE_GAP, layoutWeek, occurrencesInMarquee, rowsInBand } from './layout';
```

and append at the end of the file:

```ts
describe('rows a band crosses', () => {
  // Forty measured rows of 400px — a busy stretch, and far more extra height
  // than the old `floor(y0 / ROW_H) - 10` starting guess could absorb.
  const rows = Array.from({ length: 40 }, (_, i) => ({ index: i, start: i * 400, end: (i + 1) * 400 }));
  const indexes = (y0: number, y1: number) => rowsInBand(rows, y0, y1).map((r) => r.index);

  it('finds a row the old starting guess would have skipped', () => {
    // The guess would start at floor(12_010 / 190) - 10 = 53, past the last row.
    expect(indexes(12_010, 12_390)).toEqual([30]);
  });

  it('returns every row a band spans', () => {
    expect(indexes(399, 1_201)).toEqual([0, 1, 2, 3]);
  });

  it('reads a band given bottom-up the same as top-down', () => {
    expect(indexes(1_201, 399)).toEqual(indexes(399, 1_201));
  });

  it('returns nothing for a band below the last row', () => {
    expect(indexes(20_000, 20_100)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/tempo/layout.test.ts`
Expected: FAIL — `rowsInBand is not a function` (or not exported).

- [ ] **Step 3: Implement `rowsInBand`**

Append to `src/lib/tempo/layout.ts`:

```ts
/** One row's extent, in the scroll container's content coordinates. */
export interface RowSpan {
  index: number;
  start: number;
  end: number;
}

/**
 * The rows a vertical band crosses, from rows sorted by `start`.
 *
 * A binary search rather than a guess. The lasso used to start scanning at
 * `floor(y0 / ROW_H) - 10`, which is only near the truth while rows are close
 * to `ROW_H` tall. Rows grow to fit their entries and the virtualiser measures
 * them, so a stretch of busy weeks above the band pushes the real index below
 * the guess — past about ten rows' worth of extra height the scan began after
 * the marquee and the lasso selected nothing.
 *
 * Takes the band either way up, like the marquee it serves.
 */
export function rowsInBand(rows: ReadonlyArray<RowSpan>, y0: number, y1: number): RowSpan[] {
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);

  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].end < top) lo = mid + 1;
    else hi = mid;
  }

  const hits: RowSpan[] = [];
  for (let i = lo; i < rows.length && rows[i].start <= bottom; i++) {
    hits.push({ index: rows[i].index, start: rows[i].start, end: rows[i].end });
  }
  return hits;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/tempo/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the grid**

In `src/components/calendar/ContinuousCalendar.tsx`, change the layout import to:

```ts
import {
  DAYS_PER_WEEK,
  layoutWeek,
  occurrencesInMarquee,
  rowsInBand,
  type MarqueeRect,
  type WeekLayout,
} from '@/lib/tempo/layout';
```

Directly after the `EMPTY_OCCURRENCES` constant, add:

```ts
/**
 * The one part of the virtualiser the lasso reads: every row's measured extent,
 * in order. `getMeasurements` is private in its type declarations and public at
 * runtime; naming the shape here keeps the read typed instead of `any`.
 */
type MeasuredRows = {
  getMeasurements: () => ReadonlyArray<{ index: number; start: number; end: number }>;
};
```

Replace the whole `getWeekRange` function (the one starting `const getWeekRange = (y0: number, y1: number) => {` and ending at its closing `};`) with:

```ts
    const getWeekRange = (y0: number, y1: number) =>
      rowsInBand((virtualizer as unknown as MeasuredRows).getMeasurements(), y0, y1);
```

- [ ] **Step 6: Verify**

Run: `npx vitest run` → all pass. (Counts grow with every task; what matters is zero failures.)
Run: `npx tsc --noEmit -p .` → exit 0.
Run: `npx eslint src` → **4 errors**, 12 warnings (the `no-explicit-any` at line 682 is gone).

- [ ] **Step 7: Commit**

```bash
git add src/lib/tempo/layout.ts src/lib/tempo/layout.test.ts src/components/calendar/ContinuousCalendar.tsx
git commit -m "Find the lasso's rows by binary search over measured heights"
```

---

### Task 4: Events and tasks double in height

**Files:**
- Modify: `src/lib/tempo/layout.ts` (the `KIND_HEIGHT` block and its comment, lines 19–42)
- Modify: `src/lib/tempo/layout.test.ts`

- [ ] **Step 1: Restate the height tests at the new figures**

In `src/lib/tempo/layout.test.ts`:

(a) In the test `'does not hide segments past the pixel budget and calculates contentHeight'`, replace the comment and the last assertion:

```ts
    // 56px events at a 4px gap: lanes start at 0, 60, 120, 180, 240, 300.
    // Bottom of the last segment is 300 + 56 = 356.
    expect(laneCount).toBe(6);
    expect(segments.filter((s) => s.hidden)).toHaveLength(0);
    expect(overflow[3]).toBe(0);
    expect(contentHeight).toBe(356);
```

(b) Replace the test `'fits four events — 0, 32, 64, 96, last bottom at 124'` with:

```ts
  it('stacks four events — 0, 60, 120, 180, last bottom at 236', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 4 }, (_, i) => kinded(`e${i}`, 'event')),
      BUDGET,
    );
    expect(laneTops.slice(0, 4)).toEqual([0, 60, 120, 180]);
    expect(180 + KIND_HEIGHT.event).toBe(236);
    expect(drawn(segments)).toBe(4);
  });
```

(c) Replace the test `'fits three tasks — 0, 46, 92, last bottom at 134'` with:

```ts
  it('stacks three tasks — 0, 88, 176, last bottom at 260', () => {
    const { segments, laneTops } = layoutWeek(
      WEEK_START,
      Array.from({ length: 3 }, (_, i) => kinded(`t${i}`, 'assignment')),
      BUDGET,
    );
    expect(laneTops.slice(0, 3)).toEqual([0, 88, 176]);
    expect(176 + KIND_HEIGHT.assignment).toBe(260);
    expect(drawn(segments)).toBe(3);
  });
```

(d) Replace the test `'draws all four events/tasks and sets contentHeight to 152'` with:

```ts
  it('draws all four events/tasks and sets contentHeight to 292', () => {
    const { segments, overflow, contentHeight } = layoutWeek(
      WEEK_START,
      [
        kinded('t0', 'assignment'),
        kinded('t1', 'assignment'),
        kinded('e0', 'event'),
        kinded('e1', 'event'),
      ],
      BUDGET,
    );
    // Four bars on one day is 56 + 56 + 84 + 84 of bar and three 4px gaps, so
    // the last lane ends at 292.
    expect(drawn(segments)).toBe(4);
    expect(segments.filter((s) => s.hidden)).toHaveLength(0);
    expect(overflow[3]).toBe(0);
    expect(contentHeight).toBe(292);
  });
```

(e) In `'sizes a lane by its tallest occupant'`, change the comment line `// taller one's height — a 20px bar must not shrink the lane under a 28px` to `// taller one's height — a 20px bar must not shrink the lane under a 56px`.

(f) Replace the lasso comment

```ts
  // Lanes of 28px events sit at 0 and 32, so in row coordinates the first two
  // bars occupy [34, 62] and [66, 94].
```

with

```ts
  // Lanes of 56px events sit at 0 and 60, so in row coordinates the first two
  // bars occupy [34, 90] and [94, 150].
```

(g) In `'includes all bars since none are rolled into a chip anymore'`, six 56px bars now reach 390px into the row, so widen the sweep: replace its call with

```ts
    const hits = occurrencesInMarquee(
      { x0: 0, y0: at(10, 0), x1: 7 * COL_W, y1: at(10, 400) },
      grid(many),
      METRICS,
      (y0, y1) => [{ index: 10, start: 10 * ROW_H, end: 10 * ROW_H + 400 }],
    );
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/tempo/layout.test.ts`
Expected: FAIL — the four restated height tests (e.g. `expected 188 to be 356`).

- [ ] **Step 3: Change the heights**

In `src/lib/tempo/layout.ts`, replace the `KIND_HEIGHT` doc comment and constant with:

```ts
/**
 * Height carries importance — and, at these sizes, room.
 *
 * A task is still the loudest thing a day can contain and has to look like it
 * across seven columns without being read; colour cannot do that job, it is
 * spoken for by category. Events and tasks doubled so a title can wrap to a
 * second line and the category chip gets a line of its own: 28px held one
 * truncated line, which is how five entries called "Final Exam" became five
 * identical grey bars.
 *
 * Birthdays and marks did not double, by request. A birthday is one line —
 * "Mom · 52" — and a mark is a tick: a moment rather than a span, with no
 * duration to draw and nothing to put on a second line. So the birthday now
 * sits below the event it used to sit above.
 */
export const KIND_HEIGHT: Record<EventKind, number> = {
  milestone: 20,
  event: 56,
  birthday: 34,
  assignment: 84,
};
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/layout.ts src/lib/tempo/layout.test.ts
git commit -m "Double event and task bar heights; birthdays and marks stay"
```

---

### Task 5: A floor under busy rows, and a draft that doesn't cover bars

**Files:**
- Modify: `src/components/calendar/constants.ts` (the `MIN_ROW_H` block, lines 28–46)
- Modify: `src/components/calendar/WeekRow.tsx`

- [ ] **Step 1: Add `ROW_PAD_B` and correct the `MIN_ROW_H` comment**

In `src/components/calendar/constants.ts`, replace the doc comment above `MIN_ROW_H` and the two exports

```ts
export const MIN_ROW_H = 190;
export const ROW_H = MIN_ROW_H;
```

with:

```ts
/**
 * The least a week row is: 190px, up from 146 when bars first grew.
 *
 * A floor, not a fixed height. Rows grow to fit their entries and the
 * virtualiser measures each one; this is what a quiet week is, what an
 * unmeasured row is assumed to be, and what `TODAY_OFFSET` is counted in —
 * every row above today is unmeasured on first paint, so that arithmetic still
 * lands exactly. Anything that has to be exact about a row that *has* been
 * drawn asks the virtualiser's measurements instead (see `rowsInBand`).
 */
export const MIN_ROW_H = 190;
export const ROW_H = MIN_ROW_H;

/**
 * Space left under the lowest bar of a row that has grown to fit.
 *
 * A row sized exactly to its content put the last entry flush on the rule
 * below it, so a busy day read as running into the next week. A quiet row is at
 * `MIN_ROW_H` already and never reaches this.
 */
export const ROW_PAD_B = 8;
```

- [ ] **Step 2: Import it in `WeekRow`**

In `src/components/calendar/WeekRow.tsx`, change the constants import to:

```ts
import {
  DAY_HEADER_H,
  GUTTER_W,
  isCoarsePointer,
  LANE_BUDGET,
  MONTHS,
  ROW_H,
  ROW_PAD_B,
  UNTITLED,
} from './constants';
```

- [ ] **Step 3: Place drafts below everything and size the row**

In `WeekRowImpl`, replace the destructuring line and the whole `drafts` block — from

```ts
  const { weekStart, weekEnd, days, segments, overflow, laneTops, laneHeights, laneCount } = layout;
```

through the `})();` that closes `drafts` — with:

```ts
  const { weekStart, weekEnd, days, segments, overflow, contentHeight } = layout;
  const containsToday = days.includes(today);

  /**
   * The footprints this row draws that no entry occupies yet.
   *
   * Clipped to the week the way a real segment is, but placed *after*
   * everything already in the row rather than through `layoutWeek` — a draft
   * that competed for lanes could push real bars around while you were still
   * deciding whether to create anything at all. It displaces nothing.
   *
   * Below `contentHeight`, not below the last lane: lanes stack per column, so
   * the last lane is not always the lowest bar, and a draft placed under it
   * could land on a taller bar in another column.
   *
   * The two kinds are placed differently since bars doubled:
   * - The form's draft (labelled) takes the room below and the row grows to
   *   hold it. Clamped to the old budget, a 56px draft sat on top of existing
   *   bars in nearly every busy week.
   * - A move preview (unlabelled) stays clamped to the row as it stands:
   *   growing rows mid-drag would shift every row below, and the drop target
   *   with them. On a full row it sits on the last line, which reads as "and
   *   more" — and is the truth.
   */
  const drafts = (() => {
    const touching = ghost.filter((g) => rangesOverlap(g.start, g.end, weekStart, weekEnd));
    if (touching.length === 0) return [];

    const height = KIND_HEIGHT.event;
    const after = contentHeight === 0 ? 0 : contentHeight + LANE_GAP;
    const laneArea = Math.max(LANE_BUDGET, contentHeight + ROW_PAD_B);

    return touching.map((g, i) => {
      const stacked = after + i * (height + LANE_GAP);
      return {
        label: g.label,
        // A draft that starts before this row is continued *into* it, and the
        // bar it stands in for would say so with a ‹. Its title belongs on the
        // row the entry begins in, not repeated on every row it crosses.
        clipped: g.start < weekStart,
        startCol: diffDays(maxDate(g.start, weekStart), weekStart),
        endCol: diffDays(minDate(g.end, weekEnd), weekStart),
        top: g.label !== undefined ? stacked : Math.min(stacked, Math.max(0, laneArea - height)),
        height,
      };
    });
  })();

  /**
   * As tall as the lowest thing in it plus a floor, and never shorter than a
   * quiet week. The floor keeps a busy day's last entry off the rule below.
   */
  const draftBottom = drafts.reduce((bottom, d) => Math.max(bottom, d.top + d.height), 0);
  const rowHeight = Math.max(ROW_H, Math.max(contentHeight, draftBottom) + DAY_HEADER_H + ROW_PAD_B);
```

The replaced range included the old `containsToday` line and the old drafts comment; the replacement restates both, so `containsToday` is declared exactly once.

- [ ] **Step 4: Use `rowHeight`**

Replace

```tsx
    <div className="flex border-b border-hair" style={{ height: Math.max(ROW_H, layout.contentHeight + DAY_HEADER_H) }}>
```

with

```tsx
    <div className="flex border-b border-hair" style={{ height: rowHeight }}>
```

- [ ] **Step 5: Top-align the written draft's label**

A 56px draft with its label centred no longer looks like the bar it stands in for. In the drafts' `className`, replace

```ts
                      ? 'ml-[4px] flex items-center overflow-hidden border-y border-r border-hair border-l-2 border-l-dim bg-raised pl-1.5 pr-1 text-[12px]'
```

with

```ts
                      ? 'ml-[4px] flex items-start overflow-hidden border-y border-r border-hair border-l-2 border-l-dim bg-raised pl-1.5 pr-1 pt-[5px] text-[12px]'
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new errors or warnings (no unused variables left in `WeekRow`).
In `/preview`: the finals week's row has ~8px under its lowest bar. Double-click a day in a busy week (opens a new entry): the draft band sits below the existing bars and the row grows; closing the form shrinks it back.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/constants.ts src/components/calendar/WeekRow.tsx
git commit -m "Leave a floor under busy rows and put the draft below them"
```

---

### Task 6: One store for hover and drag, per entry

**Files:**
- Create: `src/components/calendar/entry-focus.ts`
- Test: `src/components/calendar/entry-focus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/entry-focus.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/calendar/entry-focus.test.ts`
Expected: FAIL — `Failed to resolve import "./entry-focus"`.

- [ ] **Step 3: Write the store**

Create `src/components/calendar/entry-focus.ts`:

```ts
import { create } from 'zustand';

/**
 * Which entry the pointer is on, and which entries a drag is carrying.
 *
 * Per entry, not per bar. An entry that crosses a week boundary is drawn as two
 * `EventBar`s — it has to be, each row owns its own bars — and CSS `:hover` and
 * dnd-kit's `isDragging` both answer for one element, so the half you were not
 * pointing at sat there unlit, as if it were a different entry. Every bar reads
 * this instead, through a selector on its own key, so a change re-renders the
 * bars it concerns and nothing else.
 *
 * Its own store rather than a field on the calendar's: it changes at pointer
 * speed and nothing is ever saved from it.
 */
interface EntryFocus {
  hovered: string | null;
  carried: ReadonlySet<string>;
  hover: (key: string) => void;
  /** Clears only if `key` is still the one hovered. */
  unhover: (key: string) => void;
  carry: (keys: Iterable<string>) => void;
  drop: () => void;
}

const NONE: ReadonlySet<string> = new Set();

export const useEntryFocus = create<EntryFocus>()((set) => ({
  hovered: null,
  carried: NONE,
  // Nothing lights mid-drag: the pointer crosses other bars on its way to the
  // drop, and a ring following it would read as a second selection.
  hover: (key) => set((s) => (s.carried.size > 0 || s.hovered === key ? s : { hovered: key })),
  unhover: (key) => set((s) => (s.hovered === key ? { hovered: null } : s)),
  carry: (keys) => set({ carried: new Set(keys), hovered: null }),
  drop: () => set((s) => (s.carried.size === 0 ? s : { carried: NONE })),
}));
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/components/calendar/entry-focus.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/entry-focus.ts src/components/calendar/entry-focus.test.ts
git commit -m "Track hover and drag per entry so split bars answer together"
```

---

### Task 7: The bar — fill, edge, chip, layout, linked hover

The heart of Section A. The prop `color: string` becomes `category: Category | null` on `EventBar`, so `WeekRow` and `ContinuousCalendar` change in the same task to keep the build green.

**Files:**
- Create: `src/components/calendar/CategoryChip.tsx`
- Modify: `src/app/globals.css` (the event-bars section inside `@layer utilities`)
- Modify: `src/components/calendar/EventBar.tsx` (full replacement)
- Modify: `src/components/calendar/WeekRow.tsx`
- Modify: `src/components/calendar/ContinuousCalendar.tsx`

- [ ] **Step 1: The chip**

Create `src/components/calendar/CategoryChip.tsx`:

```tsx
import type { Category } from '@/lib/tempo/types';
import { barColors } from './tint';

/**
 * The category, by name, on the entry.
 *
 * Colour alone could not carry this: the palette repeats past ten, some of its
 * pairs are close as fills, and five entries called "Final Exam" in five course
 * categories have to be told apart without opening any of them. The chip is the
 * full category colour behind near-black text — 4.7:1 at worst, on plum — so it
 * stays a crisp label even on a bar tinted with the same colour.
 *
 * One component for the grid and the day panel, so the two cannot drift apart.
 * Its type is set in `globals.css` (`.bar-chip`), where the bar's width tiers
 * can resize it.
 */
export function CategoryChip({
  category,
  className = '',
}: {
  category: Category | null;
  className?: string;
}) {
  if (!category) return null;
  const { chip } = barColors(category.color);
  if (!chip) return null;
  return (
    <span
      className={`bar-chip ${className}`}
      style={{ background: chip.bg, color: chip.fg }}
      title={category.name}
    >
      {category.name}
    </span>
  );
}
```

- [ ] **Step 2: The bar rules in `globals.css`**

In `src/app/globals.css`, directly after

```css
  .tempo-bar {
    container-type: inline-size;
  }
```

add:

```css
  /* A title gets two lines and no more. `anywhere` so one long unbroken word
     cannot hold a narrow bar open. */
  .bar-clamp {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
    min-width: 0;
    line-height: 14px;
  }

  /* The category, by name. Its type lives here rather than in utility classes
     so the width tiers below can resize it without racing the order Tailwind
     emits its generated utilities in. */
  .bar-chip {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 5px;
    font-size: 11px;
    line-height: 15px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    vertical-align: top;
  }

  /* One entry, one hover: every bar of the hovered entry, both halves of one
     that crosses a week (see `entry-focus.ts`). A ring rather than a brighter
     fill — at 60% the secondary text would drop to 4.1:1. */
  .tempo-bar[data-lit] {
    box-shadow: inset 0 0 0 1px var(--cat);
  }
  .tempo-bar[data-lit] .bar-grip {
    opacity: 1;
  }

  /* The day panel's rows and blocks: the same ring on plain hover — nothing
     there is split. Only where hover exists, so a tap does not leave it stuck. */
  @media (hover: hover) {
    .tint-hover:hover {
      box-shadow: inset 0 0 0 1px var(--cat);
    }
  }
```

Inside the existing `@container (max-width: 90px) { … }` block, after its last rule (`.bar-glyph, .bar-due { display: none; }`), add:

```css
    /* An event gives its second title line to the chip: at this width, which
       course it is matters more than the end of its title. Tasks have the
       height to keep both. */
    .bar-event .bar-clamp {
      -webkit-line-clamp: 1;
    }
    .bar-chip {
      font-size: 10px;
    }
```

And directly after that `@container (max-width: 90px)` block closes, add:

```css
  /* Under 50px — a one-day bar on a phone — a chip cannot say anything, so the
     fill says it and the title takes its second line back. */
  @container (max-width: 50px) {
    .bar-chips {
      display: none;
    }
    .bar-event .bar-clamp {
      -webkit-line-clamp: 2;
    }
  }
```

- [ ] **Step 3: Replace `EventBar.tsx`**

Replace the entire contents of `src/components/calendar/EventBar.tsx` with:

```tsx
'use client';

import { useDraggable } from '@dnd-kit/core';
import { useRef, type CSSProperties } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import type { WeekSegment } from '@/lib/tempo/layout';
import type { Category, Occurrence } from '@/lib/tempo/types';
import { DAYS_PER_WEEK, KIND_HEIGHT } from '@/lib/tempo/layout';
import { CategoryChip } from './CategoryChip';
import { useEntryFocus } from './entry-focus';
import { barColors } from './tint';

interface Props {
  segment: WeekSegment;
  /**
   * Which week row this segment is drawn in, and therefore half of the
   * draggable's identity — see the `useDraggable` call below.
   */
  weekIndex: number;
  /**
   * What the entry is filed under. `null` keeps the plain grey bar and wears no
   * chip, so "no category" still looks different from every category.
   */
  category: Category | null;
  selected: boolean;
  onOpen: (occ: Occurrence) => void;
  onToggleSelect: (occ: Occurrence) => void;
  /**
   * Resize is reported upward rather than handled here. The gesture has to be
   * able to cross week rows, and a bar can only see its own row.
   */
  onResizeStart: (occ: Occurrence, edge: 'start' | 'end', e: React.PointerEvent) => void;
}

/** The bar's style, plus the category colour the hover ring in globals.css draws with. */
type BarStyle = CSSProperties & { '--cat': string };

const pct = (cols: number) => `${(cols / DAYS_PER_WEEK) * 100}%`;

function timeLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  // Always 24-hour and zero-padded: a bare "9" next to a title reads as part of
  // the title, and mixed widths make a column of chips look ragged.
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const STATUS_GLYPH = { todo: '[ ]', doing: '[~]', done: '[x]' } as const;

/**
 * How much of each end of a bar grabs a resize rather than a move.
 *
 * 16px, up from 8. A resize is the harder gesture to start — it is aimed at an
 * edge rather than at a shape — and 8px asked for a precision the gesture does
 * not deserve. The cost is paid by the move, which keeps everything between the
 * two: 135px of it on the narrowest column this layout produces, so the easier
 * gesture is still by far the larger target.
 *
 * On a coarse pointer `.bar-grip` narrows this to 12px and stops hiding it —
 * see the grip rules in globals.css.
 */
const HANDLE_W = 'w-4';

export function EventBar({
  segment,
  weekIndex,
  category,
  selected,
  onOpen,
  onToggleSelect,
  onResizeStart,
}: Props) {
  const { occurrence: occ, startCol, endCol, continuesBefore, continuesAfter } = segment;

  /**
   * Whether the press that is about to end began on a resize handle.
   *
   * A press and release on a handle with no movement still produces a `click`
   * on the bar, which would open the entry modal on top of the resize that was
   * just committed. The flag is cleared by the bar's own pointer-down, so it
   * can never go stale and eat a later, genuine click: the handles stop
   * propagation, so a press anywhere else on the bar always resets it first.
   */
  const fromHandle = useRef(false);
  const isOffline = useCalendar((s) => s.isOffline);

  /**
   * Hover and drag, answered per entry rather than per bar — see
   * `entry-focus.ts`. Each is a selector on this entry's key, so a hover
   * anywhere else on the grid does not re-render this bar.
   */
  const lit = useEntryFocus((s) => s.hovered === occ.key);
  const carried = useEntryFocus((s) => s.carried.has(occ.key));
  const hover = useEntryFocus((s) => s.hover);
  const unhover = useEntryFocus((s) => s.unhover);

  const { attributes, listeners, setNodeRef } = useDraggable({
    // Not `occ.key`. A bar crossing a week boundary is drawn as two segments,
    // and dnd-kit keys its node registry by id — under one id the second
    // registration clobbered the first, so both halves translated together and
    // the active rect belonged to whichever had mounted last. The two halves
    // are two draggables; the occurrence rides along in `data`, which is what
    // the drag handlers actually read.
    id: `${occ.key}#${weekIndex}`,
    data: { occurrence: occ },
    disabled: occ.readOnly || isOffline,
  });

  const colors = barColors(category?.color ?? null);
  const left = startCol;
  const span = endCol - startCol + 1;

  const time = occ.allDay ? null : timeLabel(occ.startMinutes);
  const glyph = occ.kind === 'assignment' && occ.status ? STATUS_GLYPH[occ.status] : null;
  const done = occ.status === 'done';

  const task = occ.kind === 'assignment';
  const tick = occ.kind === 'milestone';
  /** A birthday and a mark are one line and wear no chip. */
  const oneLine = tick || occ.kind === 'birthday';
  const editable = !occ.readOnly && !isOffline;

  const style: BarStyle = {
    position: 'absolute',
    left: pct(left),
    // 8px off the span against 4px of `ml`, so the bar is inset the same
    // distance from both edges of the columns it covers.
    width: `calc(${pct(span)} - 8px)`,
    // Both handed down by `layoutWeek`. Derived here, the bar would have to
    // know the height of every kind above it in the row to place itself.
    top: segment.top,
    height: segment.height,
    // Deliberately *not* translated by `transform`. A `DragOverlay` chip
    // already follows the cursor and the destination rows draw a footprint, so
    // moving the source as well was a third answer to "where is this going" —
    // and the bar is inside the scroll container, so translating it pushed the
    // container's `scrollWidth` out and the grid could be dragged sideways. The
    // source stays put and dims: every bar of every entry being carried.
    opacity: carried ? 0.25 : undefined,
    background: colors.fill,
    color: colors.ink,
    /**
     * One coloured edge, on the leading end.
     *
     * Both ends carried the colour while the bar was grey, because a single
     * coloured edge on a grey bar read as a direction rather than a boundary. A
     * filled bar has its shape already — the fill is the extent — so the second
     * edge was noise and it went. A clipped start is still left bare, so the two
     * ways a bar can begin still look different.
     */
    borderLeft: continuesBefore ? undefined : `3px solid ${colors.edge}`,
    '--cat': colors.edge,
    // Ink rather than `hairlit`, which is a hairline colour and disappears at
    // the one moment it has to be unmistakable. White is spoken for: it marks
    // today.
    outline: selected ? '1px solid var(--color-ink)' : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-lit={lit || undefined}
      className={[
        // The bars sit in a pointer-events-none overlay so empty day space falls
        // through to the cell underneath; each bar opts itself back in.
        'pointer-events-auto',
        // Its own container, so everything inside can size itself against the
        // room this bar actually has. See the `.tempo-bar` rules in globals.css.
        'tempo-bar',
        'ml-[4px] flex items-stretch gap-1 overflow-hidden pr-1',
        oneLine ? '' : 'py-[5px]',
        tick ? 'text-[11px]' : 'text-[12px]',
        continuesBefore ? 'pl-1' : 'pl-1.5',
        editable ? 'cursor-grab' : 'cursor-default',
        occ.event.source === 'google' ? 'opacity-70' : '',
        done ? 'opacity-45' : '',
      ].join(' ')}
      {...attributes}
      {...listeners}
      // After the spread, deliberately. dnd-kit stamps `tabIndex={0}` on every
      // draggable, which puts several dozen bars per screen into the tab order.
      tabIndex={-1}
      // Also after the spread: purely the flag reset. `pointerdown` precedes
      // both dnd-kit activators on either input, so the flag is always cleared
      // before the gesture that might set it.
      onPointerDown={() => {
        fromHandle.current = false;
      }}
      // A mouse only. A finger has no hover, and a tap that lit a bar would
      // leave it lit.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') hover(occ.key);
      }}
      onPointerLeave={() => unhover(occ.key)}
      onClick={(e) => {
        e.stopPropagation();
        if (fromHandle.current) {
          fromHandle.current = false;
          return;
        }
        // Cmd/Ctrl rather than Shift: Shift already means "rewrite the series"
        // at drop time, and one modifier cannot mean two things on one bar.
        if (e.metaKey || e.ctrlKey) {
          onToggleSelect(occ);
          return;
        }
        onOpen(occ);
      }}
      title={occ.title}
    >
      {continuesBefore && (
        <span className="shrink-0 self-center" style={{ color: colors.soft }}>
          ‹
        </span>
      )}
      {tick && (
        <span className="shrink-0 self-center" style={{ color: colors.soft }}>
          ◆
        </span>
      )}

      <div
        className={[
          'bar-body flex min-w-0 flex-1 flex-col',
          oneLine ? 'justify-center' : 'justify-between',
          // Events alone give up a title line to the chip in the middle width
          // tier; see `.bar-event` in globals.css.
          oneLine || task ? '' : 'bar-event',
        ].join(' ')}
      >
        {oneLine ? (
          /* `bar-tick` holds one line at every width, and gives up the clock
             under 90px: a mark is a date rather than a time. */
          <div className="bar-line bar-tick flex items-center gap-1.5">
            {time && (
              <span className="bar-time shrink-0 tabular-nums" style={{ color: colors.soft }}>
                {time}
              </span>
            )}
            <span className="bar-title truncate">{occ.title}</span>
          </div>
        ) : (
          <>
            {/* The title, with what precedes it: the time on an event, the
                status box on a task. Under 90px of content `.bar-line` turns
                the column and the time moves above the title. The title is its
                own flex column, so a second line hangs under itself rather than
                under the time. */}
            <div className="bar-line flex gap-1.5">
              {task
                ? glyph && (
                    <span className="bar-glyph shrink-0 tabular-nums" style={{ color: colors.soft }}>
                      {glyph}
                    </span>
                  )
                : time && (
                    <span className="bar-time shrink-0 tabular-nums" style={{ color: colors.soft }}>
                      {time}
                    </span>
                  )}
              <span className={`bar-title bar-clamp ${done ? 'line-through' : ''}`}>{occ.title}</span>
            </div>

            {/* Everything else sits on the bottom edge together: a task's due
                line, then the chip. */}
            <div className="flex min-w-0 flex-col gap-[3px]">
              {task && (
                <div
                  className="bar-meta truncate text-[11px] leading-tight tabular-nums"
                  style={{ color: colors.soft }}
                >
                  {time ?? (
                    <>
                      <span className="bar-due">DUE </span>
                      {occ.endDate.slice(5)}
                    </>
                  )}
                </div>
              )}
              {category && (
                <div className="bar-chips flex min-w-0">
                  <CategoryChip category={category} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {continuesAfter && (
        <span className="shrink-0 self-center" style={{ color: colors.soft }}>
          ›
        </span>
      )}

      {/* Resize handles. Hidden on a clipped edge — you can only lengthen a bar
          from an end that is actually in this row, which is also what makes the
          cross-week gesture unambiguous. Revealed by the entry's hover
          (`[data-lit]` in globals.css) rather than this bar's own, so hovering
          either half of a split entry shows both of its ends.

          `bar-grip` is what makes them exist on a touch screen; see the grip
          rules in globals.css. `stopPropagation` is said on the mouse and touch
          events as well as the pointer one, because those bubble on their own
          and would start a move at the same time as the resize. */}
      {editable && !continuesBefore && (
        <span
          onPointerDown={(e) => {
            fromHandle.current = true;
            onResizeStart(occ, 'start', e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`bar-grip absolute left-0 top-0 h-full ${HANDLE_W} cursor-ew-resize opacity-0 transition-opacity`}
          style={{ background: `linear-gradient(90deg, ${colors.edge}, transparent)` }}
        />
      )}
      {editable && !continuesAfter && (
        <span
          onPointerDown={(e) => {
            fromHandle.current = true;
            onResizeStart(occ, 'end', e);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={`bar-grip absolute right-0 top-0 h-full ${HANDLE_W} cursor-ew-resize opacity-0 transition-opacity`}
          style={{ background: `linear-gradient(270deg, ${colors.edge}, transparent)` }}
        />
      )}
    </div>
  );
}

/**
 * The bar that follows the cursor mid-drag: the same fill, edge, title and chip
 * as the bar it lifted, at its kind's height.
 */
export function DragGhost({ occ, category }: { occ: Occurrence; category: Category | null }) {
  const colors = barColors(category?.color ?? null);
  const oneLine = occ.kind === 'milestone' || occ.kind === 'birthday';
  return (
    <div
      style={{
        background: colors.fill,
        color: colors.ink,
        borderLeft: `3px solid ${colors.edge}`,
        height: KIND_HEIGHT[occ.kind],
      }}
      className={[
        'flex flex-col overflow-hidden px-1.5 text-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.6)]',
        oneLine ? 'justify-center' : 'justify-between py-[5px]',
      ].join(' ')}
    >
      <span className={oneLine ? 'truncate' : 'bar-clamp'}>{occ.title}</span>
      {!oneLine && category && (
        <div className="flex min-w-0">
          <CategoryChip category={category} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `WeekRow` hands each bar its category**

In `src/components/calendar/WeekRow.tsx`:

(a) Change `import type { Occurrence } from '@/lib/tempo/types';` to `import type { Category, Occurrence } from '@/lib/tempo/types';`.

(b) In `interface Props`, replace `colorFor: (categoryId: string | null) => string;` with:

```ts
  /**
   * The category an entry is filed under, or `null`. Stable for as long as the
   * categories are, which is what keeps this row's `memo` honest.
   */
  categoryFor: (categoryId: string | null) => Category | null;
```

(c) In `WeekRowImpl`'s parameter list, replace `colorFor,` with `categoryFor,`.

(d) In the `<EventBar …/>` call, replace `color={colorFor(segment.occurrence.categoryId)}` with `category={categoryFor(segment.occurrence.categoryId)}`.

- [ ] **Step 5: `ContinuousCalendar` supplies categories and carries entries**

In `src/components/calendar/ContinuousCalendar.tsx`:

(a) Imports: change `import type { Occurrence, TempoEvent } from '@/lib/tempo/types';` to `import type { Category, Occurrence, TempoEvent } from '@/lib/tempo/types';`; delete `DEFAULT_CATEGORY_COLOR,` from the `./constants` import; add `import { useEntryFocus } from './entry-focus';` after the `./EventBar` import.

(b) Replace the `colorFor` callback

```ts
  const colorFor = useCallback(
    (categoryId: string | null) =>
      categories.find((c) => c.id === categoryId)?.color ?? DEFAULT_CATEGORY_COLOR,
    [categories],
  );
```

with

```ts
  const categoryFor = useCallback(
    (categoryId: string | null): Category | null =>
      categories.find((c) => c.id === categoryId) ?? null,
    [categories],
  );
```

(c) In `handleDragStart`, directly after `setDrag({ occ, grab });`, add:

```ts
    // Every bar of every entry this drag moves dims together — both halves of
    // one that crosses a week, and the whole group when a lit bar carries the
    // selection. The same predicate the drop uses, so they cannot disagree.
    useEntryFocus.getState().carry(carriesSelection(occ) ? selection : [occ.key]);
```

(d) In `handleDragEnd`, directly after `setDrag(null);`, add `useEntryFocus.getState().drop();`.

(e) In `onDragCancel`, change

```tsx
        onDragCancel={() => {
          setDrag(null);
          setDropDate(null);
        }}
```

to

```tsx
        onDragCancel={() => {
          setDrag(null);
          setDropDate(null);
          useEntryFocus.getState().drop();
        }}
```

(f) In the `<WeekRow …/>` call, replace `colorFor={colorFor}` with `categoryFor={categoryFor}`.

(g) Replace `{drag && <DragGhost occ={drag.occ} color={colorFor(drag.occ.categoryId)} />}` with `{drag && <DragGhost occ={drag.occ} category={categoryFor(drag.occ.categoryId)} />}`.

- [ ] **Step 6: Verify the build**

Run: `npx tsc --noEmit -p .` → exit 0.
Run: `npx vitest run` → all pass.
Run: `npx eslint src` → 4 errors (the pre-existing ones), no new warnings.

- [ ] **Step 7: Verify on screen**

In `/preview`, at a wide window (~1440px) and scrolled to the finals week, check each of these:

1. Every categorised bar is filled with its colour at half strength, with a 3px full-colour left edge and no right edge.
2. The five "Final Exam" bars show `STATS 2244`, `PHIL 2700`, `ECON 1022`, `CS4442` and `MATH 2155` chips on their bottom line, and their times read `09:00`, `14:00` and so on in a lighter tone than the title.
3. "Coffee with Jo" is a plain grey bar with a graphite edge and no chip.
4. Birthdays ("Mom > 52") and marks (◆ Term starts) are one line, with no chip.
5. The "Final project" task, which runs Monday to Wednesday, reads `[~] Final project`, then `DUE MM-DD`, then its chip.
6. Hover the Montreal trip, which crosses a week: both halves get a thin ring in their colour, and both show their resize grips. Move off it and both clear.
7. Drag either half of Montreal: both halves dim to 25% while dragging.
8. Narrow the window to about 800px: one-day bars stack the time above a one-line title and keep a smaller chip.
9. Switch to the mobile preset (375px): one-day bars show a two-line title and no chip, and the fill still shows the colour.

Take a screenshot at 1440px for the record.

- [ ] **Step 8: Commit**

```bash
git add src/components/calendar/CategoryChip.tsx src/app/globals.css src/components/calendar/EventBar.tsx src/components/calendar/WeekRow.tsx src/components/calendar/ContinuousCalendar.tsx
git commit -m "Fill bars with their category colour and name the category on a chip"
```

---

### Task 8: The day panel wears the same colours and chips

**Files:**
- Modify: `src/components/calendar/DayView.tsx`
- Modify: `src/components/calendar/TasksPane.tsx`

- [ ] **Step 1: `DayView` imports**

(a) Change `import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';` to `import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';`.
(b) Change `import type { Occurrence } from '@/lib/tempo/types';` to `import type { Category, Occurrence } from '@/lib/tempo/types';`.
(c) Change `import { DEFAULT_CATEGORY_COLOR, MONTHS } from './constants';` to `import { MONTHS } from './constants';` and add, below it:

```ts
import { CategoryChip } from './CategoryChip';
import { barColors } from './tint';
```

- [ ] **Step 2: `categoryFor` instead of `colorFor`**

Replace

```ts
  const colorFor = (id: string | null) =>
    categories.find((c) => c.id === id)?.color ?? DEFAULT_CATEGORY_COLOR;
```

with

```ts
  const categoryFor = (id: string | null): Category | null =>
    categories.find((c) => c.id === id) ?? null;
```

- [ ] **Step 3: The all-day rows**

Replace the `{bars.map((occ) => ( <button …> … </button> ))}` block inside the ALL DAY strip with:

```tsx
          {bars.map((occ) => {
            const category = categoryFor(occ.categoryId);
            const colors = barColors(category?.color ?? null);
            return (
              <button
                key={occ.key}
                onClick={() => onOpen(occ)}
                style={
                  {
                    background: colors.fill,
                    color: colors.ink,
                    borderLeft: `3px solid ${colors.edge}`,
                    '--cat': colors.edge,
                  } as CSSProperties
                }
                className="tint-hover flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate">{occ.title}</span>
                <CategoryChip category={category} className="max-w-[45%] shrink-0" />
              </button>
            );
          })}
```

- [ ] **Step 4: The timed blocks**

Inside `placed.map(…)`:

(a) Replace `const color = colorFor(occ.categoryId);` with:

```ts
              const category = categoryFor(occ.categoryId);
              const colors = barColors(category?.color ?? null);
              const color = colors.edge;
```

(b) In the block's `style`, replace `borderLeft: \`2px solid ${color}\`,` with the four lines below, and add ` as CSSProperties` after the style object's closing brace (the `'--cat'` key is not in React's CSS type):

```ts
                    background: colors.fill,
                    color: colors.ink,
                    borderLeft: `3px solid ${color}`,
                    '--cat': color,
```

(c) In its `className` array, replace `'group overflow-hidden border-r border-hair bg-raised px-1.5 py-1',` with `'group tint-hover overflow-hidden border-hair px-1.5 py-1',` and replace `'text-[11px] text-ink transition-colors hover:border-hairlit hover:bg-sunken',` with `'text-[11px]',`. Keep the `border-t` / `border-b` lines: a cut edge still gets no rule, so a block that ends at midnight still looks different from one that is clipped there.

(d) The `.label` greys drop to about 3:1 on a fill, so every label inside a block takes the soft colour instead, and loses its `opacity-70`:

- `<div className="label leading-none opacity-70">↑ FROM …` → `<div className="label leading-none" style={{ color: colors.soft }}>↑ FROM …`
- `<div className="label mt-0.5">{clockLabel(top)}</div>` → `<div className="label mt-0.5" style={{ color: colors.soft }}>{clockLabel(top)}</div>`
- `<span className="label shrink-0 opacity-70">{clockLabel(top)}</span>` → `<span className="label shrink-0" style={{ color: colors.soft }}>{clockLabel(top)}</span>`
- `<div className="label absolute inset-x-1.5 bottom-0.5 leading-none opacity-70">` → `<div className="label absolute inset-x-1.5 bottom-0.5 leading-none" style={{ color: colors.soft }}>`

(e) In the `height >= 40` branch, directly after the time label, add the chip:

```tsx
                      {height >= 58 && category && (
                        <div className="mt-1 flex min-w-0">
                          <CategoryChip category={category} />
                        </div>
                      )}
```

- [ ] **Step 5: `TasksPane`**

In `src/components/calendar/TasksPane.tsx`:

(a) Add `import { CategoryChip } from './CategoryChip';` below the `./constants` import.

(b) Replace

```ts
  const colorFor = (id: string | null) =>
    categories.find((c) => c.id === id)?.color ?? DEFAULT_CATEGORY_COLOR;
```

with

```ts
  const categoryFor = (id: string | null) => categories.find((c) => c.id === id) ?? null;
```

(c) In the kind-glyph span, replace `style={{ color: colorFor(occ.categoryId) }}` with `style={{ color: categoryFor(occ.categoryId)?.color ?? DEFAULT_CATEGORY_COLOR }}`.

(d) Replace the time label

```tsx
                <span className="label mt-1 block">
                  {occ.allDay
                    ? 'ALL DAY'
                    : `${clock(occ.startMinutes)}${occ.endMinutes != null ? `–${clock(occ.endMinutes)}` : ''}`}
                </span>
```

with

```tsx
                <span className="mt-1 flex min-w-0 items-center gap-2">
                  <span className="label shrink-0">
                    {occ.allDay
                      ? 'ALL DAY'
                      : `${clock(occ.startMinutes)}${occ.endMinutes != null ? `–${clock(occ.endMinutes)}` : ''}`}
                  </span>
                  <CategoryChip category={categoryFor(occ.categoryId)} className="min-w-0" />
                </span>
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new problems.
In `/preview`, double-click a finals day: the day panel's all-day rows and timed blocks are filled and edged like the grid, a tall block shows its chip, hovering a block rings it, and the list pane shows a chip beside each time.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/DayView.tsx src/components/calendar/TasksPane.tsx
git commit -m "Give the day panel the grid's fills and category chips"
```

---

### Task 9: Ten presets

**Files:**
- Modify: `src/components/calendar/constants.ts` (`CATEGORY_PALETTE` and its comment)
- Modify: `src/components/calendar/Settings.tsx` (the `Categories` comment; the swatch grid)
- Modify: `src/components/calendar/tint.test.ts`

- [ ] **Step 1: Write the failing test**

In `tint.test.ts`, inside `describe('bar colours', …)`, add:

```ts
  it('offers ten distinct presets', () => {
    expect(new Set(CATEGORY_PALETTE).size).toBe(10);
  });
```

Run: `npx vitest run src/components/calendar/tint.test.ts` → FAIL (`expected 8 to be 10`).

- [ ] **Step 2: Add ochre and petrol**

In `src/components/calendar/constants.ts`, replace the palette's doc comment and constant with:

```ts
/**
 * Category colours are the only hue in the interface, so they are muted enough
 * to sit on near-black without vibrating. They are read as a 50% fill and as a
 * solid chip (see `tint.ts`), and `tint.test.ts` holds each to 4.5:1 in both.
 *
 * Ochre and petrol were added by search rather than by eye: within the first
 * eight's band of lightness and chroma, the two hues farthest from all of them
 * as fills — each farther from its nearest neighbour than steel is from
 * graphite, the palette's closest pair. The first eight are unchanged: every
 * category stores its colour as hex, so retuning one would rewrite user rows.
 * Graphite stays last, the neutral, and is what an uncategorised edge uses.
 */
export const CATEGORY_PALETTE = [
  '#b8705c', // rust
  '#7d9a6d', // sage
  '#6d8bb0', // steel
  '#a8936d', // sand
  '#8f6da8', // plum
  '#5aa39a', // teal
  '#b06d8b', // rose
  '#947a30', // ochre
  '#128e99', // petrol
  '#8a9096', // graphite
] as const;
```

- [ ] **Step 3: Settings — the comment and a 5 × 2 grid**

In `src/components/calendar/Settings.tsx`, replace the doc comment above `function Categories()` with:

```ts
/**
 * Category CRUD.
 *
 * Ten presets and a hue slider rather than a free colour input. A category's
 * colour is read as a 50% fill behind light text and as a solid chip behind
 * near-black text, and `tint.test.ts` holds every preset and every custom hue
 * to 4.5:1 in both — an arbitrary picker would give that up. Past ten, colours
 * repeat or crowd each other, which the chip, naming the category, survives.
 */
```

In `Swatch`, change `gridTemplateColumns: 'repeat(4, 24px)'` to `gridTemplateColumns: 'repeat(5, 24px)'`.

- [ ] **Step 4: Verify**

Run: `npx vitest run` → all pass (the contrast test now runs over ten presets).
In `/preview` → SETTINGS → CATEGORIES, click a swatch: a 5 × 2 grid with ochre and petrol in the second row.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/constants.ts src/components/calendar/Settings.tsx src/components/calendar/tint.test.ts
git commit -m "Grow the category palette to ten with ochre and petrol"
```

---

### Task 10: A custom hue

**Files:**
- Modify: `src/components/calendar/Settings.tsx` (imports, `Swatch`, the new-category row)
- Modify: `src/app/globals.css`

- [ ] **Step 1: The slider's styles**

In `src/app/globals.css`, at the end of the `@layer utilities { … }` block (just before its closing `}`), add:

```css
  /* The custom-hue slider. Its painted track is a sibling underneath, so the
     input draws only its thumb: a square tick in ink. */
  .hue-range {
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    margin: 0;
    cursor: pointer;
  }
  .hue-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 6px;
    height: 16px;
    background: var(--color-ink);
    border: 1px solid var(--color-void);
  }
  .hue-range::-moz-range-thumb {
    width: 6px;
    height: 16px;
    background: var(--color-ink);
    border: 1px solid var(--color-void);
    border-radius: 0;
  }
  .hue-range::-moz-range-track {
    background: transparent;
  }
```

- [ ] **Step 2: Import the hue functions**

In `Settings.tsx`, add below `import { CATEGORY_PALETTE } from './constants';`:

```ts
import { customHue, hueOf } from './tint';
```

- [ ] **Step 3: Replace `Swatch`**

Replace the whole `function Swatch(…) { … }` with:

```tsx
/**
 * The constrained hues, painted on the slider's track so it shows what it will
 * give: thirteen stops, every 30°, back round to where it started.
 */
const HUE_TRACK = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) =>
  customHue((i * 30) % 360),
).join(', ')})`;

function Swatch({
  color,
  onPick,
  initialOpen = false,
  custom = true,
}: {
  color: string;
  onPick: (color: string) => void;
  initialOpen?: boolean;
  /**
   * Whether to offer the hue slider. Off for a category still being named: its
   * name field commits on blur, and a slider takes focus when it is dragged.
   * Once the category exists, its swatch has the slider.
   */
  custom?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  /**
   * What the slider shows before it is let go. A slider fires on every pixel
   * and every pick is a write to the category, so dragging previews here and
   * releasing commits once.
   */
  const [preview, setPreview] = useState<string | null>(null);
  const [hue, setHue] = useState(() => Math.round(hueOf(color)));
  const shown = preview ?? color;

  function commitPreview() {
    if (preview && preview !== color) onPick(preview);
    setPreview(null);
  }

  function toggle() {
    if (open) commitPreview();
    // Reopening a custom colour puts the slider back at its hue.
    else setHue(Math.round(hueOf(color)));
    setOpen(!open);
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-label="Change colour"
        aria-expanded={open}
        // The square is the value and stays 18px; the padding around it is
        // the target.
        className="-m-2 flex items-center justify-center p-2"
      >
        <span
          className="block h-[18px] w-[18px] border border-hair transition-colors hover:border-hairlit"
          style={{ background: shown }}
        />
      </button>
      {open && (
        <>
          {/* Catches the dismissing click. A window listener would race the
              button's own onClick and reopen what it just closed. */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => {
              commitPreview();
              setOpen(false);
            }}
          />
          <div className="absolute left-0 top-7 z-20 border border-hairlit bg-panel p-2 shadow-[0_8px_24px_rgba(0,0,0,0.7)]">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 24px)', gap: 6 }}>
              {CATEGORY_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    onPick(c);
                    setOpen(false);
                  }}
                  aria-label={c}
                  className={`border transition-colors ${
                    c === shown ? 'border-bright' : 'border-transparent hover:border-hairlit'
                  }`}
                  style={{ background: c, width: 24, height: 24 }}
                />
              ))}
            </div>
            {custom && (
              <div className="mt-2">
                <span className="label mb-1 block">CUSTOM</span>
                <div className="relative h-4">
                  <div
                    aria-hidden
                    className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2"
                    style={{ background: HUE_TRACK }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={hue}
                    onChange={(e) => {
                      const h = Number(e.target.value);
                      setHue(h);
                      setPreview(customHue(h));
                    }}
                    onPointerUp={commitPreview}
                    onKeyUp={commitPreview}
                    aria-label="Custom hue"
                    className="hue-range absolute inset-0 h-full w-full"
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: No slider in the new-category row**

In the `draft` row of `Categories`, change

```tsx
                <Swatch
                  color={draft.color}
                  onPick={(color) => setDraft((d) => (d ? { ...d, color } : d))}
                />
```

to

```tsx
                <Swatch
                  color={draft.color}
                  onPick={(color) => setDraft((d) => (d ? { ...d, color } : d))}
                  custom={false}
                />
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx eslint src` → no new problems.
In `/preview` → SETTINGS → CATEGORIES → click a swatch:
1. The slider's track is painted in muted hues.
2. Dragging it previews the colour in the swatch.
3. Releasing commits the colour. In the harness it rolls back afterwards, which is expected.
4. Reopening puts the thumb at the colour's hue.
5. `+ ADD`'s new row shows presets only.

- [ ] **Step 6: Commit**

```bash
git add src/components/calendar/Settings.tsx src/app/globals.css
git commit -m "Add a custom hue slider held to the palette's lightness"
```

---

### Task 11: The month label names the month on screen

**Files:**
- Create: `src/components/calendar/readout.ts`
- Test: `src/components/calendar/readout.test.ts`
- Modify: `src/components/calendar/ContinuousCalendar.tsx` (the readout block just before `return (`, ~line 942)

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/readout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { monthReadout } from './readout';

describe('the month readout', () => {
  it('names the month filling the screen, not the sliver at the top', () => {
    // The week of Sep 27 is four days of September and three of October, and
    // only a tenth of it is still on screen above three whole October weeks.
    expect(
      monthReadout([
        { weekStart: '2026-09-27', visible: 0.1 },
        { weekStart: '2026-10-04', visible: 1 },
        { weekStart: '2026-10-11', visible: 1 },
        { weekStart: '2026-10-18', visible: 1 },
      ]),
    ).toEqual({ head: { year: 2026, month: 10 }, next: null });
  });

  it('points at the next month when it starts on screen', () => {
    expect(
      monthReadout([
        { weekStart: '2026-09-06', visible: 1 },
        { weekStart: '2026-09-13', visible: 1 },
        { weekStart: '2026-09-20', visible: 1 },
        { weekStart: '2026-09-27', visible: 0.5 },
      ]),
    ).toEqual({ head: { year: 2026, month: 9 }, next: { year: 2026, month: 10 } });
  });

  it('gives a tie to the earlier month, so the label cannot flicker', () => {
    // August: 2 × 0.875 + 7 × 0.375 = 4.375. September: 5 × 0.875 = 4.375.
    expect(
      monthReadout([
        { weekStart: '2026-08-23', visible: 0.375 },
        { weekStart: '2026-08-30', visible: 0.875 },
      ]),
    ).toEqual({ head: { year: 2026, month: 8 }, next: { year: 2026, month: 9 } });
  });

  it('carries the year across December', () => {
    expect(
      monthReadout([
        { weekStart: '2026-12-13', visible: 1 },
        { weekStart: '2026-12-20', visible: 1 },
        { weekStart: '2026-12-27', visible: 0.5 },
      ]),
    ).toEqual({ head: { year: 2026, month: 12 }, next: { year: 2027, month: 1 } });
  });

  it('has nothing to say about nothing', () => {
    expect(monthReadout([])).toBeNull();
    expect(monthReadout([{ weekStart: '2026-09-06', visible: 0 }])).toBeNull();
  });
});
```

(All `weekStart`s are Sundays: 6 September 2026 is a Sunday.)

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/calendar/readout.test.ts`
Expected: FAIL — `Failed to resolve import "./readout"`.

- [ ] **Step 3: Write the function**

Create `src/components/calendar/readout.ts`:

```ts
import { addDays, parts, type CivilDate } from '@/lib/tempo/civil';

export interface Month {
  year: number;
  month: number;
}

/**
 * Which month the screen is showing, and whether the next one has begun on it.
 *
 * The readout used to name the month of the topmost row with any pixel on
 * screen, so a week that had scrolled nine-tenths out of view still decided it
 * — the label ran about a row ahead of the eye, and further once rows grew to
 * fit their entries. Now every visible day votes for its month, weighted by how
 * much of its row is on screen, and the month with the most wins. A tie goes to
 * the earlier month, so an exact half cannot make the label flicker.
 *
 * `next` is the month of the last visible day when it is later than the head:
 * the `→ OCTOBER` that says October has started further down.
 *
 * `null` when nothing is visible yet — before the first measurement.
 */
export function monthReadout(
  rows: ReadonlyArray<{ weekStart: CivilDate; visible: number }>,
): { head: Month; next: Month | null } | null {
  const weight = new Map<number, number>();
  let last = -Infinity;

  for (const { weekStart, visible } of rows) {
    if (!(visible > 0)) continue;
    for (let i = 0; i < 7; i++) {
      const { year, month } = parts(addDays(weekStart, i));
      const key = year * 12 + (month - 1);
      weight.set(key, (weight.get(key) ?? 0) + visible);
      last = Math.max(last, key);
    }
  }
  if (weight.size === 0) return null;

  let head = -1;
  for (const key of [...weight.keys()].sort((a, b) => a - b)) {
    if (head === -1 || weight.get(key)! > weight.get(head)!) head = key;
  }

  const month = (key: number): Month => ({ year: Math.floor(key / 12), month: (key % 12) + 1 });
  return { head: month(head), next: last > head ? month(last) : null };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/components/calendar/readout.test.ts` → PASS.

- [ ] **Step 5: Wire it into the grid**

In `ContinuousCalendar.tsx`, add `import { monthReadout } from './readout';` below the `./resize` import. Then replace this block (just above `return (` in `ContinuousCalendar`):

```ts
  // Which month the viewport is currently sitting in. There is no "current
  // page" here, so the readout is derived from what you can actually see.
  const topWeek = addDays(epochStart, topIndex * 7);
  const lastVisible = addDays(epochStart, bottomIndex * 7 + 6);
  const head = parts(addDays(topWeek, 3));
  const tail = parts(lastVisible);
  const spansMonths = head.month !== tail.month || head.year !== tail.year;
```

with

```ts
  /**
   * Which month the viewport is sitting in: the one filling most of it — see
   * `monthReadout`. There is no "current page" here, so it is derived from what
   * you can actually see, row by row, weighted by how much of each row is on
   * screen. Overscan rows have nothing on screen and drop out.
   */
  const readout = useMemo(() => {
    const top = scrollOffset;
    const bottom = scrollOffset + viewportH;
    return monthReadout(
      items.map((item) => ({
        weekStart: addDays(epochStart, item.index * 7),
        visible:
          item.size > 0
            ? Math.max(0, Math.min(item.end, bottom) - Math.max(item.start, top)) / item.size
            : 0,
      })),
    );
  }, [items, scrollOffset, viewportH, epochStart]);

  // Before the first measurement there is nothing to weigh, so the label falls
  // back to the row at the top edge, as it always used to.
  const topWeek = addDays(epochStart, topIndex * 7);
  const fallbackHead = parts(addDays(topWeek, 3));
  const fallbackTail = parts(addDays(epochStart, bottomIndex * 7 + 6));
  const head = readout?.head ?? fallbackHead;
  const next = readout
    ? readout.next
    : fallbackHead.month !== fallbackTail.month || fallbackHead.year !== fallbackTail.year
      ? fallbackTail
      : null;
```

and in the `<Header …/>` call replace `nextMonth={spansMonths ? MONTHS_LONG[tail.month - 1] : null}` with `nextMonth={next ? MONTHS_LONG[next.month - 1] : null}`. (`month={MONTHS_LONG[head.month - 1]}` and `year={head.year}` stay as they are.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new problems.
In `/preview`, scroll slowly across a month boundary. The label changes when the new month takes up more than half the grid, not when the old month's last row touches the top. `→ NEXT MONTH` still appears while the next month is starting at the bottom.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/readout.ts src/components/calendar/readout.test.ts src/components/calendar/ContinuousCalendar.tsx
git commit -m "Name the month that fills the screen in the header"
```

---

### Task 12: ENTRY replaces EVENT, and TASK leaves the form

**Files:**
- Modify: `src/components/calendar/EventForm.tsx` (`KINDS` ~line 80; the TYPE control ~line 431; `commit` ~line 348)
- Modify: `src/components/calendar/ListView.tsx` (`KIND_LABEL` ~line 41)
- Modify: `src/components/calendar/DayModal.tsx` (the pane switch ~line 155)

- [ ] **Step 1: The TYPE options**

In `EventForm.tsx`, replace

```ts
const KINDS = [
  { value: 'event', label: 'EVENT' },
  { value: 'assignment', label: 'TASK' },
  { value: 'birthday', label: 'BIRTHDAY' },
  { value: 'milestone', label: 'MARK' },
] as const;
```

with

```ts
/**
 * What an entry can be: an entry, a birthday, or a mark.
 *
 * ENTRY rather than EVENT — the word the rest of the app already uses (`+ NEW`,
 * `13 ENTRIES`). TASK is gone from the choices: this calendar is kept with
 * entries, and a task was an entry with a status nobody set.
 */
const KINDS = [
  { value: 'event', label: 'ENTRY' },
  { value: 'birthday', label: 'BIRTHDAY' },
  { value: 'milestone', label: 'MARK' },
] as const satisfies readonly { value: EventKind; label: string }[];

/**
 * TASK, for the one case that still needs it: an entry that already is one.
 *
 * Retired from the form, not from the data — rows written as tasks still exist
 * and still render. Opening one offers TASK beside the others, so the control
 * shows its real type and it can be turned into an ENTRY; a control with no
 * cell for the current value would show nothing selected.
 */
const KINDS_WITH_TASK = [
  KINDS[0],
  { value: 'assignment', label: 'TASK' },
  KINDS[1],
  KINDS[2],
] as const satisfies readonly { value: EventKind; label: string }[];
```

and in the `[01] TYPE` field replace `options={KINDS}` with `options={existing?.kind === 'assignment' ? KINDS_WITH_TASK : KINDS}`.

- [ ] **Step 2: Keep a task's status; clear it when it stops being one**

In `commit()`'s `shared` object, directly after `displayTemplate: effectiveTemplate,`, add:

```ts
      // A task keeps the status it has: `draftFields` fills a missing one with
      // `todo`, so leaving it out reset `doing` every time a task was saved from
      // here. Anything that is not a task has none — including a task just
      // turned into an ENTRY.
      status: kind === 'assignment' ? (existing?.status ?? null) : null,
```

- [ ] **Step 3: The labels elsewhere**

In `ListView.tsx`'s `KIND_LABEL`, change `event: 'EVENT',` to `event: 'ENTRY',`.
In `DayModal.tsx`'s pane switch, change `{ value: 'tasks', label: 'TASKS' },` to `{ value: 'tasks', label: 'ENTRIES' },`. The value stays: it names the pane, and the pane has always listed everything on the day.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new problems.
In `/preview`:
1. `+ NEW` shows TYPE as ENTRY / BIRTHDAY / MARK.
2. Opening "Final project", which is a task, shows ENTRY / TASK / BIRTHDAY / MARK with TASK selected.
3. On a narrow window, the day modal's switch reads DAY / ENTRIES.
4. The List view's type column reads ENTRY.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/EventForm.tsx src/components/calendar/ListView.tsx src/components/calendar/DayModal.tsx
git commit -m "Offer ENTRY, BIRTHDAY and MARK; keep TASK only for existing tasks"
```

---

### Task 13: Repeat every N

**Files:**
- Create: `src/components/calendar/repeat.ts`
- Test: `src/components/calendar/repeat.test.ts`
- Modify: `src/components/calendar/EventForm.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/repeat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Recurrence } from '@/lib/tempo/types';
import { clampInterval, periodWord, repeatRule } from './repeat';

describe('the rule REPEATS and EVERY describe', () => {
  const weekdays: Recurrence = {
    freq: 'WEEKLY',
    interval: 1,
    byWeekday: [1, 2, 3, 4, 5],
    until: '2026-12-18',
  };

  it('hands back the stored rule itself when nothing changed', () => {
    expect(repeatRule(weekdays, 'WEEKLY', 1)).toBe(weekdays);
    // Stored without an interval, which reads as 1.
    const bare: Recurrence = { freq: 'MONTHLY' };
    expect(repeatRule(bare, 'MONTHLY', 1)).toBe(bare);
  });

  it('changes only the interval on the same frequency', () => {
    expect(repeatRule(weekdays, 'WEEKLY', 2)).toEqual({ ...weekdays, interval: 2 });
  });

  it('keeps the end, the count and the skipped dates across a frequency change', () => {
    const rule: Recurrence = { ...weekdays, count: 20, exdates: ['2026-10-12'] };
    expect(repeatRule(rule, 'DAILY', 3)).toEqual({
      freq: 'DAILY',
      interval: 3,
      until: '2026-12-18',
      count: 20,
      exdates: ['2026-10-12'],
    });
  });

  it('drops the weekday set a new frequency cannot use', () => {
    expect(repeatRule(weekdays, 'MONTHLY', 1)).not.toHaveProperty('byWeekday');
  });

  it('builds a fresh rule for an entry that did not repeat', () => {
    expect(repeatRule(null, 'WEEKLY', 2)).toEqual({ freq: 'WEEKLY', interval: 2 });
  });

  it('says nothing for ONCE', () => {
    expect(repeatRule(weekdays, 'NONE', 1)).toBeNull();
  });

  it('keeps EVERY between 1 and 99', () => {
    expect(clampInterval(0)).toBe(1);
    expect(clampInterval(250)).toBe(99);
    expect(clampInterval(2.6)).toBe(3);
    expect(clampInterval(Number.NaN)).toBe(1);
  });

  it('pluralises the period', () => {
    expect(periodWord('WEEKLY', 1)).toBe('WEEK');
    expect(periodWord('DAILY', 3)).toBe('DAYS');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/calendar/repeat.test.ts`
Expected: FAIL — `Failed to resolve import "./repeat"`.

- [ ] **Step 3: Write the module**

Create `src/components/calendar/repeat.ts`:

```ts
import type { Frequency, Recurrence } from '@/lib/tempo/types';

/** What the REPEATS control can say: a frequency, or that there is none. */
export type RepeatFreq = Frequency | 'NONE';

export const MAX_INTERVAL = 99;

/** An EVERY value made safe to store: a whole number from 1 to 99. */
export function clampInterval(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_INTERVAL, Math.max(1, Math.round(n)));
}

/** The word after EVERY [ N ], pluralised: WEEK, WEEKS. */
export function periodWord(freq: Frequency, n: number): string {
  const word = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', YEARLY: 'YEAR' }[freq];
  return n === 1 ? word : `${word}S`;
}

/**
 * The rule REPEATS and EVERY describe, built on the one already stored.
 *
 * The form used to write a fresh rule on every save, which quietly threw away
 * everything it had no control for — a Monday-to-Friday weekday set, an end
 * date, a count, the dates a series skips — so saving a weekday standup from
 * the form turned it into a plain weekly one. The stored rule is the starting
 * point now. The same frequency keeps all of it and changes only the interval.
 * A different frequency keeps where the series ends and what it skips, and
 * drops only the parts that described the old frequency.
 *
 * An unchanged interval returns the stored rule itself, not a copy, so a form
 * opened and closed without touching REPEATS reads as unchanged — even for a
 * rule stored with no explicit interval. The CHANGE WHICH DATES? question
 * relies on that.
 */
export function repeatRule(
  prev: Recurrence | null,
  freq: RepeatFreq,
  interval: number,
): Recurrence | null {
  if (freq === 'NONE') return null;
  const every = clampInterval(interval);
  if (!prev) return { freq, interval: every };
  if (prev.freq === freq) {
    return (prev.interval ?? 1) === every ? prev : { ...prev, interval: every };
  }
  return {
    freq,
    interval: every,
    ...(prev.until ? { until: prev.until } : {}),
    ...(prev.count ? { count: prev.count } : {}),
    ...(prev.exdates?.length ? { exdates: prev.exdates } : {}),
    ...(prev.onInvalid ? { onInvalid: prev.onInvalid } : {}),
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/components/calendar/repeat.test.ts` → PASS.

- [ ] **Step 5: The form's REPEATS field**

In `EventForm.tsx`:

(a) Imports: remove `Frequency` from the `@/lib/tempo/types` import (nothing will use it), and add below the `./when` import:

```ts
import { clampInterval, MAX_INTERVAL, periodWord, repeatRule, type RepeatFreq } from './repeat';
```

(b) Delete `type RepeatKey …`, `RECURRENCE_KINDS`, the old `FREQS` with its doc comment, and `repeatKeyOf` — everything from the doc comment beginning `The repeat cells are keys rather than frequencies` down to the end of `repeatKeyOf`. Put this in their place:

```ts
/**
 * The frequency, in words.
 *
 * The cells were `1D 1W 1M 2M 1Y` because a sixth cell (every two months) broke
 * the words: six labels across one column truncated DAY and MONTH into each
 * other. The count has its own field now — EVERY [ N ] — so the cells are five
 * again, and five fit as words.
 */
const FREQS = [
  { value: 'NONE', label: 'ONCE' },
  { value: 'DAILY', label: 'DAY' },
  { value: 'WEEKLY', label: 'WEEK' },
  { value: 'MONTHLY', label: 'MONTH' },
  { value: 'YEARLY', label: 'YEAR' },
] as const satisfies readonly { value: RepeatFreq; label: string }[];

/** A small number field: EVERY's count, and a custom reminder's amount. */
const NUMBER_BOX =
  'w-14 border border-hair bg-panel px-1.5 py-2 text-center text-[12px] tabular-nums text-ink outline-none transition-colors focus:border-hairlit';
```

(c) Replace `const [freq, setFreq] = useState<RepeatKey>(repeatKeyOf(existing?.recurrence));` with:

```ts
  const [freq, setFreq] = useState<RepeatFreq>(existing?.recurrence?.freq ?? 'NONE');
  const [every, setEvery] = useState(existing?.recurrence?.interval ?? 1);
```

(d) Replace `const effectiveFreq: RepeatKey = isBirthday ? 'YEARLY' : freq;` with `const effectiveFreq: RepeatFreq = isBirthday ? 'YEARLY' : freq;`.

(e) Replace the whole `buildRecurrence` function with:

```ts
  function buildRecurrence(): Recurrence | null {
    // A leap-day birthday still happens every year, so birthdays clamp rather
    // than following RFC 5545's skip rule — and their rule is theirs, not the
    // form's to reshape.
    if (isBirthday) return { freq: 'YEARLY', interval: 1, onInvalid: 'clamp' };
    return repeatRule(existing?.recurrence ?? null, freq, every);
  }
```

(f) Replace the `[03] REPEATS` field

```tsx
        {!isBirthday && (
          <Field label="[03] REPEATS">
            <SegmentedControl value={freq} options={FREQS} onChange={setFreq} />
          </Field>
        )}
```

with

```tsx
        {!isBirthday && (
          <Field label="[03] REPEATS">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <SegmentedControl value={freq} options={FREQS} onChange={setFreq} />
              </div>
              {freq !== 'NONE' && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="label">EVERY</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_INTERVAL}
                    value={every}
                    onChange={(e) => setEvery(clampInterval(e.target.valueAsNumber))}
                    aria-label="Repeat every"
                    className={NUMBER_BOX}
                  />
                  <span className="label">{periodWord(freq, every)}</span>
                </span>
              )}
            </div>
          </Field>
        )}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new problems (in particular, no unused `Frequency`).
In `/preview`, `+ NEW` → REPEATS → WEEK: `EVERY [1] WEEK` appears; typing 2 reads `EVERY [2] WEEKS`. Open the Lecture (weekly on Tue/Thu) and look at REPEATS: `WEEK`, `EVERY [1] WEEK`.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/repeat.ts src/components/calendar/repeat.test.ts src/components/calendar/EventForm.tsx
git commit -m "Repeat every N, built on the stored rule instead of over it"
```

---

### Task 14: Custom reminders

**Files:**
- Modify: `src/lib/tempo/reminders.ts`
- Modify: `src/lib/tempo/reminders.test.ts`
- Modify: `src/components/calendar/EventForm.tsx`

- [ ] **Step 1: Write the failing test**

In `src/lib/tempo/reminders.test.ts`, add `allDayLeadMinutes`, `isSendableLead`, `leadMinutes` and `reminderLabel` to the existing import from `./reminders`, and append:

```ts
describe('custom reminders', () => {
  it('keeps a preset’s own words', () => {
    expect(reminderLabel(60, false)).toBe('1 hour before');
    expect(reminderLabel(900, true)).toBe('The day before, 09:00');
  });

  it('names a custom lead on a timed entry in its largest whole unit', () => {
    expect(reminderLabel(180, false)).toBe('3 hours before');
    expect(reminderLabel(45, false)).toBe('45 minutes before');
    expect(reminderLabel(4320, false)).toBe('3 days before');
    expect(reminderLabel(20160, false)).toBe('2 weeks before');
    expect(reminderLabel(1, false)).toBe('1 minute before');
    expect(reminderLabel(-30, false)).toBe('30 minutes after');
  });

  it('names one on an all-day entry as a day and a time', () => {
    expect(reminderLabel(-480, true)).toBe('That day, 08:00');
    expect(reminderLabel(60, true)).toBe('1 day before, 23:00');
    expect(reminderLabel(allDayLeadMinutes(3, 8 * 60), true)).toBe('3 days before, 08:00');
  });

  it('builds leads from what the custom row asks for', () => {
    expect(leadMinutes(1, 'hours')).toBe(60);
    expect(leadMinutes(2, 'weeks')).toBe(20160);
    expect(allDayLeadMinutes(0, 9 * 60)).toBe(-540);
    expect(allDayLeadMinutes(1, 9 * 60)).toBe(900);
  });

  it('only offers what the dispatcher will send', () => {
    expect(isSendableLead(40320)).toBe(true);
    expect(isSendableLead(40321)).toBe(false);
    expect(isSendableLead(-1440)).toBe(true);
    expect(isSendableLead(-1441)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/tempo/reminders.test.ts`
Expected: FAIL — `reminderLabel is not a function` (or not exported).

- [ ] **Step 3: The helpers**

In `src/lib/tempo/reminders.ts`:

(a) Change `const MAX_LEAD_MINUTES = 40320;` to `export const MAX_LEAD_MINUTES = 40320;` and `const MIN_LEAD_MINUTES = -1440;` to `export const MIN_LEAD_MINUTES = -1440;` (keep their comments). The form reads the same range the dispatcher filters by.

(b) Directly after `defaultReminders`, add:

```ts
export type LeadUnit = 'minutes' | 'hours' | 'days' | 'weeks';

const UNIT_MINUTES: Record<LeadUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
  weeks: 10080,
};

/** "3 hours before", as a lead in minutes. */
export function leadMinutes(amount: number, unit: LeadUnit): number {
  return Math.round(amount) * UNIT_MINUTES[unit];
}

/**
 * "2 days before, at 08:00", as minutes before the midnight an all-day entry
 * starts at. `daysBefore` 0 is the day itself, which comes out negative.
 */
export function allDayLeadMinutes(daysBefore: number, timeOfDay: number): number {
  return Math.round(daysBefore) * 1440 - timeOfDay;
}

/** Whether the dispatcher will actually send a reminder this far out. */
export function isSendableLead(minutes: number): boolean {
  return minutes >= MIN_LEAD_MINUTES && minutes <= MAX_LEAD_MINUTES;
}

/**
 * What a reminder's chip says.
 *
 * A preset keeps its own words. Anything else is described the way its side
 * of the all-day line thinks — a lead time on a timed entry, a day and a time
 * of day on an all-day one — so a custom reminder, or one carried across a
 * switch between the two, shows up as a chip instead of vanishing from the form
 * while still being sent.
 */
export function reminderLabel(minutes: number, allDay: boolean): string {
  const preset = (allDay ? ALL_DAY_PRESETS : TIMED_PRESETS).find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  return allDay ? allDayLabel(minutes) : timedLabel(minutes);
}

function timedLabel(minutes: number): string {
  if (minutes === 0) return 'At the time';
  const size = Math.abs(minutes);
  const unit = (['weeks', 'days', 'hours', 'minutes'] as const).find(
    (u) => size % UNIT_MINUTES[u] === 0,
  )!;
  const n = size / UNIT_MINUTES[unit];
  const word = n === 1 ? unit.slice(0, -1) : unit;
  return `${n} ${word} ${minutes > 0 ? 'before' : 'after'}`;
}

function allDayLabel(minutes: number): string {
  // Which day, counting back from the entry's own; then the time on it.
  const days = Math.ceil(minutes / 1440);
  const time = days * 1440 - minutes;
  const clock = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`;
  if (days === 0) return `That day, ${clock}`;
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'} ${days > 0 ? 'before' : 'after'}, ${clock}`;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/tempo/reminders.test.ts` → PASS.

- [ ] **Step 5: The form's REMIND ME field**

In `EventForm.tsx`:

(a) Change the reminders import to:

```ts
import {
  ALL_DAY_PRESETS,
  allDayLeadMinutes,
  defaultReminders,
  isSendableLead,
  leadMinutes,
  reminderLabel,
  TIMED_PRESETS,
  type LeadUnit,
} from '@/lib/tempo/reminders';
```

and add `import { TimePicker } from './TimePicker';` below the `./DatePicker` import.

(b) Directly after the `toggleReminder` function, add:

```ts
  /**
   * The + CUSTOM row: open or not, and what it holds. Both shapes are kept, so
   * flipping the all-day switch with the row open does not lose what was typed.
   */
  const [custom, setCustom] = useState<{
    amount: number;
    unit: LeadUnit;
    days: number;
    at: number;
  } | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  // The presets, then every chosen reminder no preset covers: a custom lead, or
  // one carried across a switch between timed and all-day. Left out, a reminder
  // that still sends would be one the form hides.
  const chips = [
    ...presets,
    ...reminders
      .filter((r) => !presets.some((p) => p.minutes === r.minutes))
      .map((r) => ({ minutes: r.minutes, label: reminderLabel(r.minutes, allDay) })),
  ];

  function addCustom() {
    if (!custom) return;
    const minutes = allDay
      ? allDayLeadMinutes(custom.days, custom.at)
      : leadMinutes(custom.amount, custom.unit);
    // Exactly the range the dispatcher sends. A reminder outside it would sit on
    // the entry and never arrive.
    if (!isSendableLead(minutes)) {
      setCustomError(allDay ? 'UP TO 28 DAYS BEFORE.' : 'UP TO 4 WEEKS BEFORE.');
      return;
    }
    setCustomError(null);
    setCustom(null);
    if (!reminders.some((r) => r.minutes === minutes)) toggleReminder(minutes);
  }
```

(c) In the `[06] REMIND ME` field, change `{presets.map(({ minutes, label }) => {` to `{chips.map(({ minutes, label }) => {`, and directly after that map's closing `})}` — still inside the `flex flex-wrap gap-1.5` div — add:

```tsx
              <button
                type="button"
                disabled={reminders.length >= 5 || custom !== null}
                onClick={() => setCustom({ amount: 1, unit: 'hours', days: 0, at: 8 * 60 })}
                className="tap border border-dashed border-hair px-2 py-1 text-[10px] tracking-[0.1em] text-mute transition-colors hover:border-hairlit hover:text-dim disabled:opacity-30"
              >
                + CUSTOM
              </button>
```

(d) Directly after that `flex flex-wrap gap-1.5` div closes, and before the `SILENT —` paragraph, add:

```tsx
            {custom && (
              <div
                className="mt-2 flex flex-wrap items-center gap-2"
                // Enter adds, rather than submitting the whole form as it would
                // from any other field.
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              >
                {allDay ? (
                  <>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={28}
                      value={custom.days}
                      onChange={(e) =>
                        setCustom({ ...custom, days: Math.max(0, Math.round(e.target.valueAsNumber || 0)) })
                      }
                      aria-label="Days before"
                      className={NUMBER_BOX}
                    />
                    <span className="label">DAYS BEFORE, AT</span>
                    <div className="w-24">
                      <TimePicker
                        label="Reminder time"
                        value={custom.at}
                        onChange={(at) => setCustom({ ...custom, at })}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={custom.amount}
                      onChange={(e) =>
                        setCustom({ ...custom, amount: Math.max(0, Math.round(e.target.valueAsNumber || 0)) })
                      }
                      aria-label="How long before"
                      className={NUMBER_BOX}
                    />
                    <select
                      value={custom.unit}
                      onChange={(e) => setCustom({ ...custom, unit: e.target.value as LeadUnit })}
                      aria-label="Unit"
                      className="border border-hair bg-panel px-2 py-2 text-[12px] text-ink outline-none focus:border-hairlit"
                    >
                      <option value="minutes">MINUTES</option>
                      <option value="hours">HOURS</option>
                      <option value="days">DAYS</option>
                      <option value="weeks">WEEKS</option>
                    </select>
                    <span className="label">BEFORE</span>
                  </>
                )}
                <Button type="button" onClick={addCustom}>
                  ADD
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setCustom(null);
                    setCustomError(null);
                  }}
                >
                  CANCEL
                </Button>
              </div>
            )}
            {customError && <p className="label label-lit mt-2">{customError}</p>}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new problems.
In `/preview`, `+ NEW`:
1. Timed entry: `+ CUSTOM` → `1 HOURS BEFORE` → ADD adds a `1 HOUR BEFORE` chip (it matches the preset, so the preset chip lights). Try 3 hours → a new `3 HOURS BEFORE` chip appears after the presets.
2. Switch the entry to all-day: the 3-hour reminder is still there, now reading `1 DAY BEFORE, 21:00`.
3. All-day `+ CUSTOM` → `0 DAYS BEFORE, AT 08:00` → ADD gives `THAT DAY, 08:00`.
4. `30` days → `UP TO 28 DAYS BEFORE.`
5. With five reminders chosen, `+ CUSTOM` is disabled.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tempo/reminders.ts src/lib/tempo/reminders.test.ts src/components/calendar/EventForm.tsx
git commit -m "Add custom reminder times, and show every chosen reminder as a chip"
```

---

### Task 15: Cutting a series in two

**Files:**
- Create: `src/lib/tempo/split.ts`
- Test: `src/lib/tempo/split.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tempo/split.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { expandEvent } from './recurrence';
import { splitRule } from './split';
import type { Recurrence, TempoEvent } from './types';

function series(id: string, start: string, recurrence: Recurrence | null): TempoEvent {
  return {
    id,
    title: 'Lecture',
    notes: null,
    kind: 'event',
    categoryId: null,
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: start,
    endDate: start,
    timezone: 'America/Toronto',
    recurrence,
    reminders: [],
    anchorDate: null,
    displayTemplate: null,
    status: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

const dates = (e: TempoEvent) => expandEvent(e, [], '2026-08-01', '2027-06-30').map((o) => o.date);

describe('cutting a series at a date', () => {
  const weekly: Recurrence = { freq: 'WEEKLY', interval: 1 };

  it('ends the earlier half the day before the cut', () => {
    expect(splitRule(weekly, '2026-09-15', 3, weekly).earlier.until).toBe('2026-09-14');
  });

  it('gives the later half the rule the edit asked for', () => {
    const { later } = splitRule(weekly, '2026-09-15', 3, { freq: 'WEEKLY', interval: 2 });
    expect(later).toMatchObject({ freq: 'WEEKLY', interval: 2 });
  });

  it('sends each skipped date with the half it falls in', () => {
    const rule: Recurrence = { ...weekly, exdates: ['2026-09-08', '2026-09-22'] };
    const { earlier, later } = splitRule(rule, '2026-09-15', 3, rule);
    expect(earlier.exdates).toEqual(['2026-09-08']);
    expect(later?.exdates).toEqual(['2026-09-22']);
  });

  it('hands the later half what is left of a count', () => {
    const rule: Recurrence = { ...weekly, count: 10 };
    const { earlier, later } = splitRule(rule, '2026-09-22', 4, rule);
    expect(earlier.count).toBeNull();
    expect(later?.count).toBe(7);
  });

  it('keeps the series end on the later half', () => {
    const rule: Recurrence = { ...weekly, until: '2026-12-01' };
    expect(splitRule(rule, '2026-09-15', 3, rule).later?.until).toBe('2026-12-01');
  });

  it('makes the later half a one-off when the edit stops the repeat', () => {
    expect(splitRule(weekly, '2026-09-15', 3, null).later).toBeNull();
  });

  it('covers exactly the dates the uncut series had', () => {
    // Tuesdays from 1 September, ten of them counting a skipped one; cut at the
    // fourth, 22 September. The skipped date counts toward the ten.
    const rule: Recurrence = { ...weekly, count: 10, exdates: ['2026-09-08'] };
    const { earlier, later } = splitRule(rule, '2026-09-22', 4, rule);
    expect([
      ...dates(series('a', '2026-09-01', earlier)),
      ...dates(series('b', '2026-09-22', later)),
    ]).toEqual(dates(series('uncut', '2026-09-01', rule)));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/tempo/split.test.ts`
Expected: FAIL — `Failed to resolve import "./split"`.

- [ ] **Step 3: Write the function**

Create `src/lib/tempo/split.ts`:

```ts
import { addDays, type CivilDate } from './civil';
import type { Recurrence } from './types';

/**
 * One series cut in two at `at`, for "this and later".
 *
 * The earlier half keeps its own rule and stops the day before `at`. The later
 * half takes the rule the edit asked for, from `at` on. Between them they must
 * say exactly what the uncut series said about every date the edit did not
 * change:
 *
 * - **Skipped dates** go with the half they fall in.
 * - **A count** is a total for the whole series, so the later half gets what is
 *   left of it. The occurrence at `at` is number `index`, so `index - 1` were
 *   spent before it — skipped dates included, which is RFC 5545's rule and
 *   `occurrenceDates`', and which `index` already reflects.
 * - **An end date** stays on the later half, where the series actually ends.
 *   The earlier half's end becomes the day before the cut, and its count is
 *   dropped because the date now says where it stops.
 *
 * `edited` is `null` when the edit turned the repeat off: the later half is a
 * one-off.
 */
export function splitRule(
  current: Recurrence,
  at: CivilDate,
  index: number,
  edited: Recurrence | null,
): { earlier: Recurrence; later: Recurrence | null } {
  const earlier: Recurrence = {
    ...current,
    until: addDays(at, -1),
    count: null,
    exdates: (current.exdates ?? []).filter((d) => d < at),
  };
  if (!edited) return { earlier, later: null };

  return {
    earlier,
    later: {
      ...edited,
      count: edited.count ? Math.max(1, edited.count - (index - 1)) : null,
      exdates: (edited.exdates ?? []).filter((d) => d >= at),
    },
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/tempo/split.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo/split.ts src/lib/tempo/split.test.ts
git commit -m "Add the rule for cutting a series in two at a date"
```

---

### Task 16: The store — `wouldChange`, `editOccurrence`, `splitSeries`

**Files:**
- Modify: `src/lib/store/calendar-store.ts`
- Modify: `src/lib/store/calendar-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/store/calendar-store.test.ts`:

```ts
// ------------------------------------------------------ one date, or this and later

describe('asking whether a save would change anything', () => {
  it('says no for the row as it stands and yes for a new title', () => {
    seed([event({})]);
    const draft = {
      title: 'Thing',
      kind: 'event' as const,
      allDay: true,
      startDate: '2026-08-10',
      endDate: '2026-08-10',
      reminders: [],
    };
    expect(useCalendar.getState().wouldChange('e1', draft)).toBe(false);
    expect(useCalendar.getState().wouldChange('e1', { ...draft, title: 'Other' })).toBe(true);
  });
});

describe('editing one date from the form', () => {
  it('writes an exception carrying only the patch', async () => {
    const e = event({ recurrence: { freq: 'WEEKLY' } });
    seed([e]);

    await useCalendar
      .getState()
      .editOccurrence(occurrenceOf(e, '2026-08-17'), { title: 'Guest lecture' });

    const [o] = useCalendar.getState().overrides;
    expect(o).toMatchObject({
      eventId: 'e1',
      occurrenceDate: '2026-08-17',
      cancelled: false,
      patch: { title: 'Guest lecture' },
    });
    expect(useCalendar.getState().events[0].title).toBe('Thing');
    expect(useCalendar.getState().undoStack[0].label).toBe('Edited Thing on 2026-08-17');
  });
});

describe('changing this date and later', () => {
  const weekly = (over: Partial<TempoEvent> = {}) =>
    event({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      recurrence: { freq: 'WEEKLY', interval: 1 },
      ...over,
    });
  // The third Monday: 3, 10, 17 August.
  const third = () => ({ ...occurrenceOf(weekly(), '2026-08-17'), index: 3 });
  const draft = {
    title: 'Thing',
    kind: 'event' as const,
    allDay: true,
    startDate: '2026-08-17',
    endDate: '2026-08-17',
    recurrence: { freq: 'WEEKLY' as const, interval: 2 },
    reminders: [],
  };
  const exception = (id: string, date: string) => ({
    id,
    eventId: 'e1',
    occurrenceDate: date,
    cancelled: false,
    patch: { title: `moved ${date}` },
  });

  it('ends the series the day before and starts a new one on the date', async () => {
    seed([weekly()]);
    await useCalendar.getState().splitSeries(third(), draft);

    const [old, fresh] = useCalendar.getState().events;
    expect(old.recurrence).toMatchObject({ freq: 'WEEKLY', interval: 1, until: '2026-08-16' });
    expect(fresh.id).not.toBe('e1');
    expect(fresh).toMatchObject({
      startDate: '2026-08-17',
      recurrence: { freq: 'WEEKLY', interval: 2 },
    });
  });

  it('moves the exceptions after the date and drops the one on it', async () => {
    seed([weekly()]);
    useCalendar.setState({
      overrides: [
        exception('o1', '2026-08-10'),
        exception('o2', '2026-08-17'),
        exception('o3', '2026-08-31'),
      ],
    });
    await useCalendar.getState().splitSeries(third(), draft);

    const fresh = useCalendar.getState().events[1];
    const byId = new Map(useCalendar.getState().overrides.map((o) => [o.id, o]));
    expect(byId.get('o1')?.eventId).toBe('e1');
    expect(byId.has('o2')).toBe(false);
    expect(byId.get('o3')?.eventId).toBe(fresh.id);
  });

  it('writes the new series first and ends the old one last', async () => {
    seed([weekly()]);
    useCalendar.setState({
      overrides: [exception('o2', '2026-08-17'), exception('o3', '2026-08-31')],
    });
    await useCalendar.getState().splitSeries(third(), draft);

    const writes = recorded
      .filter((c) => c.table !== 'event_versions')
      .map((c) => `${c.table}:${c.op}`);
    expect(writes).toEqual([
      'events:insert',
      'occurrence_overrides:update',
      'occurrence_overrides:delete',
      'events:update',
    ]);
  });

  it('puts everything back when the write fails', async () => {
    seed([weekly()]);
    useCalendar.setState({ overrides: [exception('o3', '2026-08-31')] });
    shouldFail = true;
    await useCalendar.getState().splitSeries(third(), draft);

    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().events[0].recurrence).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(useCalendar.getState().overrides[0].eventId).toBe('e1');
    expect(useCalendar.getState().error).toBe('write rejected');
  });

  it('comes back as one series with one undo', async () => {
    seed([weekly()]);
    useCalendar.setState({ overrides: [exception('o3', '2026-08-31')] });
    await useCalendar.getState().splitSeries(third(), draft);
    expect(useCalendar.getState().undoStack).toHaveLength(1);

    await useCalendar.getState().undo();

    expect(useCalendar.getState().events).toHaveLength(1);
    expect(useCalendar.getState().events[0].recurrence).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(useCalendar.getState().overrides[0].eventId).toBe('e1');
  });

  it('hands the later half what is left of a count', async () => {
    seed([weekly({ recurrence: { freq: 'WEEKLY', interval: 1, count: 10 } })]);
    await useCalendar.getState().splitSeries(third(), {
      ...draft,
      recurrence: { freq: 'WEEKLY', interval: 1, count: 10 },
    });
    expect(useCalendar.getState().events[1].recurrence?.count).toBe(8);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/lib/store/calendar-store.test.ts`
Expected: FAIL — `wouldChange is not a function` (and the same for the other two).

- [ ] **Step 3: Declare the three in `CalendarState`**

In `src/lib/store/calendar-store.ts`, add `import { splitRule } from '@/lib/tempo/split';` below the `@/lib/tempo/recurrence` import. In `interface CalendarState`, directly after `updateEventFromDraft: (id: string, draft: EventDraft) => Promise<void>;`, add:

```ts
  /**
   * Whether saving `draft` over the row would change anything — the same
   * comparison `updateEvent` uses to skip a no-op, asked before the form asks
   * which dates a change is for.
   */
  wouldChange: (id: string, draft: EventDraft) => boolean;
  /** One date of a series edited from the form: its title, dates or times, as an exception. */
  editOccurrence: (occ: Occurrence, patch: OccurrencePatch) => Promise<void>;
  /**
   * "This and later": the series ends the day before `occ` and a new one starts
   * on it, shaped by `draft`. See `splitRule`.
   */
  splitSeries: (occ: Occurrence, draft: EventDraft) => Promise<void>;
```

- [ ] **Step 4: Implement them**

Directly after the `updateEventFromDraft` implementation (the one that calls `get().updateEvent(id, draftFields(draft, get().timezone))`), add:

```ts
    wouldChange: (id, draft) => {
      const current = get().events.find((e) => e.id === id);
      return !!current && !same(current, { ...current, ...draftFields(draft, get().timezone) });
    },

    editOccurrence: async (occ, patch) => {
      if (occ.readOnly || Object.keys(patch).length === 0) return;
      captureVersion(occ.eventId, 'edit');
      await patchOccurrence(occ, patch, false, (o) => ({
        label: `Edited ${titleOf(occ.eventId)} on ${occ.date}`,
        touched: touchedOverrides([o.id]),
      }));
    },

    /**
     * One series becomes two, in one action.
     *
     * The new event is the old row's source, notify flag and zone, plus the
     * draft's fields, starting on the dates the form showed. Exceptions after
     * the cut move to it; the one *on* the cut is dropped, because the form's
     * values define that date now.
     *
     * Written in the order that fails safest. Inserting the new series first
     * and ending the old one last means a failure partway leaves a duplicate on
     * the server rather than a gap — the same seam `editSpans` documents, which
     * only a transaction (an RPC) would close. Locally, `optimistic` restores
     * the snapshot either way, and one undo entry covers both events and every
     * exception touched, so Cmd-Z brings back the single series.
     */
    splitSeries: async (occ, draft) => {
      const ownerId = get().ownerId;
      const old = get().events.find((e) => e.id === occ.eventId);
      if (!ownerId || !old?.recurrence || occ.readOnly) return;

      const at = occ.seriesDate;
      const rules = splitRule(old.recurrence, at, occ.index, draft.recurrence ?? null);
      captureVersion(old.id, 'edit');

      const id = crypto.randomUUID();
      const stamp = new Date().toISOString();
      const later: TempoEvent = {
        ...old,
        ...draftFields(draft, old.timezone),
        id,
        recurrence: rules.later,
        deletedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
      const ended: Partial<TempoEvent> = { recurrence: rules.earlier };

      const theirs = get().overrides.filter((o) => o.eventId === old.id);
      const moved = theirs.filter((o) => o.occurrenceDate > at).map((o) => o.id);
      const dropped = theirs.filter((o) => o.occurrenceDate === at).map((o) => o.id);

      await optimistic(
        () =>
          set((s) => ({
            events: [...s.events.map((e) => (e.id === old.id ? { ...e, ...ended } : e)), later],
            overrides: s.overrides
              .filter((o) => !dropped.includes(o.id))
              .map((o) => (moved.includes(o.id) ? { ...o, eventId: id } : o)),
          })),
        async () => {
          const inserted = await supabase
            .from('events')
            .insert({ id, owner_id: ownerId, title: later.title, ...eventToRow(later) });
          if (inserted.error) return { error: inserted.error };
          if (moved.length > 0) {
            const { error } = await supabase
              .from('occurrence_overrides')
              .update({ event_id: id })
              .in('id', moved);
            if (error) return { error };
          }
          if (dropped.length > 0) {
            const { error } = await supabase.from('occurrence_overrides').delete().in('id', dropped);
            if (error) return { error };
          }
          const { error } = await supabase.from('events').update(eventToRow(ended)).eq('id', old.id);
          return { error };
        },
        {
          label: `Changed ${later.title} from ${at}`,
          touched: { ...EMPTY_TOUCHED, events: [old.id, id], overrides: [...moved, ...dropped] },
        },
      );
    },
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/lib/store/calendar-store.test.ts` → PASS.
Run: `npx vitest run` → all pass. Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx eslint src` → no new problems.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store/calendar-store.ts src/lib/store/calendar-store.test.ts
git commit -m "Add one-date edits and this-and-later splits to the store"
```

---

### Task 17: What a change means for one date

**Files:**
- Create: `src/components/calendar/scope.ts`
- Test: `src/components/calendar/scope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EventDraft } from '@/lib/store/calendar-store';
import type { Occurrence, TempoEvent } from '@/lib/tempo/types';
import { canSplitAt, oneDatePatch } from './scope';

function lecture(over: Partial<TempoEvent> = {}): TempoEvent {
  return {
    id: 's',
    title: 'Lecture',
    notes: null,
    kind: 'event',
    categoryId: 'c5',
    allDay: true,
    startsAt: null,
    endsAt: null,
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    timezone: 'America/Toronto',
    recurrence: { freq: 'WEEKLY', interval: 1 },
    reminders: [{ minutes: 900 }, { minutes: 2340 }],
    anchorDate: null,
    displayTemplate: null,
    status: null,
    notify: false,
    source: 'tempo',
    googleEventId: null,
    deletedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function on(e: TempoEvent, date: string): Occurrence {
  return {
    key: `${e.id}:${date}`,
    eventId: e.id,
    event: e,
    date,
    endDate: date,
    seriesDate: date,
    index: 1,
    title: e.title,
    allDay: e.allDay,
    startMinutes: null,
    endMinutes: null,
    kind: e.kind,
    status: e.status,
    categoryId: e.categoryId,
    isOverride: false,
    readOnly: false,
  };
}

/** The form as it reads when opened on `occ` and left alone, plus `over`. */
function shown(e: TempoEvent, occ: Occurrence, over: Partial<EventDraft> = {}): EventDraft {
  return {
    title: e.title,
    kind: e.kind,
    allDay: e.allDay,
    startDate: occ.date,
    endDate: occ.endDate,
    categoryId: e.categoryId,
    recurrence: e.recurrence,
    reminders: e.reminders,
    anchorDate: e.anchorDate,
    displayTemplate: e.displayTemplate,
    notes: e.notes,
    ...over,
  };
}

describe('what a change means for one date', () => {
  const e = lecture();
  const occ = on(e, '2026-09-15');

  it('is nothing when nothing changed', () => {
    expect(oneDatePatch(e, occ, shown(e, occ))).toEqual({});
  });

  it('renames one date', () => {
    expect(oneDatePatch(e, occ, shown(e, occ, { title: 'Guest lecture' }))).toEqual({
      title: 'Guest lecture',
    });
  });

  it('moves one date', () => {
    expect(
      oneDatePatch(e, occ, shown(e, occ, { startDate: '2026-09-16', endDate: '2026-09-16' })),
    ).toEqual({ startDate: '2026-09-16', endDate: '2026-09-16' });
  });

  it('retimes one date of a timed series', () => {
    const t = lecture({ allDay: false });
    const o = { ...on(t, '2026-09-15'), startMinutes: 600, endMinutes: 690 };
    expect(oneDatePatch(t, o, shown(t, o, { startMinutes: 660, endMinutes: 750 }))).toEqual({
      startMinutes: 660,
      endMinutes: 750,
    });
  });

  it('refuses a change to the category', () => {
    expect(oneDatePatch(e, occ, shown(e, occ, { categoryId: 'c6' }))).toBeNull();
  });

  it('refuses a change to the repeat', () => {
    expect(
      oneDatePatch(e, occ, shown(e, occ, { recurrence: { freq: 'WEEKLY', interval: 2 } })),
    ).toBeNull();
  });

  it('does not take reminders listed in another order for a change', () => {
    expect(
      oneDatePatch(e, occ, shown(e, occ, { reminders: [{ minutes: 2340 }, { minutes: 900 }] })),
    ).toEqual({});
  });
});

describe('whether THIS AND LATER is offered', () => {
  it('is not, on the first date, where it would mean every date', () => {
    const e = lecture();
    expect(canSplitAt(e, on(e, '2026-09-01'))).toBe(false);
  });

  it('is, on a later date', () => {
    const e = lecture();
    expect(canSplitAt(e, on(e, '2026-09-15'))).toBe(true);
  });

  it('is not, on a title that counts its occurrences', () => {
    const e = lecture({ displayTemplate: '{title} · #{n}' });
    expect(canSplitAt(e, on(e, '2026-09-15'))).toBe(false);
  });

  it('is not, for a birthday or a one-off', () => {
    const b = lecture({ kind: 'birthday' });
    expect(canSplitAt(b, on(b, '2026-09-15'))).toBe(false);
    const once = lecture({ recurrence: null });
    expect(canSplitAt(once, on(once, '2026-09-15'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/components/calendar/scope.test.ts`
Expected: FAIL — `Failed to resolve import "./scope"`.

- [ ] **Step 3: Write the module**

Create `src/components/calendar/scope.ts`:

```ts
import type { EventDraft } from '@/lib/store/calendar-store';
import { same } from '@/lib/store/undo';
import { eventSpan } from '@/lib/tempo/recurrence';
import type { Occurrence, OccurrencePatch, TempoEvent } from '@/lib/tempo/types';

const minutesOf = (rs: { minutes: number }[] | undefined) =>
  (rs ?? []).map((r) => r.minutes).sort((a, b) => a - b);

/**
 * What the form's values mean for one date of a series — or `null` when they
 * cannot be said about one date.
 *
 * An exception can move a date, retime it and rename it; that is all an
 * `OccurrencePatch` holds. A change to anything else — the type, the category,
 * the reminders, the repeat, the derived label, the notes, the all-day switch —
 * is a change to what the series *is*, and one date cannot differ from its
 * series in those. Google allows it because every Google instance is a whole
 * event of its own; here an instance is the series seen on one day.
 *
 * `shown` is the form as it reads: the occurrence's dates, not the series'. An
 * empty patch means nothing one date could hold has changed.
 */
export function oneDatePatch(
  existing: TempoEvent,
  occ: Occurrence,
  shown: EventDraft,
): OccurrencePatch | null {
  const seriesLevel =
    shown.kind !== existing.kind ||
    (shown.categoryId ?? null) !== existing.categoryId ||
    !same(minutesOf(shown.reminders), minutesOf(existing.reminders)) ||
    !same(shown.recurrence ?? null, existing.recurrence) ||
    (shown.displayTemplate ?? null) !== existing.displayTemplate ||
    (shown.anchorDate ?? null) !== existing.anchorDate ||
    (shown.notes ?? null) !== existing.notes ||
    shown.allDay !== existing.allDay;
  if (seriesLevel) return null;

  const patch: OccurrencePatch = {};
  if (shown.title !== existing.title) patch.title = shown.title;
  if (shown.startDate !== occ.date || shown.endDate !== occ.endDate) {
    patch.startDate = shown.startDate;
    patch.endDate = shown.endDate;
  }
  if (
    !shown.allDay &&
    (shown.startMinutes !== occ.startMinutes || shown.endMinutes !== occ.endMinutes)
  ) {
    patch.startMinutes = shown.startMinutes;
    patch.endMinutes = shown.endMinutes;
  }
  return patch;
}

/** A title that counts its occurrences — which a new series would restart at 1. */
const NUMBERED = /\{n\}|ordinal\(n\)/;

/**
 * Whether THIS AND LATER is worth offering, and safe.
 *
 * Not on the first date: from there, "and later" is every date. Not on a title
 * that counts its occurrences: the later half is a new series and would number
 * itself from 1.
 */
export function canSplitAt(existing: TempoEvent, occ: Occurrence): boolean {
  if (!existing.recurrence || existing.kind === 'birthday') return false;
  if (existing.displayTemplate && NUMBERED.test(existing.displayTemplate)) return false;
  const span = eventSpan(existing);
  return !!span && occ.seriesDate > span.start;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/components/calendar/scope.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/scope.ts src/components/calendar/scope.test.ts
git commit -m "Work out what a form change means for one date of a series"
```

---

### Task 18: The form asks CHANGE WHICH DATES?

**Files:**
- Create: `src/components/calendar/ScopePrompt.tsx`
- Modify: `src/components/calendar/EventForm.tsx`

- [ ] **Step 1: The question**

Create `src/components/calendar/ScopePrompt.tsx`:

```tsx
'use client';

import type { OccurrencePatch } from '@/lib/tempo/types';
import { Button } from './ui';

/**
 * Which dates a change to a repeating entry is for — Google's three answers,
 * fitted to what Tempo stores.
 *
 * THIS DATE is offered only when the change fits in an exception (`patch` is
 * non-empty). Otherwise it stays on screen, disabled, with the reason under it:
 * a missing button reads as a bug, a disabled one with a sentence as a rule.
 * THIS AND LATER is left out where it would mean EVERY DATE or would renumber a
 * counted title (`canSplit`).
 *
 * Escape goes BACK to the form rather than closing it: the edit is not lost,
 * only the question. Stopped here, so the shell's window listener never sees it
 * — the same mechanism the date picker uses.
 */
export function ScopePrompt({
  patch,
  canSplit,
  onThisDate,
  onThisAndLater,
  onEveryDate,
  onBack,
}: {
  patch: OccurrencePatch | null;
  canSplit: boolean;
  onThisDate: (patch: OccurrencePatch) => void;
  onThisAndLater: () => void;
  onEveryDate: () => void;
  onBack: () => void;
}) {
  const oneDate = patch && Object.keys(patch).length > 0 ? patch : null;

  return (
    <div
      role="group"
      aria-label="Change which dates"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <div className="label mb-2">CHANGE WHICH DATES?</div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!oneDate} onClick={() => oneDate && onThisDate(oneDate)}>
          THIS DATE
        </Button>
        {canSplit && (
          <Button type="button" onClick={onThisAndLater}>
            THIS AND LATER
          </Button>
        )}
        <Button type="button" variant="primary" autoFocus onClick={onEveryDate}>
          EVERY DATE
        </Button>
        <Button type="button" variant="quiet" onClick={onBack}>
          BACK
        </Button>
      </div>
      {!oneDate && <p className="label mt-2">ONE DATE CAN ONLY CHANGE ITS TITLE, DATE AND TIME.</p>}
    </div>
  );
}
```

- [ ] **Step 2: Imports and store actions in the form**

In `EventForm.tsx`, add below the `./repeat` import:

```ts
import { canSplitAt, oneDatePatch } from './scope';
import { ScopePrompt } from './ScopePrompt';
```

and below `const cancelOccurrence = useCalendar((s) => s.cancelOccurrence);` add:

```ts
  const wouldChange = useCalendar((s) => s.wouldChange);
  const editOccurrence = useCalendar((s) => s.editOccurrence);
  const splitSeries = useCalendar((s) => s.splitSeries);
```

- [ ] **Step 3: Split `commit` into `draftFor` and `commit`**

Replace the whole `commit` function — from its doc comment `Save and close, whatever asked.` to its closing brace — with:

```ts
  /**
   * Whether saving has to ask which dates a change is for: an existing
   * repeating entry. Not a birthday — its one date is the anchor, and every
   * edit to it means every year.
   */
  const asksWhichDates =
    mode === 'edit' && !readOnly && !!existing?.recurrence && existing.kind !== 'birthday';
  const [asking, setAsking] = useState(false);

  /**
   * The form as a draft, with its dates read one of two ways.
   *
   * `series` is what EVERY DATE writes. The form opens on the occurrence you
   * clicked, so a date typed into it reaches the row as a shift — `ontoSeries`.
   * `shown` is the form as it reads, the occurrence's own dates: what THIS DATE
   * compares against, and where THIS AND LATER starts the new series.
   */
  function draftFor(dates: 'series' | 'shown'): EventDraft {
    // An empty title is not a reason to refuse. Clicking away from a form you
    // filled in should not silently throw it out, and a draft with nothing in
    // it at all is still a block of time you deliberately marked — it just gets
    // called something until you say otherwise. Escape is how you say no.
    const named = title.trim() || UNTITLED;

    // A birthday is one all-day date whatever the WHEN field last held, and
    // `normalizeWhen` is what decides that an end pulled back before its start
    // means a single day.
    const w = normalizeWhen({ ...when, allDay: isBirthday ? true : allDay });

    /**
     * The row's own dates, which are not the ones on screen.
     *
     * `null` for a new entry, for a birthday, whose field was already the
     * row's, and for the `shown` reading — see `ontoSeries`, which is the
     * identity when there is no series date to shift.
     */
    const span = dates === 'series' && existing && !opensOnSeries ? eventSpan(existing) : null;
    const startDate = ontoSeries(w.startDate, opened.startDate, span?.start);

    return {
      title: named,
      kind,
      allDay: w.allDay,
      startDate,
      endDate: isBirthday ? startDate : ontoSeries(w.endDate, opened.endDate, span?.end),
      startMinutes: w.allDay ? undefined : w.startMinutes,
      endMinutes: w.allDay ? undefined : w.endMinutes,
      categoryId,
      recurrence: buildRecurrence(),
      // Always sent, including when empty. Unlike `notify` this field is the
      // form's to state, so an omitted value would mean "unchanged" when the
      // user meant "I turned them all off".
      reminders,
      anchorDate: effectiveTemplate ? effectiveAnchor : null,
      displayTemplate: effectiveTemplate,
      // A task keeps the status it has: `draftFields` fills a missing one with
      // `todo`, so leaving it out reset `doing` every time a task was saved from
      // here. Anything that is not a task has none — including a task just
      // turned into an ENTRY.
      status: kind === 'assignment' ? (existing?.status ?? null) : null,
      // `notify` is deliberately absent. It is the Google mirror flag, and the
      // mirror does not exist — no route reads it. Leaving it out of the draft
      // means an edit preserves whatever a row already holds.
      notes: notes.trim() || null,
    };
  }

  /**
   * Save and close, whatever asked.
   *
   * Not a submit handler: the form submits into it, and so does clicking away
   * from the modal, which is a mousedown on a backdrop this component cannot
   * see. Both mean the same thing, so both arrive here.
   *
   * It closes *before* awaiting the write rather than after. Every store
   * mutation is optimistic — the entry is already on the grid by the time the
   * request leaves, and a rejection rolls it back and raises the error banner —
   * so holding the modal open for a round-trip buys nothing and makes clicking
   * away feel like it didn't take.
   *
   * A change to a repeating entry is the one exception: it stops and asks which
   * dates the change is for, and the answer is what saves. While the question
   * is up this does nothing, so a second click away cannot slip past it.
   */
  function commit() {
    if (asking) return;
    const draft = draftFor('series');

    if (mode === 'new') {
      onClose();
      void createEvent(draft);
      return;
    }
    if (!occurrence) {
      onClose();
      return;
    }
    // Only when something changed: opening an entry to look at it and clicking
    // away is not an edit, and must not be asked about as one.
    if (asksWhichDates && wouldChange(occurrence.eventId, draft)) {
      setAsking(true);
      return;
    }
    onClose();
    void updateEventFromDraft(occurrence.eventId, draft);
  }
```

(Task 12 added `status` to the old `shared` object; it lives in `draftFor` now, so nothing is lost.)

- [ ] **Step 4: Freeze the fields while asking**

Change `<fieldset disabled={readOnly} className=…>` to `<fieldset disabled={readOnly || asking} className=…>` (the className is unchanged).

- [ ] **Step 5: The footer shows the question instead of its buttons**

In the footer (`<div className="shrink-0 space-y-2 border-t border-hair px-4 py-3">`), replace the `<div className="flex flex-wrap gap-2"> … </div>` that holds CLOSE/CREATE/SAVE, HISTORY, SKIP THIS ONE and DELETE with:

```tsx
        {asking && occurrence && existing ? (
          <ScopePrompt
            patch={oneDatePatch(existing, occurrence, draftFor('shown'))}
            canSplit={canSplitAt(existing, occurrence)}
            onThisDate={(patch) => {
              onClose();
              void editOccurrence(occurrence, patch);
            }}
            onThisAndLater={() => {
              onClose();
              void splitSeries(occurrence, draftFor('shown'));
            }}
            onEveryDate={() => {
              onClose();
              void updateEventFromDraft(occurrence.eventId, draftFor('series'));
            }}
            onBack={() => setAsking(false)}
          />
        ) : (
          /* Wraps, because an edit on a recurring entry puts four buttons in
             here and SAVE is `flex-1` — on a phone the other three were being
             squeezed to their padding. */
          <div className="flex flex-wrap gap-2">
            {readOnly ? (
              <Button type="button" variant="quiet" onClick={onClose} className="flex-1">
                CLOSE
              </Button>
            ) : (
              <Button type="submit" variant="primary" className="flex-1">
                {mode === 'new' ? 'CREATE' : 'SAVE'}
              </Button>
            )}

            {mode === 'edit' && occurrence && (
              <>
                {onHistory && (
                  <Button type="button" variant="quiet" onClick={onHistory}>
                    HISTORY
                  </Button>
                )}
                {!readOnly && occurrence.event.recurrence && (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={async () => {
                      await cancelOccurrence(occurrence);
                      onClose();
                    }}
                  >
                    SKIP THIS ONE
                  </Button>
                )}
                {!readOnly && (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={async () => {
                      await deleteEvent(occurrence.eventId);
                      onClose();
                    }}
                  >
                    DELETE {occurrence.event.recurrence ? 'SERIES' : ''}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
```

(Delete the old `{/* Wraps, because … */}` comment above the old div — it now sits inside the `else` branch.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p .` → exit 0. Run: `npx vitest run` → all pass. Run: `npx eslint src` → no new problems.

In `/preview`, open a Lecture occurrence a week or more from its first date, then check each case:

1. **Nothing changed.** Click SAVE or click away: the form closes and nothing is asked.
2. **Title changed.** Change the title, then SAVE: CHANGE WHICH DATES? appears, THIS DATE is enabled, EVERY DATE is focused, and the fields are frozen.
3. **Escape.** Press Escape: you're back in the form with your edit intact. Click away: the question comes back.
4. **Category changed.** Change the category, then SAVE: THIS DATE is disabled, and the sentence under it explains why.
5. **Repeat changed.** Change REPEATS to EVERY 2 WEEKS, then SAVE, then THIS AND LATER. The earlier Tuesdays and Thursdays stay; from this date on, they're two weeks apart. (In the harness the write then rolls back with an error banner; that's expected.)
6. **First occurrence.** Open the Lecture's first occurrence and change something: THIS AND LATER isn't offered.
7. **Birthday.** Open "Mom" and change the title: it saves without asking.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/ScopePrompt.tsx src/components/calendar/EventForm.tsx
git commit -m "Ask which dates a change to a repeating entry is for"
```

---

### Task 19: The design record

**Files:**
- Modify: `docs/DESIGN.md` (append after §14, before the `---` that precedes `## Not built`)

- [ ] **Step 1: Add §15 and §16**

Insert, after the end of `## 14. A finger picks a day; a cursor points at one` and before the `---` line above `## Not built`:

```markdown
## 15. An entry says what it belongs to

The grid drew every entry as the same grey bar with a 2px category edge at each
end. Legible when you looked straight at one, useless when you scanned: five
entries called "Final Exam" in five course categories were five identical
rectangles, and a 2px edge is the worst case for telling colours apart — small
fields and peripheral vision are where hue discrimination fails first, and
orange and blue fail worst.

So the category moved from the edge into the bar. A bar is filled with its
category colour mixed 50% into the bar grey — chosen on a slider, between a
subtle tint and a solid fill — with a 3px leading edge in the full colour, and
it wears a chip: the category's name on the full colour, in near-black. The chip
is what tells two courses apart when their colours are close or repeat; the fill
is what lets you find every CS4442 entry in a week without reading.

The mixing happens in OKLab, in TypeScript, so the colour on screen is the
colour the test measures. `tint.test.ts` holds every piece of text on a bar —
title, secondary text, chip — to 4.5:1 on every preset and on every custom hue.
That floor is why the secondary text is ink pulled toward the fill rather than
the grid's grey (2.9:1 on a fill), why hover is a ring rather than a brighter
fill (4.1:1 at 60%), and why a custom colour is a hue at the palette's own
lightness rather than a free pick.

Events and tasks doubled, to 56 and 84px, so a title wraps to a second line and
the chip gets a line of its own. Birthdays and marks did not: one line already
says everything they have. Rows still grow to fit, now with a floor under the
last bar.

Category colour is still the only hue on screen. What changed is how much of
each bar it covers.

## 16. A change to a series says which dates it means

The form rewrote the whole series whatever you changed, so there was no way to
change one date from it, or "from here on". Saving a change to a repeating entry
now asks, the way Google does: THIS DATE, THIS AND LATER, or EVERY DATE — and
only when something actually changed.

THIS DATE is narrower than Google's, because a Tempo instance is the series seen
on one day rather than an event of its own: an exception can rename, move and
retime one date and nothing else. When a change touches anything an exception
cannot hold, THIS DATE stays on screen, disabled, with the reason under it.

THIS AND LATER cuts the series in two (`splitRule`). The earlier half ends the
day before; the later half starts on the date with the edited rule; skipped
dates go with their half; a count carries over as what is left of it. The store
writes the new series first and ends the old one last, so a failure partway
leaves a duplicate rather than a gap — the same seam group edits have, closed
only by a transaction this app does not have. Locally it is one action with one
undo. Where it would add nothing — the series' first date — or would renumber a
counted title, it is not offered.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DESIGN.md
git commit -m "Record why entries are filled and named, and how series edits are scoped"
```

---

### Task 20: Final verification

- [ ] **Step 1: The whole suite, the types, the linter**

Run: `npx vitest run` → every file passes, zero failures.
Run: `npx tsc --noEmit -p .` → exit 0.
Run: `npx eslint src` → **4 errors, 12 warnings** at most — the pre-existing ones, minus the `no-explicit-any` Task 3 removed. Anything new is yours to fix.

- [ ] **Step 2: One pass through every request, on screen**

With `/preview` open, walk the traceability table at the top of this plan. At ~1440px:

1. Finals week: five tinted "Final Exam" bars, each chip naming its course; titles wrap to a second line instead of cutting off.
2. Colours read at a glance across adjacent rows, not only at the bar edges.
3. Birthdays and marks are still one line.
4. The busy row has space under its last bar.
5. Scrolling across a month boundary: the header names the month that fills the screen.
6. Hovering and dragging Montreal, which crosses a week: both halves respond.
7. SETTINGS → CATEGORIES: ten presets plus a custom hue slider.
8. `+ NEW`: TYPE is ENTRY / BIRTHDAY / MARK; REPEATS has EVERY [ N ]; REMIND ME has `+ CUSTOM`, and an all-day entry can be reminded "THAT DAY, 08:00" or "1 DAY BEFORE, 23:00".
9. Editing a Lecture occurrence asks CHANGE WHICH DATES?.

Then repeat items 1 and 2 at ~800px and at the mobile preset (375px): at 800px the chips are smaller and titles take one line; at 375px there are no chips, titles take two lines, and the fill still shows the course. Take one screenshot per width.

- [ ] **Step 3: Check the spec one last time**

Open the spec and tick each section against the tasks: A (Tasks 2, 4, 7, 8), B (9, 10), C (3, 5, 6, 11), D (12, 13, 14), E (15–18), Records (19). Anything unticked is a gap to close before finishing.

- [ ] **Step 4: Finish the branch**

Use **superpowers:finishing-a-development-branch** to decide with the user whether to merge `entry-readability` into `main`, open a PR, or keep it. Do not push or merge without asking.

---

## Notes for whoever executes this

- **The harness rolls writes back.** In `/preview` every save shows its optimistic result, then reverts with an error banner. The store tests are what prove the writes. Verify behaviour on screen, and correctness in tests.
- **Leave the first eight palette colours alone.** Categories store their colour as hex, so changing one would silently orphan the user's rows.
- **Don't re-derive the numbers.** 50%, 85%, the 56/84 heights, lightness 0.65 and chroma 0.08 for custom hues, ochre `#947a30` and petrol `#128e99` were all measured and chosen with the user during design. The tests hold them in place; if one fails, the change is what's wrong, not the number.
- **Comments are part of the work.** This codebase records *why* next to the code. Keep the comments in the code blocks above, and update any old comment a change makes untrue.

