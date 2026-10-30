-- Tempo — grades: dropping a course's lowest marks
--
-- Run this once in the Supabase SQL editor, before deploying the version that
-- reads it: that version writes `drops` whenever a course is added or edited.
-- Idempotent: running it twice is harmless.
--
-- A map of type to how many of its lowest marks do not count, `{"quiz": 1}`.
-- On the course rather than the items because it is a rule about a group, and
-- the group is only ever as real as the items that currently share a type.
--
-- `grade_courses.target` is no longer read by the app. It stays so a value
-- someone typed is not lost to a change of layout.

alter table public.grade_courses
  add column if not exists drops jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
