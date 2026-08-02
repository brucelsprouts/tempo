/**
 * Derived display fields.
 *
 * The problem this solves: a birthday is one row, but "Mom > 52" is only true
 * for one year of it. Tools that treat an entry as a single fixed dataset can't
 * express that, so they force you to either store a row per year or give up the
 * age. Here the row stores an *anchor* (the birth date) and a *template*, and
 * the value is computed per occurrence at render time.
 *
 * The template language is deliberately tiny and closed: a fixed token set, no
 * arithmetic, no `eval`, no user-supplied functions. Two reasons. It has no
 * injection surface, and it stays a plain string — so the same field can be
 * written into Obsidian frontmatter and still mean something to whatever reads
 * it next.
 */

import { parts, yearsBetween, type CivilDate } from './civil';

export interface DeriveContext {
  title: string;
  /** The date this particular occurrence falls on. */
  date: CivilDate;
  /** Origin date. Null for events with no derived fields. */
  anchorDate: CivilDate | null;
  /** 1-based position in the series. */
  index: number;
}

/** `{token}` or `{fn(arg)}`. */
const TOKEN_RE = /\{(\w+)(?:\(\s*(\w+)\s*\)\s*)?\}/g;

/** The complete set of readable values. Anything else is a typo. */
function value(name: string, ctx: DeriveContext): string | number | null | undefined {
  switch (name) {
    case 'title':
      return ctx.title;
    /** Whole years from the anchor to this occurrence — i.e. the age. */
    case 'yearsSince':
      return ctx.anchorDate ? yearsBetween(ctx.anchorDate, ctx.date) : null;
    /** Which occurrence this is: 1st, 2nd, 3rd… */
    case 'n':
      return ctx.index;
    case 'year':
      return parts(ctx.date).year;
    default:
      return undefined; // unknown token
  }
}

export function ordinal(n: number): string {
  const tail = Math.abs(n) % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Resolves a template against one occurrence.
 *
 * Unknown tokens are left verbatim rather than silently dropped, so a typo in a
 * template shows up as `{yearSince}` on the calendar instead of a title that is
 * quietly missing its most important word.
 */
export function renderTemplate(template: string, ctx: DeriveContext): string {
  const out = template.replace(TOKEN_RE, (raw, name: string, arg?: string) => {
    if (name === 'ordinal') {
      if (!arg) return raw;
      const v = value(arg, ctx);
      return typeof v === 'number' ? ordinal(v) : v === null ? '' : raw;
    }
    const v = value(name, ctx);
    if (v === undefined) return raw; // unknown token
    if (v === null) return ''; // known token, nothing to resolve (e.g. no anchor)
    return String(v);
  });
  return tidy(out);
}

/**
 * When a token resolves to nothing, the separator around it is left stranded —
 * "Mom > " or "  — anniversary". Collapse the debris so a missing anchor
 * degrades to a clean title rather than a visibly broken one.
 */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*([·>—–-])\s*$/, '')
    .replace(/^\s*([·>—–-])\s*/, '')
    .replace(/([·>—–-])\s*\1/g, '$1')
    .trim();
}

/**
 * Does this template need an anchor date to resolve?
 *
 * Lives here rather than in the form because it is a fact about the template
 * language, and because a predicate inside a component is a predicate no test
 * can reach. The form asked `template.includes('{yearsSince}')` for months,
 * which the anniversary preset fails — it wraps the token as
 * `{ordinal(yearsSince)}` — so the anchor field never rendered and every
 * anniversary lost its number. Matching the token name after an optional call
 * prefix covers any wrapper the language grows later.
 */
export function needsAnchor(template: string | null | undefined): boolean {
  return /\{(?:ordinal\(\s*)?yearsSince/.test(template ?? '');
}

/** The resolved title for an occurrence, falling back to the raw title. */
export function resolveTitle(
  template: string | null | undefined,
  ctx: DeriveContext,
): string {
  if (!template) return ctx.title;
  const rendered = renderTemplate(template, ctx);
  return rendered.length > 0 ? rendered : ctx.title;
}

/**
 * Presets. These are UI conveniences that configure the general machinery —
 * nothing downstream branches on `kind`, it only ever reads anchor + template.
 */
export const TEMPLATE_PRESETS = {
  /** "Mom > 52" */
  birthday: '{title} > {yearsSince}',
  /** "Wedding — 12th anniversary" */
  anniversary: '{title} — {ordinal(yearsSince)} anniversary',
  /** "Standup · #143" */
  counted: '{title} · #{n}',
  /** "Contract review (2026)" */
  yearTagged: '{title} ({year})',
} as const;

export type TemplatePresetName = keyof typeof TEMPLATE_PRESETS;
