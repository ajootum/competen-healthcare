-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and sql functions between dollar quotes and a do-block. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 751: STABLE LEARNING-OUTCOME IDS, EVIDENCE BOUND TO THEM, AND REORDERING IS NOT AUTHORSHIP
--
-- FRAMEWORK-DESIGN-STUDIO-01 slice A (owner GO 31 Oct 2026, rulings 1, 4 and 5).
-- Build record: docs/evidence/FRAMEWORK-DESIGN-STUDIO/751-build-record.md
--
-- APPLY ON STAGING FIRST, AFTER 750 (no hard dependency, 750 and 751 are independent, but they ship together).
-- ADDITIVE, with a backfill of derived columns. Re-running it is a no-op. OPS-001 s8: proposed Medium (new
-- triggers on shared tables, one existing function replaced), so it carries a staging rollback rehearsal.
-- Depends on 384 (learning_outcomes), 395 + 640 (clinical review, clinical_review_decision_sod_guard), 510 + 680
-- + 690 (verification request and evidence and their guards). A later migration that replaces
-- clinical_review_decision_sod_guard must start from THIS file.
--
-- ----------------------------------------------------------------------------------------------------
-- 1. A STABLE ID FOR EVERY LEARNING OUTCOME (ruling 5).
--    framework_competencies.learning_outcome_ids  json array of uuid strings, one per learning outcome, in the same
--    order. Maintained ONLY by the trigger framework_competencies_outcome_ids, never by a writer.
--      On insert every outcome gets a new id.
--      On a change of learning_outcomes each new outcome, in order, takes the id of the first not yet used old
--      outcome with exactly the same text, else a new id. So a reorder moves each id with its text, an edit
--      mints a new id only for the outcome whose text changed, and duplicates are matched in order of occurrence.
--      A write of the ids alone is refused.
--    The ids are NOT in competency_content_hash (670 unchanged). Outcome order and wording stay in the hash, so
--    reordering outcomes is still a clinical change (ruling 1).
--
-- 2. EVIDENCE NAMES OUTCOMES BY ID, AND HISTORY IS SELF-CONTAINED.
--    competency_verification_request.outcome_map   json array of objects with keys id and text, the outcomes
--      of the competency when the request was made, in that order (the order of competency_snapshot).
--    competency_verification_request.outcome_ids   uuid array, one per outcome_indexes entry.
--    competency_verification_evidence.outcome_ids  uuid array, one per outcome_indexes entry.
--    An index of -1 means the competency as a whole and its id is the nil uuid 00000000-0000-0000-0000-000000000000.
--    Any other index is a position in the outcome_map of the request (the evidence of a request uses the
--    request map, as the app already resolves evidence against the request snapshot).
--    The triggers fill them at insert. A writer may send outcome_ids, and then they must agree with the indexes
--    or the insert is refused. An index outside the map is refused. Stored ids are never rewritten, so a later
--    reorder or edit of the live competency never changes what old evidence pointed at.
--    A reader resolves an id to its words through the outcome_map of the request, never the live competency.
--
-- 3. BACKFILL. Every competency gets ids. Every existing request gets its map from its own stored snapshot (the
--    live outcomes if a snapshot is missing), each outcome taking the live id of the same text where one
--    exists, else a new id. Its ids and those of its evidence then come from its indexes against that map. The
--    510 and 680 append-only guards are paused for that update only, inside this transaction, and only when a
--    row needs it (production has none).
--
-- 4. F4: A REORDER IS CONTRIBUTION, NOT AUTHORSHIP (ruling 4). The audit action reorder_layout records a
--    presentation-only order change (direct reorder of a never-published draft, saving or clearing a layout
--    draft). clinical_review_decision_sod_guard (640) now leaves it out of authorship, so a person who only
--    reordered may still clinically review content they did not author. frameworks_sod_publication_guard (640)
--    is NOT changed: it already counts every action outside its governance list, so reorder_layout counts as
--    contribution and its author cannot publish the layout. The 395 and 690 clinical_review_decision_guard reads
--    authored_by on the version, which the app computes (authorsOf, slice B), so it is unchanged here.
--    The rest of the guard is byte for byte the 640 body (diff in the build record).
--
-- NOT ACTIVATED. No outcome text, order or approval changes. Nothing is reviewed, published or offered.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/FRAMEWORK-DESIGN-STUDIO/ROLLBACK-751.sql
-- ====================================================================================================


