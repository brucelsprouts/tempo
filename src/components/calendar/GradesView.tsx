'use client';

import { useMemo, useState } from 'react';
import { useCalendar } from '@/lib/store/calendar-store';
import { useGrades } from '@/lib/store/grade-store';
import {
  formatMark,
  formatPercent,
  formatWeight,
  markPercent,
  need,
  parseMark,
  parseTarget,
  parseWeight,
  sections,
  summarize,
  type CourseSummary,
  type GradeCourse,
  type GradeItem,
} from '@/lib/tempo/grades';
import type { Category } from '@/lib/tempo/types';
import { inputClass } from './ui';

/**
 * GRADES: one tab per course, each course a ruled table of what it is marked
 * on, and the arithmetic said in sentences rather than left to the reader.
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
              Add one with + COURSE — pick a category you already use, or type a name.
            </span>
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
}: {
  courses: GradeCourse[];
  items: GradeItem[];
  categories: Category[];
  selectedId: string | null;
  onChoose: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="relative flex shrink-0 items-stretch border-b border-hair">
      {/* Scrolls sideways on its own, so a term of seven courses on a phone
          does not push + COURSE off the edge where it cannot be reached. */}
      <nav aria-label="Courses" className="flex min-w-0 flex-1 overflow-x-auto">
        {courses.map((c) => {
          const face = courseFace(c, categories);
          const summary = summarize(items.filter((i) => i.courseId === c.id));
          const on = c.id === selectedId;
          return (
            <button
              key={c.id}
              onClick={() => onChoose(c.id)}
              aria-current={on}
              className={[
                'tap flex shrink-0 items-center gap-2 border-r border-hair px-3 py-2 text-[11px] transition-colors',
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
        onClick={() => setAdding((v) => !v)}
        aria-expanded={adding}
        className="tap label shrink-0 border-l border-hair px-3 transition-colors hover:bg-sunken hover:text-ink"
      >
        + COURSE
      </button>
      {adding && (
        <AddCourse
          courses={courses}
          categories={categories}
          onDone={(id) => {
            setAdding(false);
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
  const summary = useMemo(() => summarize(items), [items]);
  const groups = useMemo(() => sections(items), [items]);
  const named = groups.some((g) => g.name !== '');

  async function add() {
    // A new row joins the section of the one above it: assignments are usually
    // entered in runs, and retyping "Assignments" five times is the chore here.
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

      {named && <Sections groups={groups} />}

      <Target course={course} summary={summary} />

      <section className="border-t border-hair px-4 py-4">
        <label className="label mb-2 block" htmlFor={`notes-${course.id}`}>
          NOTES
        </label>
        <textarea
          id={`notes-${course.id}`}
          value={course.notes}
          onChange={(e) => updateCourse(course.id, { notes: e.target.value })}
          placeholder="Drop-lowest rules, office hours, what the syllabus says about late work…"
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
  const range =
    summary.best === null || summary.worst === null
      ? '—'
      : summary.complete
        ? formatPercent(summary.final)
        : `${summary.worst.toFixed(1)}–${summary.best.toFixed(1)}%`;

  const off = summary.weightTotal - 100;
  const weightNote =
    summary.weightTotal === 0
      ? 'none set yet'
      : summary.balanced
        ? 'adds up'
        : off < 0
          ? `${formatWeight(-off)} unassigned`
          : `${formatWeight(off)} over`;

  return (
    <dl className="grid grid-cols-2 border-y border-hair sm:grid-cols-4">
      <Stat
        label="CURRENT"
        value={formatPercent(summary.current)}
        note={
          summary.current === null
            ? 'no marks in yet'
            : `on ${formatWeight(summary.gradedWeight)} marked so far`
        }
      />
      <Stat
        label="FINAL"
        value={formatPercent(summary.final)}
        note={summary.final === null ? 'when every mark is in' : 'everything is in'}
      />
      <Stat
        label="CAN STILL FINISH"
        value={range}
        note={
          summary.best === null
            ? 'needs weights to total 100%'
            : summary.complete
              ? 'settled'
              : 'zeros on the rest – full marks'
        }
      />
      <Stat
        label="WEIGHTS"
        value={formatWeight(summary.weightTotal)}
        note={weightNote}
        warn={summary.weightTotal > 0 && !summary.balanced}
      />
    </dl>
  );
}

function Stat({
  label,
  value,
  note,
  warn = false,
}: {
  label: string;
  value: string;
  note: string;
  warn?: boolean;
}) {
  return (
    <div className="border-hair px-4 py-3 odd:border-r sm:border-r sm:last:border-r-0 [&:nth-child(-n+2)]:border-b sm:[&:nth-child(-n+2)]:border-b-0">
      <dt className="label">{label}</dt>
      <dd className="mt-1.5 text-[20px] leading-none tabular-nums text-bright">{value}</dd>
      <dd className={`mt-1.5 text-[10px] leading-snug ${warn ? 'text-ink' : 'text-mute'}`}>
        {warn ? '! ' : ''}
        {note}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------- the table

/**
 * One grid for both widths. On a phone a row is three lines — name, then
 * section / weight / grade / %, then notes — and from `sm` it is one line in
 * column order, which `order-*` rearranges without a second copy of the row.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_64px_84px_60px] gap-x-1 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_72px_92px_64px_minmax(0,2fr)_36px]';

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
  return (
    <section className="mt-6">
      <div className={`${ROW} hidden border-b border-hairlit px-3 pb-2 sm:grid`}>
        <span className="label px-2">SECTION</span>
        <span className="label px-2">ASSIGNMENT</span>
        <span className="label px-2 text-right">WEIGHT</span>
        <span className="label px-2 text-right">GRADE</span>
        <span className="label px-2 text-right">%</span>
        <span className="label px-2">NOTES</span>
        <span />
      </div>

      <ul>
        {items.map((it) => (
          <ItemRow key={it.id} item={it} focus={it.id === fresh} />
        ))}
      </ul>

      <button
        onClick={onAdd}
        className="tap label w-full border-b border-hair px-5 py-3 text-left transition-colors hover:bg-sunken hover:text-ink"
      >
        + ASSIGNMENT
      </button>

      {items.length > 0 && (
        <div className={`${ROW} border-b border-hairlit px-3 py-2.5`}>
          <span className="label col-span-1 self-center px-2 sm:order-1 sm:col-span-2">TOTAL</span>
          <span className="self-center px-2 text-right text-[12px] tabular-nums text-ink sm:order-3">
            {formatWeight(summary.weightTotal)}
          </span>
          <span className="col-span-2 self-center px-2 text-right text-[11px] tabular-nums text-dim sm:order-4 sm:col-span-2">
            {summary.gradedWeight > 0
              ? `${summary.banked.toFixed(1)} / ${formatWeight(summary.gradedWeight).replace('%', '')} pts`
              : '—'}
          </span>
        </div>
      )}
    </section>
  );
}

function ItemRow({ item, focus }: { item: GradeItem; focus: boolean }) {
  const updateItem = useGrades((s) => s.updateItem);
  const deleteItem = useGrades((s) => s.deleteItem);
  const pct = markPercent(item);
  const contribution = pct === null ? null : (item.weight * pct) / 100;

  return (
    <li className={`${ROW} gap-y-0.5 border-b border-hair px-3 py-1.5`}>
      <Cell
        label="Assignment"
        value={item.name}
        commit={(t) => updateItem(item.id, { name: t })}
        placeholder="Assignment"
        autoFocus={focus}
        className="col-span-3 text-ink sm:order-2 sm:col-span-1"
      />
      <button
        onClick={() => void deleteItem(item.id)}
        aria-label={`Remove ${item.name || 'assignment'}`}
        title="Remove"
        className="tap justify-self-end px-2 text-[13px] text-mute transition-colors hover:text-ink sm:order-7"
      >
        ×
      </button>
      <Cell
        label="Section"
        value={item.section}
        commit={(t) => updateItem(item.id, { section: t })}
        placeholder="Section"
        className="text-dim sm:order-1"
      />
      <Cell
        label="Weight"
        value={item.weight === 0 ? '' : formatWeight(item.weight)}
        valid={(t) => parseWeight(t) !== null}
        commit={(t) => updateItem(item.id, { weight: parseWeight(t)! })}
        placeholder="0%"
        inputMode="decimal"
        hint="A percentage of the final grade, 0–100"
        className="text-right tabular-nums text-ink sm:order-3"
      />
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
        className="text-right tabular-nums text-ink sm:order-4"
      />
      <span
        className="self-center px-2 text-right text-[11px] tabular-nums text-dim sm:order-5"
        title={
          contribution === null
            ? undefined
            : `${contribution.toFixed(2)} of ${formatWeight(item.weight)} towards the final grade`
        }
      >
        {pct === null ? '' : formatPercent(pct)}
      </span>
      <Cell
        label="Notes"
        value={item.notes}
        commit={(t) => updateItem(item.id, { notes: t })}
        placeholder="Notes"
        className="col-span-4 text-[11px] text-dim sm:order-6 sm:col-span-1"
      />
    </li>
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
        'min-w-0 w-full border bg-transparent px-2 py-1.5 text-[12px] outline-none transition-colors placeholder:text-mute',
        bad
          ? 'border-dashed border-dim'
          : 'border-transparent hover:border-hair focus:border-hairlit focus:bg-panel',
        className,
      ].join(' ')}
    />
  );
}

// -------------------------------------------------------------- the rest

function Sections({ groups }: { groups: ReturnType<typeof sections> }) {
  return (
    <section className="mt-8 px-4">
      <div className="label mb-2">BY SECTION</div>
      <ul className="border-t border-hair">
        {groups.map((g) => (
          <li
            key={g.name.toLowerCase() || '(none)'}
            className="flex items-baseline gap-3 border-b border-hair py-2 text-[12px]"
          >
            <span className="min-w-0 flex-1 truncate text-ink">{g.name || 'No section'}</span>
            <span className="label">{g.count}</span>
            <span className="w-16 text-right tabular-nums text-dim">{formatWeight(g.weight)}</span>
            <span className="w-16 text-right tabular-nums text-ink">{formatPercent(g.current)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Target({ course, summary }: { course: GradeCourse; summary: CourseSummary }) {
  const updateCourse = useGrades((s) => s.updateCourse);
  const target = course.target;

  return (
    <section className="mt-8 border-t border-hair px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="label">WHAT DO I NEED?</span>
        <div className="flex items-center gap-2">
          <span className="label">TARGET</span>
          <div className="w-20 border border-hair">
            <Cell
              label="Target final grade"
              value={target === null ? '' : formatWeight(target)}
              valid={(t) => parseTarget(t) !== 'invalid'}
              commit={(t) => {
                const v = parseTarget(t);
                if (v !== 'invalid') updateCourse(course.id, { target: v });
              }}
              placeholder="80%"
              inputMode="decimal"
              hint="A final grade between 0 and 100"
              className="text-right tabular-nums text-ink"
            />
          </div>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink">{needSentence(summary, target)}</p>
    </section>
  );
}

/** The answer, as a sentence. A number on its own would need a legend. */
function needSentence(summary: CourseSummary, target: number | null): string {
  if (summary.weightTotal === 0) return 'Add assignments and their weights to plan against a target.';
  // Before the target: a target cannot be planned against until this is fixed,
  // so it is the more useful thing to say even when no target is set.
  if (!summary.balanced) {
    return `The weights add up to ${formatWeight(summary.weightTotal)}. Make them total 100% to plan against a target.`;
  }
  if (target === null) return 'Set a target final grade to see what you need on what is left.';
  const result = need(summary, target);
  const t = formatPercent(target);
  switch (result.kind) {
    case 'unbalanced':
      return `The weights add up to ${formatWeight(result.weightTotal)}. Make them total 100% to plan against a target.`;
    case 'complete':
      return result.met
        ? `Every mark is in: ${formatPercent(result.final)}, which meets your ${t} target.`
        : `Every mark is in: ${formatPercent(result.final)}, short of your ${t} target.`;
    case 'secured':
      return `Already secured — even zero on the remaining ${formatWeight(summary.remainingWeight)} keeps you at ${t} or above.`;
    case 'impossible':
      return `Not reachable — full marks on everything left gets you to ${formatPercent(result.best)}.`;
    case 'need':
      return `You need an average of ${formatPercent(result.average)} on the remaining ${formatWeight(result.remainingWeight)} to finish at ${t}.`;
  }
}
