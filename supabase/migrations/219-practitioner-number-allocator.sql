-- ============================================================
-- MIGRATION 219: PRACTITIONER NUMBER ALLOCATOR (PIS-000 s2)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- "PERMANENT, NEVER REUSED" IS A PROPERTY ONLY A SEQUENCE HAS.
--
-- Migration 218 created practice_practitioner_number_seq, but PostgREST exposes no nextval, so the
-- engine had to fall back to max(practitioner_number) + 1 with a retry on the unique index. That is
-- correct under CONCURRENCY -- the index settles the race and the retry takes the next number -- but it
-- is wrong about REUSE: delete identity CPR-000005 and the maximum drops to 4, so the next practitioner
-- issued is handed 000005 again. A number that once meant one clinician now means another, on cards and
-- QR codes already printed.
--
-- This function is the allocator. Plain SQL, not plpgsql, and its body contains NO SEMICOLON -- so it
-- survives a migration runner that splits on ';', which is the constraint every file here is written to.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function practice_next_practitioner_number() returns text
language sql
security definer
set search_path = public
as $$ select 'CPR-' || lpad(nextval('practice_practitioner_number_seq')::text, 6, '0') $$;

-- The sequence must not be behind any number already issued, or the first call collides. Idempotent and
-- safe to re-run: setval to the highest existing number, or 1 when there are none.
select setval('practice_practitioner_number_seq',
  greatest(1, coalesce((select max(nullif(regexp_replace(practitioner_number, '\D', '', 'g'), '')::bigint)
                        from practice_practitioner_identity), 0)), true);

notify pgrst, 'reload schema';
