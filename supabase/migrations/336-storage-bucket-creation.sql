-- Migration 336: create the three storage buckets
--
-- ============================ WHY THIS EXISTS ============================
--
-- NO MIGRATION HAS EVER CREATED A STORAGE BUCKET. The three buckets in production were made by hand in
-- the dashboard. 334 configures two of them with `update storage.buckets`, which on a fresh project
-- matches zero rows and silently does nothing -- an update against an absent row is not an error.
--
-- Found by the clean-build pre-flight on 2026-08-19: the full chain applied to an empty project and
-- produced 663 tables, 318 policies, 67 functions, 45 triggers -- and ZERO buckets. Every count that
-- any instrument was watching matched production, and the storage estate was still entirely absent.
--
-- COMP-ENG-002E section 8 requires the fidelity manifest to check storage, and it would have failed on
-- `bucket "avatars" is absent`. That failure would have been correct. This file is the fix.
--
-- ============================ POSTURE, MEASURED NOT ASSUMED ============================
--
-- Every value below was read from live production immediately before this file was written. avatars
-- and practice-attachments carry the posture migration 334 set and verified. evidence was already in
-- that state and 002D deliberately set no new decision about it.
--
-- ============================ ON CONFLICT DO NOTHING, DELIBERATELY ============================
--
-- !! NOT `do update`. On production all three rows exist, so this file must be a no-op there, and a
-- migration that rewrites live bucket configuration to values an agent measured is exactly the shape of
-- change that went wrong earlier in this arc -- see COMP-ENG-002G. Existing buckets keep whatever
-- configuration they have.
--
-- CONFIGURATION FOR avatars AND practice-attachments THEREFORE REMAINS 334's JOB, not this file's. This
-- file only guarantees the rows EXIST, so that 334's updates have something to act on in a clean build.
-- On a fresh project 334 runs first and matches nothing, then this file inserts the final values
-- directly -- which is why the values here are the post-334 posture rather than any earlier one.
--
-- evidence has no configuring migration at all. Its posture is created here and is otherwise unmanaged.
--
-- ============================ WHAT THIS DOES NOT DO ============================
--
-- !! NO STORAGE POLICIES ARE CREATED. The approved posture is server-mediated with NONE -- COMP-ENG-002D
-- section 5 -- and production carries zero storage policies, confirmed by plat_storage_policy_registry.
-- Access is brokered by the application through the service role, not by RLS on storage.objects.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'practice-attachments', 'practice-attachments', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence', 'evidence', false, 52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/wav',
    'audio/ogg'
  ]
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
