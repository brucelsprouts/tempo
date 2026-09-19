import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toICS } from '@/lib/tempo/ics';
import {
  categoryFromRow,
  eventFromRow,
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

  const [eventRows, categoryRows, overrideRows] = await Promise.all([
    supabase.from('events').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('occurrence_overrides').select('*'),
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

  const payload = {
    format: 'tempo.export.v1',
    exportedAt: new Date().toISOString(),
    categories: [...cats.values()],
    events: events.map((e) =>
      toPortable(e, e.categoryId ? cats.get(e.categoryId)?.name : undefined),
    ),
    overrides,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="tempo-${day}.json"`,
    },
  });
}
