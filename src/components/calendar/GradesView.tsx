'use client';

import { useMemo, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { useGrades } from '@/lib/store/grade-store';
import {
  formatMark,
  formatPercent,
  formatWeight,
  markPercent,
  parseMark,
  parseWeight,
  sectionKey,
  sections,
  summarize,
  type CourseSummary,
  type GradeCourse,
  type GradeItem,
  type SectionSummary,
} from '@/lib/tempo/grades';
import type { Category } from '@/lib/tempo/types';
import { inputClass } from './ui';

/**
 * GRADES: one tab per course, each course a table of what it is marked on, with
 * the two numbers that matter above it.
 *
 * Not a calendar view — it reads categories from the calendar store and keeps
 * its own rows in `grade-store` — but it sits in the same nav because it is the
 * same app, and a course's deadlines and its marks are one train of thought.
 */

const COURSE_KEY = 'tempo.grades.course';

function rememberedCourse(): string | null {
  try {
    return window.localStorage.getItem(COURSE_KEY);
  } catch {
    return null;
  }
}

function rememberCourse(id: string) {
  try {
    window.localStorage.setItem(COURSE_KEY, id);
  } catch {
    // storage disabled: the tab just isn't remembered across reloads
  }
}

/**
 * The types an item can be, picked rather than typed. What is stored is the
 * name, so a type from before this list, or one nobody has added yet, still
 * groups and still shows, just without a colour of its own.
 */
const TYPES = [
  { name: 'Assignment', color: '#6d8bb0' },
  { name: 'Quiz', color: '#5aa39a' },
  { name: 'Test', color: '#c0953f' },
  { name: 'Exam', color: '#c9705a' },
  { name: 'Paper', color: '#b06d8b' },
  { name: 'Project', color: '#9a7cc0' },
  { name: 'Lab', color: '#7d9a6d' },
  { name: 'Participation', color: '#a8936d' },
  { name: 'Other', color: '#8a9096' },
];

function typeColor(type: string): string | null {
  const key = sectionKey(type);
  return TYPES.find((t) => t.name.toLowerCase() === key)?.color ?? (key ? '#8a9096' : null);
}

/** Tinted rather than filled: a table of seventeen rows should not shout. */
function chipStyle(color: string | null): React.CSSProperties {
  if (!color) return {};
  return {
    color: `color-mix(in oklab, ${color} 62%, var(--color-bright))`,
    background: `color-mix(in oklab, ${color} 20%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
  };
}

/** A course's name and colour come from its category while it has one. */
function courseFace(course: GradeCourse, categories: Category[]) {
  const category = course.categoryId ? categories.find((c) => c.id === course.categoryId) : undefined;
  return { name: category?.name ?? (course.name || 'UNTITLED'), color: category?.color ?? null };
}

export function GradesView() {
  const status = useGrades((s) => s.status);
  const courses = useGrades((s) => s.courses);
  const items = useGrades((s) => s.items);
  const error = useGrades((s) => s.error);
  const load = useGrades((s) => s.load);
  const dismissError = useGrades((s) => s.dismissError);
  const categories = useCalendar((s) => s.categories);

  const [chosen, setChosen] = useState<string | null>(rememberedCourse);
  const [adding, setAdding] = useState(false);

  const selected = courses.find((c) => c.id === chosen) ?? courses[0] ?? null;

  function choose(id: string) {
    setChosen(id);
    rememberCourse(id);
  }

  if (status === 'idle' || status === 'loading') {
    return <Centered>LOADING GRADES</Centered>;
  }
  if (status === 'missing') {
    return (
      <Centered>
        GRADES NEED ONE MIGRATION
        <span className="mt-3 block normal-case tracking-normal text-dim">
          Run <code className="text-ink">supabase/migrations/20261029_grades.sql</code> in the
          Supabase SQL editor, then reload.
        </span>
      </Centered>
    );
  }
  if (status === 'error') {
    return (
      <Centered>
        ! COULD NOT LOAD GRADES
        <button
          onClick={() => void load()}
          className="tap label mt-4 block w-full border border-hair px-3 py-2 hover:border-hairlit hover:text-ink"
        >
          TRY AGAIN
        </button>
      </Centered>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <CourseTabs
        courses={courses}
        items={items}
        categories={categories}
        selectedId={selected?.id ?? null}
        onChoose={choose}
        adding={adding}
        onAdding={setAdding}
      />
      {error && (
        <button
          onClick={dismissError}
          className="label shrink-0 border-b border-hair px-4 py-2 text-left text-dim hover:text-ink"
        >
          ! {error.slice(0, 80).toUpperCase()} — DISMISS
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {selected ? (
          <CoursePane
            key={selected.id}
            course={selected}
            items={items.filter((i) => i.courseId === selected.id)}
            categories={categories}
          />
        ) : (
          <Centered>
            NO COURSES YET
            <span className="mt-3 block normal-case tracking-normal text-dim">
              Pick a category you already use, or type a name.
            </span>
            <button
              onClick={() => setAdding(true)}
              className="mt-5 min-h-[44px] w-full border border-hairlit bg-raised px-5 text-[12px] tracking-[0.1em] text-ink transition-colors hover:border-dim hover:text-bright"
            >
              + ADD A COURSE
            </button>
          </Centered>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="label max-w-sm text-center leading-relaxed">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- the tabs

function CourseTabs({
  courses,
  items,
  categories,
  selectedId,
  onChoose,
  adding,
  onAdding,
}: {
  courses: GradeCourse[];
  items: GradeItem[];
  categories: Category[];
  selectedId: string | null;
  onChoose: (id: string) => void;
  adding: boolean;
  onAdding: (open: boolean) => void;
}) {
  return (
    <div className="relative flex shrink-0 items-stretch border-b border-hair">
      {/* Scrolls sideways on its own, so a term of seven courses on a phone
          does not push + COURSE off the edge where it cannot be reached. */}
      <nav aria-label="Courses" className="flex min-w-0 flex-1 overflow-x-auto">
        {courses.map((c) => {
          const face = courseFace(c, categories);
          const summary = summarize(items.filter((i) => i.courseId === c.id), c.drops);
          const on = c.id === selectedId;
          return (
            <button
              key={c.id}
              onClick={() => onChoose(c.id)}
              aria-current={on}
              className={[
                'flex min-h-[44px] shrink-0 items-center gap-2 border-r border-hair px-4 text-[12px] transition-colors',
                on ? 'bg-raised text-bright' : 'text-dim hover:bg-sunken hover:text-ink',
              ].join(' ')}
            >
              <Swatch color={face.color} />
              <span className="max-w-[14ch] truncate">{face.name}</span>
              <span className={`tabular-nums ${on ? 'text-ink' : 'text-mute'}`}>
                {formatPercent(summary.final ?? summary.current)}
              </span>
            </button>
          );
        })}
      </nav>
      <button
        onClick={() => onAdding(!adding)}
        aria-expanded={adding}
        className="min-h-[44px] shrink-0 border-l border-hairlit bg-raised px-4 text-[12px] tracking-[0.08em] whitespace-nowrap text-ink transition-colors hover:bg-hair hover:text-bright"
      >
        + COURSE
      </button>
      {adding && (
        <AddCourse
          courses={courses}
          categories={categories}
          onDone={(id) => {
            onAdding(false);
            if (id) onChoose(id);
          }}
        />
      )}
    </div>
  );
}

/** The category's colour as the 2px stroke the list view uses. Nothing, without one. */
function Swatch({ color }: { color: string | null }) {
  return (
    <span
      className="h-3 w-[2px] shrink-0"
      style={{ background: color ?? 'var(--color-hairlit)' }}
      aria-hidden="true"
    />
  );
}

function AddCourse({
  courses,
  categories,
  onDone,
}: {
  courses: GradeCourse[];
  categories: Category[];
  onDone: (id: string | null) => void;
}) {
  const addCourse = useGrades((s) => s.addCourse);
  const [name, setName] = useState('');
  const taken = new Set(courses.map((c) => c.categoryId));
  const free = categories.filter((c) => !taken.has(c.id));

  async function add(input: { categoryId: string | null; name: string }) {
    onDone(await addCourse(input));
  }

  return (
    <>
      {/* Click-away, as a surface rather than a document listener: it is the
          one thing on screen that is not the panel, so it is the one thing a
          click outside can land on. */}
      <button
        aria-label="Close"
        className="fixed inset-0 z-30 cursor-default"
        onClick={() => onDone(null)}
      />
      <div
        className="absolute right-0 top-full z-40 w-[min(320px,100vw)] border border-hairlit bg-panel p-3 shadow-[0_8px_24px_rgba(0,0,0,0.7)]"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null);
        }}
      >
        {free.length > 0 && (
          <>
            <div className="label mb-2">FROM A CATEGORY</div>
            <ul className="mb-3 max-h-[240px] overflow-y-auto border-y border-hair">
              {free.map((c) => (
                <li key={c.id} className="border-b border-hair last:border-b-0">
                  <button
                    onClick={() => void add({ categoryId: c.id, name: c.name })}
                    className="tap flex w-full items-center gap-2 px-2 py-2 text-left text-[12px] text-ink transition-colors hover:bg-raised"
                  >
                    <Swatch color={c.color} />
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void add({ categoryId: null, name });
          }}
        >
          <label className="label mb-2 block" htmlFor="new-course">
            {free.length > 0 ? 'OR A NEW NAME' : 'COURSE NAME'}
          </label>
          <div className="flex gap-2">
            <input
              id="new-course"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BIO 1001"
              className={`${inputClass} py-1.5`}
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="tap label shrink-0 border border-hairlit px-3 text-ink transition-colors hover:border-dim disabled:opacity-40"
            >
              ADD
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// --------------------------------------------------------------- a course

function CoursePane({
  course,
  items,
  categories,
}: {
  course: GradeCourse;
  items: GradeItem[];
  categories: Category[];
}) {
  const updateCourse = useGrades((s) => s.updateCourse);
  const deleteCourse = useGrades((s) => s.deleteCourse);
  const addItem = useGrades((s) => s.addItem);
  const [fresh, setFresh] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const face = courseFace(course, categories);
  const summary = useMemo(() => summarize(items, course.drops), [items, course.drops]);
  const groups = useMemo(() => sections(items, course.drops), [items, course.drops]);
  const typed = groups.some((g) => g.name !== '');

  async function add() {
    // A new row takes the type of the one above it: items are usually entered
    // in runs, and choosing Quiz five times is the chore here.
    const last = items[items.length - 1];
    const id = await addItem(course.id, { section: last?.section ?? '' });
    if (id) setFresh(id);
  }

  return (
    <div className="mx-auto w-full max-w-5xl pb-16">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-5 pb-3">
        <Swatch color={face.color} />
        {course.categoryId && face.color ? (
          <h1 className="text-[15px] tracking-[0.04em] text-bright">{face.name}</h1>
        ) : (
          <Cell
            label="Course name"
            value={course.name}
            commit={(t) => updateCourse(course.id, { name: t })}
            placeholder="Course name"
            className="max-w-[24ch] text-[15px] text-bright"
          />
        )}
        <span className="label">
          {items.length} {items.length === 1 ? 'ITEM' : 'ITEMS'}
        </span>
      </header>

      <Stats summary={summary} />

      <ItemTable
        items={items}
        summary={summary}
        fresh={fresh}
        onAdd={() => void add()}
      />

      {typed && <TypeCards course={course} groups={groups} />}

      <section className="mt-8 border-t border-hair px-4 py-4">
        <label className="label mb-2 block" htmlFor={`notes-${course.id}`}>
          NOTES
        </label>
        <textarea
          id={`notes-${course.id}`}
          value={course.notes}
          onChange={(e) => updateCourse(course.id, { notes: e.target.value })}
          placeholder="Office hours, what the syllabus says about late work…"
          rows={4}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </section>

      <section className="flex justify-end gap-2 border-t border-hair px-4 py-4">
        {confirming ? (
          <>
            <span className="label self-center">
              DELETE {face.name.toUpperCase()} AND ITS {items.length} {items.length === 1 ? 'MARK' : 'MARKS'}?
            </span>
            <button
              onClick={() => setConfirming(false)}
              className="tap label border border-hair px-3 py-2 hover:border-hairlit hover:text-ink"
            >
              KEEP
            </button>
            <button
              onClick={() => void deleteCourse(course.id)}
              className="tap label border border-hairlit px-3 py-2 text-ink hover:border-dim hover:text-bright"
            >
              DELETE
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="tap label border border-transparent px-3 py-2 hover:text-dim"
          >
            DELETE COURSE
          </button>
        )}
      </section>
    </div>
  );
}

function Stats({ summary }: { summary: CourseSummary }) {
  let finalNote = 'when every mark is in';
  if (summary.final !== null) finalNote = 'everything is in';
  else if (summary.complete) finalNote = 'needs weights to total 100%';

  return (
    <dl className="grid grid-cols-2 divide-x divide-hair border-y border-hair">
      <Stat
        label="CURRENT"
        value={formatPercent(summary.current)}
        note={
          summary.current === null
            ? 'no marks in yet'
            : `on ${formatWeight(summary.gradedWeight)} marked so far`
        }
      />
      <Stat label="FINAL" value={formatPercent(summary.final)} note={finalNote} />
    </dl>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-4 py-4">
      <dt className="label">{label}</dt>
      <dd className="mt-2 text-[28px] leading-none tabular-nums text-bright">{value}</dd>
      <dd className="mt-2 text-[10px] leading-snug text-mute">{note}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- the table

/**
 * One grid for both widths. On a phone a row is three lines: name, then
 * type / weight / grade / %, then notes. From `sm` it is one line in column
 * order, which `order-*` rearranges without a second copy of the row.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_64px_84px_60px] sm:grid-cols-[136px_minmax(0,2fr)_76px_92px_72px_minmax(0,2fr)_36px]';

/** A column's rule. Between columns only, so the table's edge stays open. */
const RULE = 'border-l border-hair';

function ItemTable({
  items,
  summary,
  fresh,
  onAdd,
}: {
  items: GradeItem[];
  summary: CourseSummary;
  fresh: string | null;
  onAdd: () => void;
}) {
  const off = summary.weightTotal - 100;

  return (
    <section className="mt-6 border-t border-hairlit">
      <div className={`${ROW} hidden border-b border-hairlit bg-raised sm:grid`}>
        <span className="label px-3 py-2.5">TYPE</span>
        <span className={`label px-3 py-2.5 ${RULE}`}>NAME</span>
        <span className={`label px-3 py-2.5 text-right ${RULE}`}>WEIGHT</span>
        <span className={`label px-3 py-2.5 text-right ${RULE}`}>GRADE</span>
        <span className={`label px-3 py-2.5 text-right ${RULE}`}>%</span>
        <span className={`label px-3 py-2.5 ${RULE}`}>NOTES</span>
        <span className={RULE} />
      </div>

      <ul>
        {items.map((it, i) => (
          <ItemRow
            key={it.id}
            item={it}
            focus={it.id === fresh}
            dropped={summary.dropped.has(it.id)}
            startsGroup={i > 0 && sectionKey(items[i - 1].section) !== sectionKey(it.section)}
          />
        ))}
      </ul>

      <button
        onClick={onAdd}
        className="tap label w-full border-b border-hair px-4 py-3 text-left transition-colors hover:bg-sunken hover:text-ink"
      >
        + ITEM
      </button>

      {items.length > 0 && (
        <div className={`${ROW} border-b border-hairlit bg-raised`}>
          <span className="label self-center px-3 py-2.5 sm:order-1 sm:col-span-2">TOTAL</span>
          <span
            className={`self-center px-3 py-2.5 text-right text-[12px] tabular-nums sm:order-3 ${
              summary.balanced ? 'text-ink' : 'text-bright'
            }`}
          >
            {formatWeight(summary.weightTotal)}
          </span>
          <span className="col-span-2 self-center px-3 py-2.5 text-right text-[11px] tabular-nums text-dim sm:order-4">
            {summary.gradedWeight > 0
              ? `${summary.banked.toFixed(1)} / ${formatWeight(summary.gradedWeight).replace('%', '')} pts`
              : '—'}
          </span>
          {!summary.balanced && summary.weightTotal > 0 && (
            <span className="col-span-4 self-center px-3 pb-2.5 text-[11px] text-ink sm:order-5 sm:col-span-2 sm:pt-2.5">
              ! {off < 0 ? `${formatWeight(-off)} unassigned` : `${formatWeight(off)} over`}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function ItemRow({
  item,
  focus,
  dropped,
  startsGroup,
}: {
  item: GradeItem;
  focus: boolean;
  dropped: boolean;
  startsGroup: boolean;
}) {
  const updateItem = useGrades((s) => s.updateItem);
  const deleteItem = useGrades((s) => s.deleteItem);
  const pct = markPercent(item);
  const color = typeColor(item.section);

  return (
    <li
      className={`${ROW} border-b border-l-2 transition-colors hover:bg-sunken ${
        startsGroup ? 'border-t border-t-hairlit' : ''
      } border-b-hair`}
      style={{ borderLeftColor: color ?? 'transparent' }}
    >
      <div className="order-1 col-span-3 sm:order-2 sm:col-span-1 sm:border-l sm:border-hair">
        <Cell
          label="Name"
          value={item.name}
          commit={(t) => updateItem(item.id, { name: t })}
          placeholder="Name"
          autoFocus={focus}
          className={dropped ? 'text-dim' : 'text-bright'}
        />
      </div>
      <div className="order-3 flex items-center px-2 py-1 sm:order-1">
        <TypeChip value={item.section} onChange={(t) => updateItem(item.id, { section: t })} />
      </div>
      <div className={`${RULE} order-4 sm:order-3`}>
        <Cell
          label="Weight"
          value={item.weight === 0 ? '' : formatWeight(item.weight)}
          valid={(t) => parseWeight(t) !== null}
          commit={(t) => updateItem(item.id, { weight: parseWeight(t)! })}
          placeholder="0%"
          inputMode="decimal"
          hint="A percentage of the final grade, 0–100"
          className="text-right tabular-nums text-ink"
        />
      </div>
      <div className={`${RULE} order-5 sm:order-4`}>
        <Cell
          label="Grade"
          value={formatMark(item)}
          valid={(t) => parseMark(t).kind !== 'invalid'}
          commit={(t) => {
            const m = parseMark(t);
            if (m.kind === 'mark') updateItem(item.id, { earned: m.earned, outOf: m.outOf });
            else updateItem(item.id, { earned: null, outOf: null });
          }}
          placeholder="—"
          hint="85, 85% or 17/20 — blank if it isn't back yet"
          className={`text-right tabular-nums ${dropped ? 'text-mute line-through' : 'text-ink'}`}
        />
      </div>
      <span
        className={`${RULE} order-6 flex items-center justify-end px-3 text-[11px] tabular-nums sm:order-5 ${
          dropped ? 'text-mute' : 'text-dim'
        }`}
        title={dropped && pct !== null ? `${formatPercent(pct)}, the lowest, so it does not count` : undefined}
      >
        {dropped ? 'dropped' : pct === null ? '' : formatPercent(pct)}
      </span>
      <div className="order-7 col-span-4 border-t border-hair sm:order-6 sm:col-span-1 sm:border-t-0 sm:border-l">
        <Cell
          label="Notes"
          value={item.notes}
          commit={(t) => updateItem(item.id, { notes: t })}
          placeholder="Notes"
          className="text-[11px] text-dim"
        />
      </div>
      <button
        onClick={() => void deleteItem(item.id)}
        aria-label={`Remove ${item.name || 'item'}`}
        title="Remove"
        className={`tap ${RULE} order-2 px-2 text-[13px] text-mute transition-colors hover:text-ink sm:order-7`}
      >
        ×
      </button>
    </li>
  );
}

/**
 * The item's type, as a chip that is really a select: the phone's own picker,
 * the keyboard, and no menu to clip against the bottom of the scrolling table.
 */
function TypeChip({ value, onChange }: { value: string; onChange: (type: string) => void }) {
  const known = TYPES.some((t) => t.name.toLowerCase() === sectionKey(value));
  return (
    <div className="relative inline-flex max-w-full">
      <select
        aria-label="Type"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={chipStyle(typeColor(value))}
        className={`field-sizing-content max-w-full cursor-pointer appearance-none truncate rounded-full border py-1 pr-5 pl-2.5 text-[10px] tracking-[0.06em] uppercase outline-none transition-colors focus-visible:outline-1 focus-visible:outline-dim ${
          value ? '' : 'border-dashed border-hairlit text-mute hover:text-dim'
        }`}
      >
        <option value="" className="bg-panel text-ink">
          Type
        </option>
        {!known && value && (
          <option value={value} className="bg-panel text-ink">
            {value}
          </option>
        )}
        {TYPES.map((t) => (
          <option key={t.name} value={t.name} className="bg-panel text-ink">
            {t.name}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[8px] opacity-70"
        style={value ? { color: chipStyle(typeColor(value)).color } : undefined}
      >
        ▾
      </span>
    </div>
  );
}

/**
 * A cell that is an input until you look closely.
 *
 * It keeps what you typed while you are typing — `17/` is not a mark yet, and a
 * field bound straight to the store would refuse the keystroke that gets you to
 * `17/20` — and hands each value that parses to `commit` as it goes, so the
 * numbers above update with every keystroke that means something. On blur it
 * shows the stored value again, in its own spelling: `85` comes back as `85%`.
 */
function Cell({
  value,
  commit,
  valid = () => true,
  label,
  hint,
  placeholder,
  className = '',
  inputMode,
  autoFocus,
}: {
  value: string;
  commit: (text: string) => void;
  valid?: (text: string) => boolean;
  label: string;
  hint?: string;
  placeholder?: string;
  className?: string;
  inputMode?: 'decimal' | 'text';
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const bad = draft !== null && !valid(draft);

  return (
    <input
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? hint : undefined}
      value={text}
      placeholder={placeholder}
      inputMode={inputMode}
      autoFocus={autoFocus}
      onChange={(e) => {
        const t = e.target.value;
        setDraft(t);
        if (valid(t)) commit(t);
      }}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={[
        'min-w-0 w-full border bg-transparent px-3 py-2 text-[12px] outline-none transition-colors placeholder:text-mute',
        bad
          ? 'border-dashed border-dim'
          : 'border-transparent hover:border-hair focus:border-hairlit focus:bg-panel',
        className,
      ].join(' ')}
    />
  );
}

// -------------------------------------------------------------- the types

/**
 * A card per type: what it comes to so far, and the one rule that belongs to a
 * group rather than a row.
 */
function TypeCards({ course, groups }: { course: GradeCourse; groups: SectionSummary[] }) {
  const updateCourse = useGrades((s) => s.updateCourse);

  function setDrops(key: string, count: number) {
    const drops = { ...course.drops };
    if (count > 0) drops[key] = count;
    else delete drops[key];
    updateCourse(course.id, { drops });
  }

  return (
    <section className="mt-8 grid grid-cols-1 gap-2 px-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups
        .filter((g) => g.name !== '')
        .map((g) => {
          const key = sectionKey(g.name);
          return (
            <div
              key={key}
              className="border border-l-2 border-hair bg-panel px-3 py-3"
              style={{ borderLeftColor: typeColor(g.name) ?? undefined }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="truncate text-[11px] tracking-[0.06em] uppercase"
                  style={{ color: chipStyle(typeColor(g.name)).color }}
                >
                  {g.name}
                </span>
                <span className="shrink-0 text-[14px] tabular-nums text-bright">
                  {formatPercent(g.current)}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-mute">
                {g.count} {g.count === 1 ? 'item' : 'items'} · {formatWeight(g.weight)} of the course
              </div>
              {g.count > 1 && (
                <DropStepper
                  name={g.name}
                  value={Math.min(course.drops[key] ?? 0, g.count - 1)}
                  max={g.count - 1}
                  onChange={(n) => setDrops(key, n)}
                />
              )}
            </div>
          );
        })}
    </section>
  );
}

function DropStepper({
  name,
  value,
  max,
  onChange,
}: {
  name: string;
  value: number;
  max: number;
  onChange: (count: number) => void;
}) {
  const step = 'tap w-7 text-[13px] text-dim transition-colors hover:text-bright disabled:opacity-30';
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t border-hair pt-2">
      <span className="text-[11px] text-dim">Drop lowest</span>
      <div className="flex items-center border border-hair">
        <button
          onClick={() => onChange(value - 1)}
          disabled={value <= 0}
          aria-label={`Drop one fewer ${name}`}
          className={step}
        >
          −
        </button>
        <span className="w-6 text-center text-[12px] tabular-nums text-ink">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`Drop one more ${name}`}
          className={step}
        >
          +
        </button>
      </div>
    </div>
  );
}
