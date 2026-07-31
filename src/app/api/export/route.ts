import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  categoryFromRow,
  eventFromRow,
  overrideFromRow,
  toPortable,
} from '@/lib/tempo/mappers';

/**
 * Everything, in a flat human-readable shape.
 *
 * The point is that this file is legible without the app that produced it —
 * each event is one object whose keys map 1:1 onto Obsidian frontmatter, with
 * category resolved to its name rather than a foreign key. Recurring events
 * export as their rule, not as thousands of expanded occurrences.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [events, categories, overrides] = await Promise.all([
    supabase.from('events').select('*'),
    supabase.from('categories').select('*'),
    supabase.from('occurrence_overrides').select('*'),
  ]);

  const failure = events.error ?? categories.error ?? overrides.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });

  const cats = new Map((categories.data ?? []).map((c) => [c.id, categoryFromRow(c)]));

  const payload = {
    format: 'tempo.export.v1',
    exportedAt: new Date().toISOString(),
    categories: [...cats.values()],
    events: (events.data ?? [])
      .map(eventFromRow)
      .map((e) => toPortable(e, e.categoryId ? cats.get(e.categoryId)?.name : undefined)),
    overrides: (overrides.data ?? []).map(overrideFromRow),
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="tempo-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
