-- Tempo — grades: courses and their weighted items
--
-- Run this once in the Supabase SQL editor, alongside deploying the version
-- that introduced GRADES. Idempotent: running it twice is harmless.
--
-- Nothing else waits for it. Without these tables the GRADES tab says this
-- file needs running and the rest of the calendar is untouched; the export and
-- the backup script skip the tables while they are missing.
--
-- Two tables rather than items hung straight off `categories`, because a
-- course has things of its own — notes, a target — and because a course is
-- not always a category. Deleting a category sets `category_id` null and
-- leaves the course and every mark in it standing under the name it was
-- created with: a term of marks is not something a tidy-up of the colour list
-- should be able to take.

create table if not exists public.grade_courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null default '',
  notes text not null default '',
  target numeric(5, 2) check (target is null or (target >= 0 and target <= 100)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, category_id)
);

create table if not exists public.grade_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.grade_courses(id) on delete cascade,
  name text not null default '',
  section text not null default '',
  -- Percentage points of the final grade.
  weight numeric(5, 2) not null default 0 check (weight >= 0 and weight <= 100),
  -- A mark is points out of a total; one typed as a percentage is out of 100.
  -- Both or neither, so "no mark yet" has one spelling.
  earned numeric(8, 2) check (earned is null or earned >= 0),
  out_of numeric(8, 2) check (out_of is null or out_of > 0),
  notes text not null default '',
  -- Reserved for linking an item to the entry it is due on. Nothing reads it
  -- yet; it is here so that feature does not need a migration of its own.
  event_id uuid references public.events(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((earned is null) = (out_of is null))
);

create index if not exists grade_courses_owner_idx on public.grade_courses using btree (owner_id);
create index if not exists grade_items_course_idx on public.grade_items using btree (course_id, sort_order);

drop trigger if exists grade_courses_touch on public.grade_courses;
create trigger grade_courses_touch before update on public.grade_courses
  for each row execute function public.set_updated_at();

drop trigger if exists grade_items_touch on public.grade_items;
create trigger grade_items_touch before update on public.grade_items
  for each row execute function public.set_updated_at();

alter table public.grade_courses enable row level security;
alter table public.grade_items   enable row level security;

drop policy if exists owner_all on public.grade_courses;
create policy owner_all on public.grade_courses for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists owner_all on public.grade_items;
create policy owner_all on public.grade_items for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
