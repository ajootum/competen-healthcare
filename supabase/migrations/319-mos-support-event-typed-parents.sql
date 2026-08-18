-- CPR-PD-009 correction - the support trail gets real parents, so it can be cascaded away.
--
-- APPLY THIS FILE WHOLE. It drops and recreates a plpgsql trigger with a dollar-quoted body.
--
-- WHAT WENT WRONG
--
-- Migration 318 gave the five record types ONE shared lifecycle trail, keyed by a record_type word and
-- a record_id uuid. That is a polymorphic reference, and it has no foreign key - so when a support case
-- is deleted, nothing cascades to its trail. The trail is also append only, which refuses a direct
-- DELETE. Between the two, A TRAIL ROW COULD NEVER BE REMOVED BY ANYBODY, EVER.
--
-- Migration 316 fixed the same shape on the incident trail by allowing a DELETE that arrives from a
-- cascade. That fix cannot help here, because there is no parent to cascade FROM. This is the fourth
-- time in this build that a cleanup has been blocked by an immutability rule with no withdrawal path,
-- and the answer this time is structural rather than another allowance: give the trail real parents.
--
-- WHAT CHANGES
--
-- record_id becomes five nullable foreign keys, exactly one of which must be set. Deleting a case now
-- cascades to its trail rows and the depth rule from 316 lets that cascade through. record_type stays
-- because it is what the module reads and what makes a row legible on its own, and a CHECK keeps it
-- honest against whichever key is populated - a row cannot say "case" and point at a problem.
--
-- NOTE  THE ONE EXISTING ROW IS AN ORPHAN AND IS REMOVED. It was written by the acceptance harness
-- against a case that no longer exists, so there is no parent to attach it to and nothing to preserve.
-- The trigger is dropped for that single statement and restored immediately after, which is the only
-- honest way to remove a row from a table whose whole point is that rows cannot be removed.

drop trigger if exists trg_mos_support_event_immutable on mos_support_event;

delete from mos_support_event;

alter table mos_support_event add column if not exists case_id uuid references mos_support_case(case_id) on delete cascade;
alter table mos_support_event add column if not exists problem_id uuid references mos_problem(problem_id) on delete cascade;
alter table mos_support_event add column if not exists escalation_id uuid references mos_escalation(escalation_id) on delete cascade;
alter table mos_support_event add column if not exists postmortem_id uuid references mos_postmortem(postmortem_id) on delete cascade;
alter table mos_support_event add column if not exists action_id uuid references mos_corrective_action(action_id) on delete cascade;

alter table mos_support_event drop column if exists record_id;

-- exactly one parent, and it must agree with the record_type the row declares
alter table mos_support_event drop constraint if exists mos_support_event_one_parent;
alter table mos_support_event
  add constraint mos_support_event_one_parent
  check (
    (case when case_id is not null then 1 else 0 end)
    + (case when problem_id is not null then 1 else 0 end)
    + (case when escalation_id is not null then 1 else 0 end)
    + (case when postmortem_id is not null then 1 else 0 end)
    + (case when action_id is not null then 1 else 0 end) = 1
  );

alter table mos_support_event drop constraint if exists mos_support_event_type_matches_parent;
alter table mos_support_event
  add constraint mos_support_event_type_matches_parent
  check (
    (record_type = 'case' and case_id is not null)
    or (record_type = 'problem' and problem_id is not null)
    or (record_type = 'escalation' and escalation_id is not null)
    or (record_type = 'postmortem' and postmortem_id is not null)
    or (record_type = 'corrective_action' and action_id is not null)
  );

drop index if exists idx_mos_support_event_record;
create index if not exists idx_mos_support_event_case on mos_support_event (case_id, at);
create index if not exists idx_mos_support_event_problem on mos_support_event (problem_id, at);
create index if not exists idx_mos_support_event_action on mos_support_event (action_id, at);

create or replace function mos_support_event_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'mos_support_event is append only. % refused on support event %', tg_op, old.id;
end;
$$;

create trigger trg_mos_support_event_immutable
  before update or delete on mos_support_event
  for each row execute function mos_support_event_immutable();

notify pgrst, 'reload schema';
