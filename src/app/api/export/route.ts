import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toICS } from '@/lib/tempo/ics';
import {
  categoryFromRow,
  eventFromRow,
  gradeCourseFromRow,
  gradeItemFromRow,
  overrideFromRow,
  toPortable,
} from '@/lib/tempo/mappers';

/**
 * Everything, in one of two shapes.
 *
 * JSON by default: the database, legible without the app that produced it —
 * each event one object whose keys map 1:1 onto Obsidian frontmatter, category
 * resolved to its name, recurring events as their rule rather than thousands of
 * expanded occurrences.
 *
 * `?format=ics`: the calendar, for importing into another one. See `ics.ts` for
 * the one place the two disagree — derived titles.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [eventRows, categoryRows, overrideRows, courseRows, gradeRows] = await Promise.all([
    supabase.from('events').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('occurrence_overrides').select('*'),
    supabase.from('grade_courses').select('*').order('sort_order'),
    supabase.from('grade_items').select('*').order('sort_order'),
  ]);

  const failure = eventRows.error ?? categoryRows.error ?? overrideRows.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });

  const cats = new Map((categoryRows.data ?? []).map((c) => [c.id, categoryFromRow(c)]));
  const events = (eventRows.data ?? []).map(eventFromRow);
  const overrides = (overrideRows.data ?? []).map(overrideFromRow);
  const day = new Date().toISOString().slice(0, 10);

  if (request.nextUrl.searchParams.get('format') === 'ics') {
    return new NextResponse(
      toICS({ events, overrides, categories: [...cats.values()], now: new Date() }),
      {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': `attachment; filename="tempo-${day}.ics"`,
        },
      },
    );
  }

  // Grades ride along when their tables exist. Their migration is run by hand
  // after the code ships, and an export that broke until then would be the
  // calendar held hostage by a feature it does not depend on.
  const gradeItems = (gradeRows.data ?? []).map(gradeItemFromRow);
  const grades = courseRows.error
    ? undefined
    : (courseRows.data ?? []).map(gradeCourseFromRow).map((c) => ({
        ...c,
        name: (c.categoryId && cats.get(c.categoryId)?.name) || c.name,
        items: gradeItems.filter((i) => i.courseId === c.id),
      }));

  const payload = {
    format: 'tempo.export.v1',
    exportedAt: new Date().toISOString(),
    categories: [...cats.values()],
    events: events.map((e) =>
      toPortable(e, e.categoryId ? cats.get(e.categoryId)?.name : undefined),
    ),
    overrides,
    ...(grades ? { grades } : {}),
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="tempo-${day}.json"`,
    },
  });
}
