-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 801: CKRI -- RETIRE ONE PUBLISHED VERSION WITHOUT RETIRING THE WHOLE RESOURCE
--
-- SQIE-LIBRARY-EXPANSION-01, owner GO 31 Oct 2026 (Scholar Release Decisions, item G). Owner GO to prepare and validate
-- on staging. Production application is a separate owner act. Build record: docs/evidence/SQIE-LIBRARY/800-802-build-record.md.
--
-- APPLY ON STAGING FIRST. ADDITIVE. One new append-only table (the retirement record), its guard, and one function.
-- No existing table, CHECK or function is changed: state retired and retired_at already exist on ckri_knowledge_version
-- (442), so no CHECK needs widening. No row is changed. Re-running it is a no-op. OPS-001 s8: proposed Low (additive),
-- with rollback SQL. DEPENDS ON 440 (ckri_holds_capability) and 442 (ckri_knowledge_version, ckri_knowledge_resource).
-- Independent of 800 and 802.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT DOES.
--
-- ckri_knowledge_retire_version(version, actor, reason) marks ONE published version retired, and nothing else:
--   - the actor must hold hq.quality.knowledge.publish (ckri_holds_capability, the 395 join), exactly as publication
--   - the reason is 10 to 500 characters, and is kept with who, when and whether it was the version learners were given
--   - only a version in state published is retired here (a draft or a submitted version is not published yet, and a
--     superseded one is already no longer given to learners)
--   - the resource stays active, and its other versions are untouched. If the retired version was the published one,
--     the resource has NO published version until a newer one is approved and published (442 ckri_knowledge_publish,
--     unchanged). A retired version can never be published again: 442 publishes only a submitted version.
--   - HISTORY STAYS. Nothing is deleted: learner copies (710 library_version_id), their attempts, rubric snapshots,
--     clinical review decisions and the audit trail keep pointing at the version. Scholar offers only published
--     versions (state published), so a retired one is never selected for a new activity, and a copy of it is no
--     longer served for new practice (library-questions.ts servableLibraryVersions).
--   Independence rules are unchanged (640 applies to publication, which this is not).
--
-- RLS: on for the new table, no policy. Execute on the function: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): RELEASE-2026-10-25/PENDING-31/ROLLBACK-801.sql drops the function and the table. It refuses while
--   any retirement is recorded (a retired version stays retired: that is the record).
-- ====================================================================================================


-- ---- 1. the record of each single-version retirement, append-only --------------------------------------

create table if not exists ckri_knowledge_version_retirement (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references ckri_knowledge_version(id) on delete cascade,
  resource_id  uuid not null references ckri_knowledge_resource(id) on delete cascade,
  version_no   integer not null,
  retired_by   uuid not null references profiles(id),
  reason       text not null,
  was_served   boolean not null,
  created_at   timestamptz not null default now()
);
alter table ckri_knowledge_version_retirement drop constraint if exists ckri_knowledge_version_retirement_check;
alter table ckri_knowledge_version_retirement add constraint ckri_knowledge_version_retirement_check
  check (char_length(btrim(reason)) between 10 and 500 and version_no >= 1);
create unique index if not exists ux_ckri_knowledge_version_retirement on ckri_knowledge_version_retirement(version_id);
create index if not exists idx_ckri_knowledge_version_retirement_resource on ckri_knowledge_version_retirement(resource_id, created_at desc);
alter table ckri_knowledge_version_retirement enable row level security;

create or replace function public.ckri_knowledge_version_retirement_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('competen.ckri_knowledge', true), '') <> 'on' then
      raise exception 'ckri_knowledge_version_retirement: written only by ckri_knowledge_retire_version';
    end if;
    new.created_at := now();
    return new;
  end if;
  raise exception 'ckri_knowledge_version_retirement is append-only';
end;
$$;
drop trigger if exists ckri_knowledge_version_retirement_guard on ckri_knowledge_version_retirement;
create trigger ckri_knowledge_version_retirement_guard before insert or update or delete on ckri_knowledge_version_retirement
  for each row execute function public.ckri_knowledge_version_retirement_guard();


-- ---- 2. retire one published version ---------------------------------------------------------------------

create or replace function public.ckri_knowledge_retire_version(p_version uuid, p_actor uuid, p_reason text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v ckri_knowledge_version%rowtype;
begin
  select * into v from ckri_knowledge_version where id = p_version for update;
  if not found then raise exception 'ckri_knowledge_retire_version: unknown version'; end if;
  perform 1 from ckri_knowledge_resource where id = v.resource_id for update;
  if p_actor is null or not ckri_holds_capability(p_actor, 'hq.quality.knowledge.publish') then
    raise exception 'ckri_knowledge_retire_version: not authorised. Retiring a version needs hq.quality.knowledge.publish';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception 'ckri_knowledge_retire_version: give the reason, 10 to 500 characters';
  end if;
  if v.state <> 'published' then
    raise exception 'ckri_knowledge_retire_version: only a published version is retired here (this one is %)', v.state;
  end if;
  perform set_config('competen.ckri_knowledge', 'on', true);
  update ckri_knowledge_version set state = 'retired', retired_at = now() where id = v.id;
  insert into ckri_knowledge_version_retirement (version_id, resource_id, version_no, retired_by, reason, was_served)
    values (v.id, v.resource_id, v.version_no, p_actor, btrim(p_reason), true);
  perform set_config('competen.ckri_knowledge', 'off', true);
end;
$$;

revoke all on function public.ckri_knowledge_retire_version(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ckri_knowledge_retire_version(uuid, uuid, text) to service_role;

comment on table ckri_knowledge_version_retirement is
  'SQIE-LIBRARY-EXPANSION-01 (801). One row per single published version retired by ckri_knowledge_retire_version: who, when, why, and whether learners were given it. Append-only. The resource stays active and every historical reference to the version stays.';

notify pgrst, 'reload schema';