-- ---- 1. stable outcome ids on the competency --------------------------------------------------------

-- Valid ids for a list of outcomes: one uuid string each, none nil, none repeated.
create or replace function public.competency_outcome_ids_valid(p_ids jsonb, p_outcomes jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case when jsonb_typeof(p_ids) is distinct from 'array' or jsonb_typeof(p_outcomes) is distinct from 'array' then false
              else jsonb_array_length(p_ids) = jsonb_array_length(p_outcomes)
               and not exists (select 1 from jsonb_array_elements(p_ids) e
                                where jsonb_typeof(e) <> 'string'
                                   or (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                   or (e #>> '{}') = '00000000-0000-0000-0000-000000000000')
               and (select count(distinct e) from jsonb_array_elements(p_ids) e) = jsonb_array_length(p_ids)
         end
$$;

-- The ids for p_new, carried from p_old where the text is the same (first unused match, in order), else new.
create or replace function public.competency_outcome_ids_match(p_new jsonb, p_old jsonb, p_old_ids jsonb)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_catalog
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_used integer[] := '{}';
  v_old jsonb := coalesce(p_old, '[]'::jsonb);
  v_n_old integer;
  v_j integer;
  i integer;
begin
  if jsonb_typeof(coalesce(p_new, '[]'::jsonb)) <> 'array' then
    raise exception 'learning outcomes are a list';
  end if;
  -- Ids that do not line up with their outcomes are not trusted: every outcome is then new.
  if p_old_ids is null or jsonb_typeof(v_old) <> 'array' or not public.competency_outcome_ids_valid(p_old_ids, v_old) then
    v_old := '[]'::jsonb;
  end if;
  v_n_old := jsonb_array_length(v_old);
  for i in 0 .. jsonb_array_length(coalesce(p_new, '[]'::jsonb)) - 1 loop
    select min(p) into v_j from generate_series(0, v_n_old - 1) p
     where v_old -> p = p_new -> i and not (p = any(v_used));
    if v_j is not null then
      v_used := v_used || v_j;
      v_out := v_out || jsonb_build_array(p_old_ids -> v_j);
    else
      v_out := v_out || jsonb_build_array(gen_random_uuid()::text);
    end if;
  end loop;
  return v_out;
end;
$$;

alter table framework_competencies add column if not exists learning_outcome_ids jsonb;

create or replace function public.framework_competencies_outcome_ids()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and new.learning_outcomes is not distinct from old.learning_outcomes and old.learning_outcome_ids is not null
     and public.competency_outcome_ids_valid(old.learning_outcome_ids, old.learning_outcomes) then
    if new.learning_outcome_ids is distinct from old.learning_outcome_ids then
      raise exception 'framework_competencies.learning_outcome_ids: outcome ids are kept by the database. Change the learning outcomes instead';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.learning_outcome_ids := public.competency_outcome_ids_match(new.learning_outcomes, null, null);
  else
    new.learning_outcome_ids := public.competency_outcome_ids_match(new.learning_outcomes, old.learning_outcomes, old.learning_outcome_ids);
  end if;
  return new;
end;
$$;

drop trigger if exists framework_competencies_outcome_ids on framework_competencies;
create trigger framework_competencies_outcome_ids
  before insert or update of learning_outcomes, learning_outcome_ids on framework_competencies
  for each row execute function public.framework_competencies_outcome_ids();

-- Backfill: the trigger mints the ids of every competency that has none.
update framework_competencies set learning_outcome_ids = null where learning_outcome_ids is null;

alter table framework_competencies alter column learning_outcome_ids set not null;
alter table framework_competencies drop constraint if exists framework_competencies_learning_outcome_ids_check;
alter table framework_competencies add constraint framework_competencies_learning_outcome_ids_check
  check (public.competency_outcome_ids_valid(learning_outcome_ids, learning_outcomes));


-- ---- 2. verification evidence names outcomes by id ----------------------------------------------------

-- The outcomes of a competency at one moment, with their ids: a list of {id, text}.
create or replace function public.competency_outcome_map(p_texts jsonb, p_ids jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p_ids -> (o.n - 1)::integer, 'text', o.t) order by o.n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_texts, '[]'::jsonb)) with ordinality as o(t, n)
$$;

-- The ids of positions in a map. -1 is the competency as a whole (the nil uuid). Outside the map is refused.
create or replace function public.competency_outcome_ids_of(p_indexes integer[], p_map jsonb)
returns uuid[]
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v_out uuid[] := '{}';
  i integer;
begin
  foreach i in array coalesce(p_indexes, '{}') loop
    if i = -1 then
      v_out := v_out || '00000000-0000-0000-0000-000000000000'::uuid;
    elsif i is null or i < -1 or i >= jsonb_array_length(coalesce(p_map, '[]'::jsonb)) or (p_map -> i ->> 'id') is null then
      raise exception 'competency verification: learning outcome % is not one of this competency as the request recorded it', i;
    else
      v_out := v_out || (p_map -> i ->> 'id')::uuid;
    end if;
  end loop;
  return v_out;
end;
$$;

alter table competency_verification_request add column if not exists outcome_map jsonb;
alter table competency_verification_request add column if not exists outcome_ids uuid[];
alter table competency_verification_evidence add column if not exists outcome_ids uuid[];

-- A request: its outcome map from the competency as it is at this moment (the 510 guard has just taken the same
-- outcomes into competency_snapshot), and its ids from its indexes. Runs after the 510 and 690 request guards.
create or replace function public.competency_verification_request_outcome_ids()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_texts jsonb;
  v_ids jsonb;
  v_map jsonb;
  v_out uuid[];
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;
  select c.learning_outcomes, c.learning_outcome_ids into v_texts, v_ids from framework_competencies c where c.id = new.competency_id;
  if not found then
    raise exception 'competency_verification_request: unknown competency';
  end if;
  if new.competency_snapshot ? 'learning_outcomes' and (new.competency_snapshot -> 'learning_outcomes') is distinct from v_texts then
    raise exception 'competency_verification_request: the learning outcomes changed while the request was being made. Ask again';
  end if;
  v_map := public.competency_outcome_map(v_texts, v_ids);
  v_out := public.competency_outcome_ids_of(new.outcome_indexes, v_map);
  if new.outcome_ids is not null and new.outcome_ids is distinct from v_out then
    raise exception 'competency_verification_request: the learning outcome ids do not match the outcomes named by position';
  end if;
  new.outcome_map := v_map;
  new.outcome_ids := v_out;
  return new;
end;
$$;

drop trigger if exists competency_verification_request_outcome_ids on competency_verification_request;
create trigger competency_verification_request_outcome_ids
  before insert on competency_verification_request
  for each row execute function public.competency_verification_request_outcome_ids();

-- Evidence: its ids from its indexes against the map of its request, never rewritten. Runs after the 680 guard.
create or replace function public.competency_verification_evidence_outcome_ids()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_map jsonb;
  v_out uuid[];
begin
  if tg_op = 'UPDATE' then
    if old.outcome_ids is not null and new.outcome_ids is distinct from old.outcome_ids then
      raise exception 'competency_verification_evidence: the learning outcomes evidence was submitted against are never rewritten';
    end if;
    return new;
  end if;
  select r.outcome_map into v_map from competency_verification_request r where r.id = new.request_id and r.user_id = new.user_id;
  if not found then
    -- The request foreign key refuses it.
    return new;
  end if;
  if v_map is null then
    raise exception 'competency_verification_evidence: the request has no learning outcome map';
  end if;
  v_out := public.competency_outcome_ids_of(new.outcome_indexes, v_map);
  if new.outcome_ids is not null and new.outcome_ids is distinct from v_out then
    raise exception 'competency_verification_evidence: the learning outcome ids do not match the outcomes named by position';
  end if;
  new.outcome_ids := v_out;
  return new;
end;
$$;

drop trigger if exists competency_verification_evidence_outcome_ids on competency_verification_evidence;
create trigger competency_verification_evidence_outcome_ids
  before insert or update on competency_verification_evidence
  for each row execute function public.competency_verification_evidence_outcome_ids();

-- Backfill: each existing request from its own snapshot, then its evidence. The append-only guards are paused for
-- this one update, in this transaction, only when a row needs it.
do $backfill$
declare
  r record;
  v_live_t jsonb;
  v_live_i jsonb;
  v_texts jsonb;
  v_map jsonb;
begin
  if not exists (select 1 from competency_verification_request where outcome_map is null or outcome_ids is null)
     and not exists (select 1 from competency_verification_evidence where outcome_ids is null) then
    return;
  end if;
  alter table competency_verification_request disable trigger competency_verification_request_guard;
  alter table competency_verification_evidence disable trigger competency_verification_evidence_guard;
  for r in select * from competency_verification_request where outcome_map is null or outcome_ids is null order by created_at, id loop
    select c.learning_outcomes, c.learning_outcome_ids into v_live_t, v_live_i from framework_competencies c where c.id = r.competency_id;
    v_texts := coalesce(r.competency_snapshot -> 'learning_outcomes', v_live_t, '[]'::jsonb);
    v_map := public.competency_outcome_map(v_texts, public.competency_outcome_ids_match(v_texts, v_live_t, v_live_i));
    update competency_verification_request
       set outcome_map = v_map, outcome_ids = public.competency_outcome_ids_of(r.outcome_indexes, v_map)
     where id = r.id;
  end loop;
  update competency_verification_evidence e
     set outcome_ids = public.competency_outcome_ids_of(e.outcome_indexes, q.outcome_map)
    from competency_verification_request q
   where q.id = e.request_id and q.user_id = e.user_id and e.outcome_ids is null;
  alter table competency_verification_request enable trigger competency_verification_request_guard;
  alter table competency_verification_evidence enable trigger competency_verification_evidence_guard;
end
$backfill$;

alter table competency_verification_request alter column outcome_map set not null;
alter table competency_verification_request alter column outcome_ids set not null;
alter table competency_verification_evidence alter column outcome_ids set not null;

alter table competency_verification_request drop constraint if exists competency_verification_request_outcome_ids_check;
alter table competency_verification_request add constraint competency_verification_request_outcome_ids_check check (
  jsonb_typeof(outcome_map) = 'array'
  and cardinality(outcome_ids) = cardinality(outcome_indexes)
  and array_position(outcome_ids, null) is null
);
alter table competency_verification_evidence drop constraint if exists competency_verification_evidence_outcome_ids_check;
alter table competency_verification_evidence add constraint competency_verification_evidence_outcome_ids_check check (
  cardinality(outcome_ids) = cardinality(outcome_indexes)
  and array_position(outcome_ids, null) is null
);

comment on column framework_competencies.learning_outcome_ids is
  '751: one stable uuid per learning outcome, same order. Kept by the database (trigger framework_competencies_outcome_ids). Not in the content hash.';
comment on column competency_verification_request.outcome_map is
  '751: the competency outcomes when the request was made, [{id, text}] in snapshot order. Resolve outcome ids of the request and its evidence here.';
comment on column competency_verification_request.outcome_ids is
  '751: stable outcome ids, one per outcome_indexes entry. The nil uuid = the competency as a whole (-1).';
comment on column competency_verification_evidence.outcome_ids is
  '751: stable outcome ids, one per outcome_indexes entry, against the request outcome_map. The nil uuid = the competency as a whole.';


-- ---- 3. F4: a reorder is contribution, not authorship (the 640 body plus reorder_layout) -------------------

create or replace function public.clinical_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v clinical_content_version%rowtype;
  v_conflict boolean := false;
  v_parent uuid;
begin
  select * into v from clinical_content_version where id = new.version_id;
  if not found then
    return new;
  end if;
  -- Every version of the same subject, whatever was recorded on this one.
  v_conflict := exists (
    select 1 from clinical_content_version o
     where (new.reviewer_id = o.submitted_by or new.reviewer_id = any(o.authored_by))
       and ((v.content_kind = 'competency' and o.competency_id = v.competency_id)
         or (v.content_kind = 'case' and o.case_version_id in (select cv.id from case_library_version cv
               where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)))
         or (v.content_kind = 'resource' and o.knowledge_version_id in (select kv.id from ckri_knowledge_version kv
               where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)))
         or (v.content_kind = 'learning' and o.learning_version_id in (select lv.id from learning_offering_version lv
               where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)))));

  if not v_conflict and v.content_kind = 'competency' then
    -- The audit trail of the competency and its framework, as authorsOf reads it (src/lib/competency/clinical-review.ts).
    select d.framework_id into v_parent from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = v.competency_id;
    v_conflict := exists (
      select 1 from audit_log a
       where a.actor_id = new.reviewer_id and a.entity_id in (v.competency_id, v_parent)
         and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
           'catalogue_entry_add', 'catalogue_entry_status', 'catalogue_entry_remove', 'catalogue_entry_review',
           'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added', 'clinical_scope_ended', 'framework_specialty_set',
           'reorder_layout'));
  elsif not v_conflict and v.content_kind = 'case' then
    v_conflict := exists (select 1 from case_library_version cv
      where cv.case_id = (select x.case_id from case_library_version x where x.id = v.case_version_id)
        and (new.reviewer_id = any(cv.authored_by) or new.reviewer_id is not distinct from cv.submitted_by));
  elsif not v_conflict and v.content_kind = 'resource' then
    v_conflict := exists (select 1 from ckri_knowledge_version kv
      where kv.resource_id = (select x.resource_id from ckri_knowledge_version x where x.id = v.knowledge_version_id)
        and (new.reviewer_id = any(kv.authored_by) or new.reviewer_id is not distinct from kv.submitted_by
          or new.reviewer_id is not distinct from kv.educator_reviewed_by));
  elsif not v_conflict and v.content_kind = 'learning' then
    v_conflict := exists (select 1 from learning_offering_version lv
      where lv.offering_id = (select x.offering_id from learning_offering_version x where x.id = v.learning_version_id)
        and (new.reviewer_id = any(lv.authored_by) or new.reviewer_id is not distinct from lv.submitted_by));
  end if;

  if v_conflict then
    raise exception 'clinical_review_decision: not independent. The reviewer authored, edited or submitted this content or an earlier version of it';
  end if;
  return new;
end;
$$;


-- Verification: every competency has valid ids, every request and evidence row has ids, the triggers exist.
select 'competencies_with_ids' as item, count(*)::text as value from framework_competencies where competency_outcome_ids_valid(learning_outcome_ids, learning_outcomes)
union all select 'competencies_total', count(*)::text from framework_competencies
union all select 'requests_with_ids', count(*)::text from competency_verification_request where outcome_ids is not null and outcome_map is not null
union all select 'evidence_with_ids', count(*)::text from competency_verification_evidence where outcome_ids is not null
union all select 'triggers', count(*)::text from pg_trigger
 where tgname in ('framework_competencies_outcome_ids', 'competency_verification_request_outcome_ids', 'competency_verification_evidence_outcome_ids')
union all select 'guards_enabled', count(*)::text from pg_trigger
 where tgname in ('competency_verification_request_guard', 'competency_verification_evidence_guard') and tgenabled = 'O';

notify pgrst, 'reload schema';
