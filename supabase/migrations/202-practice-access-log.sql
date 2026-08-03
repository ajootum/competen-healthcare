-- ============================================================
-- MIGRATION 202: SECURITY, PRIVACY AND PRACTITIONER CONTROL (CPR-370)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THIS PRODUCT RECORDS EVERYTHING THAT WAS WRITTEN AND NOTHING ABOUT WHO READ, AND THAT IS BACKWARDS.
--
-- practice_audit_event has captured every write since Phase 0 -- encounters launched, documents signed,
-- follow-ups closed. Nothing has ever recorded a READ. But for a clinical record the harm is almost
-- always a read: the staff member who looks up a neighbour, an ex-partner, somebody in the news. A
-- practice cannot answer "who has opened this person's record" today, and that is the single question a
-- patient is most entitled to ask.
--
-- So this migration adds the other half of the trail.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- WHAT IS LOGGED, AND WHAT DELIBERATELY IS NOT. Opening a patient record, a consultation or a document;
-- running a search; exporting. NOT every page view -- the home page and the diary are the practitioner's
-- own working surface, and logging them buries the reads that matter under the reads that do not. A log
-- nobody can read is a log nobody reads.
--
-- SELF-ACCESS IS STILL LOGGED. A practitioner opening their own patient's record is entirely normal and
-- entirely uninteresting -- and excluding it would make the log unable to answer "who has opened this"
-- at all. The signal comes from reviewing the log, not from filtering it at write time.
--
-- THE LOG MUST NEVER BLOCK A CLINICIAN. If the log write fails, the page still renders: patient safety
-- beats audit completeness, and a doctor staring at an error while a patient waits is the worse harm.
-- But the gap must not be SILENT -- a failed log write is recorded in practice_audit_event, so "the
-- trail has a hole here" is visible rather than assumed. Both halves of that trade are deliberate.
--
-- RETENTION IS NOT SET HERE, AND THAT IS NAMED RATHER THAN GUESSED. How long a clinical access log is
-- kept is a legal and policy question with a different answer in every jurisdiction this product might
-- run in, and inventing "two years" in a migration would be a compliance claim nobody authorised.
-- Nothing deletes from this table yet. When a retention policy exists it will be a decision with a
-- specification behind it.
--
-- >>> APPLY THIS FILE AS A WHOLE (Supabase SQL editor), NOT THROUGH A SEMICOLON SPLITTER. <<<
-- Section 3's trigger function is plpgsql with internal semicolons inside $$ ... $$.
--
-- >>> RE-RUN THIS FILE IF YOU APPLIED THE FIRST VERSION. <<< Section 3's trigger refused the workspace
-- cascade, which made a practice undeletable; the function is `create or replace` and every other
-- statement is idempotent, so re-running is safe and is the whole fix.
--
-- Plain idempotent statements, ASCII only, no do-blocks.
-- ============================================================

-- ---- 1. practice_access_log --------------------------------------------------------------------------

create table if not exists practice_access_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  actor_id uuid not null,

  -- WHAT WAS REACHED FOR. `search` and `access_review` carry no subject id -- they are reads across the
  -- practice rather than of one record, and that is precisely why they are logged.
  subject_kind text not null
    check (subject_kind in ('patient', 'encounter', 'document', 'incoming_document',
                            'search', 'export', 'access_review')),
  subject_id uuid,

  -- DENORMALISED ON PURPOSE, and it is the column the whole table exists for: "who has opened this
  -- person's record" must be one index scan, not a join through three tables whose rows may since have
  -- been merged or archived. Nullable because a search is not about one patient.
  patient_id uuid references practice_patient(id) on delete set null,

  action text not null default 'view' check (action in ('view', 'search', 'export', 'review')),
  -- Where in the app, and what was asked for. `detail` holds a search TERM -- which is itself sensitive,
  -- because "who searched for this surname" is a question worth being able to answer.
  route text,
  detail text,
  correlation_id text,
  occurred_at timestamptz not null default now()
);

-- The two questions this table answers. Both need their own index; neither is a filter on the other.
create index if not exists idx_practice_access_patient
  on practice_access_log(workspace_id, patient_id, occurred_at desc) where patient_id is not null;
create index if not exists idx_practice_access_actor
  on practice_access_log(workspace_id, actor_id, occurred_at desc);
create index if not exists idx_practice_access_recent
  on practice_access_log(workspace_id, occurred_at desc);

-- ---- 2. Capability -----------------------------------------------------------------------------------
--
-- access.review, and it is NOT given to the owner by default. That looks inconsistent -- reviewing
-- access is administrative, and the owner is the administrator -- and it is the deliberate reading of
-- migration 191's boundary:
--
--   AN ACCESS LOG IS A LIST OF WHO YOUR PATIENTS ARE. Every row names a person who attends this
--   practice. An owner deliberately given no patient.view could otherwise read the whole registry out
--   of the audit trail, one row at a time, and the reviewer of a privacy control must not be its
--   easiest bypass.
--
-- The engine handles this precisely rather than bluntly: an owner CAN hold access.review if a practice
-- grants it, and what they see is de-identified -- patient references, not names -- unless they also
-- hold patient.view. So the compliance function works without becoming a back door.

insert into practice_role_capabilities (role_code, capability_code) values
  ('practitioner', 'access.review'),
  ('practitioner', 'data.export')
on conflict (role_code, capability_code) do nothing;

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

-- ---- 3. The log cannot be rewritten ------------------------------------------------------------------
--
-- The strongest version of the rule that governs every trail in this schema, because this one exists to
-- be used against whoever can edit it. UPDATE and DELETE are both refused: an access log somebody can
-- prune is worth less than none at all, since its emptiness would read as innocence.
--
-- ⚠️ A BEFORE DELETE TRIGGER FIRES ON CASCADE DELETES TOO, and the first version of this file did not
-- account for that. It carried a comment claiming "the workspace cascade still deletes these rows with
-- their workspace" -- which was simply false. The trigger refused the cascade, so `delete from
-- practice_workspace` failed, and A PRACTICE COULD NEVER BE DELETED AT ALL. The harness caught it the
-- indirect way these things usually surface: cleanup stopped working and the next run found duplicate
-- patients from the previous one.
--
-- The fix distinguishes the two acts precisely. During a workspace cascade the parent row is already
-- gone by the time this fires, so `the workspace no longer exists` means "the practice is leaving
-- entirely" and the delete is allowed. A targeted delete while the workspace is still there is somebody
-- pruning the log, and stays refused.

create or replace function practice_access_log_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from practice_workspace w where w.id = old.workspace_id)
  then
    return old;
  end if;
  raise exception 'the access log is append-only; entry % cannot be changed or removed', old.id;
end;
$$;

drop trigger if exists trg_practice_access_log_no_update on practice_access_log;
create trigger trg_practice_access_log_no_update
  before update on practice_access_log
  for each row execute function practice_access_log_immutable();

drop trigger if exists trg_practice_access_log_no_delete on practice_access_log;
create trigger trg_practice_access_log_no_delete
  before delete on practice_access_log
  for each row execute function practice_access_log_immutable();

-- ---- 4. RLS: deny-by-default -------------------------------------------------------------------------

alter table practice_access_log enable row level security;

notify pgrst, 'reload schema';
