import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The grade store's promises: an edit shows at once, reaches the server after a
 * pause as one write, and comes back out if the server refuses it; a missing
 * table reads as "run the migration", not as a failure.
 */

interface RecordedCall {
  table: string;
  op: string;
  payload: unknown;
}

const recorded: RecordedCall[] = [];
let shouldFail = false;
let missing = false;
const stored: Record<string, unknown[]> = {};

function query(table: string) {
  const state = { op: 'select', payload: null as unknown };
  const settle = () => {
    recorded.push({ table, op: state.op, payload: state.payload });
    if (missing) {
      return Promise.resolve({ data: null, error: { code: 'PGRST205', message: 'no table' } });
    }
    if (shouldFail && state.op !== 'select') {
      return Promise.resolve({ data: null, error: { message: 'write rejected' } });
    }
    return Promise.resolve({ data: state.op === 'select' ? (stored[table] ?? []) : [], error: null });
  };
  const q = {
    select: () => q,
    order: () => q,
    eq: () => q,
    insert: (p: unknown) => ((state.op = 'insert'), (state.payload = p), q),
    update: (p: unknown) => ((state.op = 'update'), (state.payload = p), q),
    delete: () => ((state.op = 'delete'), q),
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => settle().then(ok, err),
  };
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => query(table),
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
    channel: () => ({ on: () => ({}), subscribe: () => ({}) }),
    removeChannel: () => {},
  }),
}));

const { useCalendar } = await import('./calendar-store');
const { useGrades } = await import('./grade-store');

beforeEach(() => {
  vi.useFakeTimers();
  recorded.length = 0;
  shouldFail = false;
  missing = false;
  for (const k of Object.keys(stored)) delete stored[k];
  useCalendar.setState({ ownerId: 'owner-1' });
  useGrades.setState({ status: 'idle', courses: [], items: [], error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

async function courseWithItem() {
  const courseId = (await useGrades.getState().addCourse({ categoryId: 'cat-1', name: 'CS4442' }))!;
  const itemId = (await useGrades.getState().addItem(courseId, { name: 'A1', weight: 10 }))!;
  recorded.length = 0;
  return { courseId, itemId };
}

describe('grade store', () => {
  it('says the migration has not been run when the tables are missing', async () => {
    missing = true;
    await useGrades.getState().load();
    expect(useGrades.getState().status).toBe('missing');
    expect(useGrades.getState().error).toBeNull();
  });

  it('says the same when a write finds the tables missing', async () => {
    const { itemId } = await courseWithItem();
    missing = true;
    useGrades.getState().updateItem(itemId, { weight: 40 });
    await vi.runAllTimersAsync();
    expect(useGrades.getState().status).toBe('missing');
    expect(useGrades.getState().error).toBeNull();
  });

  it('reads courses and items', async () => {
    stored.grade_courses = [
      { id: 'c1', category_id: null, name: 'Bio', notes: '', target: 80, sort_order: 0 },
    ];
    stored.grade_items = [
      {
        id: 'i1',
        course_id: 'c1',
        name: 'Lab',
        section: '',
        weight: 25,
        earned: 18,
        out_of: 20,
        notes: '',
        event_id: null,
        sort_order: 0,
      },
    ];
    await useGrades.getState().load();
    const s = useGrades.getState();
    expect(s.status).toBe('ready');
    expect(s.courses[0].target).toBe(80);
    expect(s.items[0]).toMatchObject({ earned: 18, outOf: 20, weight: 25 });
  });

  it('adds a course and an item with the owner on each insert', async () => {
    await useGrades.getState().addCourse({ categoryId: 'cat-1', name: ' CS4442 ' });
    const course = useGrades.getState().courses[0];
    expect(course.name).toBe('CS4442');
    expect(recorded[0]).toMatchObject({
      table: 'grade_courses',
      op: 'insert',
      payload: { owner_id: 'owner-1', category_id: 'cat-1' },
    });
  });

  it('shows an edit at once and writes it once, after the pause', async () => {
    const { itemId } = await courseWithItem();
    const { updateItem } = useGrades.getState();
    updateItem(itemId, { earned: 1, outOf: 100 });
    updateItem(itemId, { earned: 17, outOf: 20 });
    expect(useGrades.getState().items[0]).toMatchObject({ earned: 17, outOf: 20 });
    expect(recorded).toHaveLength(0);

    await vi.runAllTimersAsync();
    const writes = recorded.filter((r) => r.op === 'update');
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ earned: 17, out_of: 20, weight: 10, name: 'A1' });
  });

  it('puts the row back the way the server had it when a write is refused', async () => {
    const { itemId } = await courseWithItem();
    shouldFail = true;
    useGrades.getState().updateItem(itemId, { weight: 40 });
    useGrades.getState().updateItem(itemId, { weight: 45 });
    await vi.runAllTimersAsync();
    const s = useGrades.getState();
    expect(s.items[0].weight).toBe(10);
    expect(s.error).toBe('write rejected');
  });

  it('removes a course that could not be created', async () => {
    shouldFail = true;
    const id = await useGrades.getState().addCourse({ categoryId: null, name: 'Bio' });
    expect(id).toBeNull();
    expect(useGrades.getState().courses).toHaveLength(0);
  });

  it('takes a course’s items with it, and restores both if the delete fails', async () => {
    const { courseId } = await courseWithItem();
    shouldFail = true;
    await useGrades.getState().deleteCourse(courseId);
    expect(useGrades.getState().courses).toHaveLength(1);
    expect(useGrades.getState().items).toHaveLength(1);

    shouldFail = false;
    await useGrades.getState().deleteCourse(courseId);
    expect(useGrades.getState().courses).toHaveLength(0);
    expect(useGrades.getState().items).toHaveLength(0);
  });

  it('keeps a row being typed into when a reload lands', async () => {
    const { itemId, courseId } = await courseWithItem();
    useGrades.getState().updateItem(itemId, { name: 'A1 — essay' });
    stored.grade_courses = [
      { id: courseId, category_id: 'cat-1', name: 'CS4442', notes: '', target: null, sort_order: 0 },
    ];
    stored.grade_items = [
      {
        id: itemId,
        course_id: courseId,
        name: 'A1',
        section: '',
        weight: 10,
        earned: null,
        out_of: null,
        notes: '',
        event_id: null,
        sort_order: 0,
      },
    ];
    await useGrades.getState().load();
    expect(useGrades.getState().items[0].name).toBe('A1 — essay');
  });
});
