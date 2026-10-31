-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 802: LEARNER QUESTION OFFERS -- A SEPARATE PERMISSION, ONE QUESTION AT A TIME, INTO THE GOVERNED LIBRARY
--
-- SQIE-LIBRARY-EXPANSION-01, owner GO 31 Oct 2026 (Scholar Release Decisions, item F, second half). Owner GO to prepare
-- and validate on staging. Production application is a separate owner act. Build record:
-- docs/evidence/SQIE-LIBRARY/800-802-build-record.md.
--
-- APPLY ON STAGING FIRST, AFTER 800. ADDITIVE OR WIDENING. Three new tables, one view, one nullable column on
-- ckri_knowledge_version, its 442 CHECK replaced by a wider one every existing row already satisfies (origin gains
-- learner_contribution), two new triggers on ckri_knowledge_version (the 442 and 640 triggers are not replaced), and the
-- functions below. No row is changed. Re-running it is a no-op. OPS-001 s8: proposed Medium (it holds the content a
-- person offered and the permission it rests on), with a rollback rehearsal.
-- DEPENDS ON 423 (case_identifier_kinds, the identifier backstop), 440 (ckri_holds_capability), 442 (the CKRI library)
-- and 800 (ckri_knowledge_content_ok knows the formats). Application order: 800, then 802 (801 independent).
--
-- ----------------------------------------------------------------------------------------------------
-- IT MIRRORS CASE CANDIDACY (423), FOR ONE QUESTION AT A TIME.
--
--   A separate permission.        question_contribution_permission: per learner, granted on a versioned attestation text
--                                 (own notes, or licensed to share), revocable at any time. It is NOT implied by AI
--                                 consent, by case candidacy, or by anything else: no other table is read to grant it.
--                                 Every grant and revocation is kept in an append-only event table.
--   One question per offer.       question_contribution_offer: one structured snapshot of ONE of the learner own
--                                 questions, in the shape of a library question (stem, options, key, rubric, format,
--                                 marking, rationale), optionally with the quoted passage when the learner confirmed
--                                 their rights to it. The database refuses an offer without a granted permission, an
--                                 offer whose text has an identifier (case_identifier_kinds, the 423 backstop, over the
--                                 WHOLE snapshot), and a snapshot that is not a library question shape (800).
--   The learner is never named.   HQ reads offers only through question_contribution_queue, which has no user and no
--                                 source reference. user_id is kept for withdrawal, revocation and erasure only.
--   Nothing auto-approves.        Taking an offer (question_contribution_take, an educator with hq.learning.ckri.educator)
--                                 creates a CKRI DRAFT of origin learner_contribution, authored by that educator and
--                                 naming the offer. It then goes the normal way: educator review of its exact hash,
--                                 independent clinical approval (395, 640) and a separate publication. Origin
--                                 learner_contribution is set only by that function and is frozen.
--   Content that should go goes.  Withdrawn and declined offers hold NO content (CHECK). Withdrawing an offer,
--                                 revoking the permission and erasure (the person deleted) all purge every offer not
--                                 yet taken, in the database. An offer once taken is the educator draft record, as a
--                                 case candidate once promoted is.
--   Promotion is recorded.        When a version of the resource drafted from an offer is published, the offer becomes
--                                 promoted (trigger).
--
--   Offering never charges anybody. There is no AI in this file and no ledger write.
--
-- STATUS. offered -> withdrawn | declined | taken, declined -> withdrawn, taken -> promoted.
--
-- RLS: on for the three new tables, no policy. The view is security_invoker with no grant to anon or authenticated.
-- Execute on the functions: the service role only.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): RELEASE-2026-10-25/PENDING-31/ROLLBACK-802.sql restores the 442 CHECK and drops the rest. It
--   refuses once a permission or an offer exists, or a knowledge version names an offer.
-- ====================================================================================================


-- ---- 1. the permission: separate, revocable, recorded with its attestation text version -----------------

create table if not exists question_contribution_permission (
  user_id             uuid primary key references profiles(id) on delete cascade,
  status              text not null,
  attestation         text not null,
  attestation_version text not null,
  granted_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  revoked_reason      text,
  updated_at          timestamptz not null default now()
);
alter table question_contribution_permission drop constraint if exists question_contribution_permission_check;
alter table question_contribution_permission add constraint question_contribution_permission_check
  check (status in ('granted', 'revoked') and attestation in ('own_notes', 'licensed_to_share')
     and char_length(attestation_version) between 1 and 60
     and (status = 'revoked') = (revoked_at is not null)
     and (status = 'granted' or revoked_reason in ('learner', 'erasure', 'administrative')));
alter table question_contribution_permission enable row level security;

create table if not exists question_contribution_permission_event (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references profiles(id) on delete cascade,
  event               text not null,
  attestation         text not null,
  attestation_version text not null,
  reason              text,
  created_at          timestamptz not null default now()
);
alter table question_contribution_permission_event drop constraint if exists question_contribution_permission_event_check;
alter table question_contribution_permission_event add constraint question_contribution_permission_event_check check (event in ('granted', 'revoked'));
create index if not exists idx_question_contribution_permission_event_user on question_contribution_permission_event(user_id, created_at desc);
alter table question_contribution_permission_event enable row level security;

create or replace function public.question_contribution_permission_event_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'question_contribution_permission_event is append-only';
end;
$$;
drop trigger if exists question_contribution_permission_event_guard on question_contribution_permission_event;
create trigger question_contribution_permission_event_guard before update or delete on question_contribution_permission_event
  for each row execute function public.question_contribution_permission_event_guard();


-- ---- 2. the offer: one question, structured, screened, and only ever what the learner offered -------------

create table if not exists question_contribution_offer (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references profiles(id) on delete set null,
  source_key          text not null,
  status              text not null,
  snapshot            jsonb,
  snapshot_hash       text,
  format              text not null default 'mcq',
  ai_written          boolean not null default true,
  includes_source     boolean not null default false,
  screen_version      text not null,
  attestation         text not null default 'set-by-trigger',
  attestation_version text not null default 'set-by-trigger',
  offered_at          timestamptz not null default now(),
  decided_by          uuid references profiles(id),
  decided_at          timestamptz,
  decline_reason      text,
  taken_resource_id   uuid references ckri_knowledge_resource(id),
  taken_version_id    uuid references ckri_knowledge_version(id),
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  updated_at          timestamptz not null default now()
);
alter table question_contribution_offer drop constraint if exists question_contribution_offer_check;
alter table question_contribution_offer add constraint question_contribution_offer_check
  check (status in ('offered', 'withdrawn', 'taken', 'declined', 'promoted')
     and char_length(source_key) between 8 and 200 and char_length(screen_version) between 1 and 60
     and format in ('mcq', 'mrq', 'short', 'cloze', 'true_false', 'extended', 'flashcard', 'match', 'sequence', 'structured')
     and (snapshot is not null) = (status in ('offered', 'taken', 'promoted'))
     and (snapshot_hash is not null) = (snapshot is not null)
     and (snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 32000))
     and (status = 'withdrawn') = (withdrawn_at is not null)
     and (status <> 'withdrawn' or withdrawn_reason in ('learner', 'revoked', 'erasure', 'administrative'))
     and (status in ('taken', 'promoted')) = (taken_version_id is not null)
     and (taken_version_id is null) = (taken_resource_id is null)
     and (status not in ('taken', 'promoted', 'declined') or (decided_by is not null and decided_at is not null))
     and (status <> 'declined' or char_length(btrim(coalesce(decline_reason, ''))) between 2 and 500)
     and (user_id is not null or status in ('taken', 'promoted', 'withdrawn')));
create unique index if not exists ux_question_contribution_offer on question_contribution_offer(user_id, source_key, snapshot_hash);
create index if not exists idx_question_contribution_offer_queue on question_contribution_offer(status, offered_at desc);
create index if not exists idx_question_contribution_offer_user on question_contribution_offer(user_id, source_key);
create index if not exists idx_question_contribution_offer_resource on question_contribution_offer(taken_resource_id);
alter table question_contribution_offer enable row level security;

create or replace function public.question_contribution_offer_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  g question_contribution_permission%rowtype;
  v_kinds text[];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'question_contribution_offer: an offer is withdrawn, not deleted, so the record of what was offered and why it went stays';
  end if;

  if tg_op = 'INSERT' then
    select * into g from question_contribution_permission where user_id = new.user_id;
    if new.user_id is null or not found or g.status <> 'granted' then
      raise exception 'question_contribution_offer: no offering permission. The learner must grant it, separately, before offering a question';
    end if;
    if new.status <> 'offered' then raise exception 'question_contribution_offer: an offer starts offered'; end if;
    -- The permission the offer rests on comes from the database, never from the caller.
    new.attestation := g.attestation;
    new.attestation_version := g.attestation_version;
    new.offered_at := now();
    new.decided_by := null; new.decided_at := null; new.decline_reason := null;
    new.taken_resource_id := null; new.taken_version_id := null;
    new.withdrawn_at := null; new.withdrawn_reason := null;
    -- The identifier backstop over the whole snapshot, the quoted passage included.
    v_kinds := case_identifier_kinds(new.snapshot::text);
    if cardinality(v_kinds) > 0 then
      raise exception 'question_contribution_offer: identifiable content (%) cannot be offered', array_to_string(v_kinds, ', ');
    end if;
    if not coalesce(ckri_knowledge_content_ok('revision_question', new.snapshot - 'sourceQuote'), false) then
      raise exception 'question_contribution_offer: the snapshot is not a library question';
    end if;
    if new.snapshot ? 'sourceQuote' and not (jsonb_typeof(new.snapshot -> 'sourceQuote') = 'string' and char_length(new.snapshot ->> 'sourceQuote') between 1 and 1000) then
      raise exception 'question_contribution_offer: a quoted passage is 1 to 1000 characters';
    end if;
    new.includes_source := new.snapshot ? 'sourceQuote';
    new.format := coalesce(new.snapshot ->> 'format', 'mcq');
    new.snapshot_hash := md5(new.snapshot::text);
    return new;
  end if;

  -- UPDATE. Identity and provenance never change, and the content never changes: it is only ever purged.
  if new.id is distinct from old.id or new.source_key is distinct from old.source_key or new.offered_at is distinct from old.offered_at
     or new.screen_version is distinct from old.screen_version or new.attestation is distinct from old.attestation
     or new.attestation_version is distinct from old.attestation_version or new.format is distinct from old.format
     or new.ai_written is distinct from old.ai_written or new.includes_source is distinct from old.includes_source
     or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'question_contribution_offer: what was offered, by whom and on what permission cannot be rewritten';
  end if;
  if new.snapshot is not null and new.snapshot is distinct from old.snapshot then
    raise exception 'question_contribution_offer: an offer content never changes. The educator develops a library draft from it instead';
  end if;
  -- Erasure: the person is gone, so an offer not yet taken is withdrawn and purged.
  if new.user_id is null and old.user_id is not null and old.status in ('offered', 'declined') then
    new.status := 'withdrawn'; new.withdrawn_reason := 'erasure';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'offered' and new.status in ('withdrawn', 'declined', 'taken'))
         or (old.status = 'declined' and new.status = 'withdrawn')
         or (old.status = 'taken' and new.status = 'promoted')) then
      raise exception 'question_contribution_offer: an offer cannot move from % to %', old.status, new.status;
    end if;
    if new.status in ('taken', 'promoted') and coalesce(current_setting('competen.question_offer', true), '') <> 'on' then
      raise exception 'question_contribution_offer: an offer is taken only by question_contribution_take, and promoted only by publication';
    end if;
    if new.status in ('taken', 'declined') then new.decided_at := now(); end if;
    if new.status = 'withdrawn' then new.withdrawn_at := now(); end if;
  end if;
  if new.taken_version_id is distinct from old.taken_version_id and coalesce(current_setting('competen.question_offer', true), '') <> 'on' then
    raise exception 'question_contribution_offer: the draft an offer became is recorded only by question_contribution_take';
  end if;
  if new.status in ('declined', 'withdrawn') then
    new.snapshot := null; new.snapshot_hash := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists question_contribution_offer_guard on question_contribution_offer;
create trigger question_contribution_offer_guard before insert or update or delete on question_contribution_offer
  for each row execute function public.question_contribution_offer_guard();

-- What HQ reads: the offers waiting and the ones taken, with no user and no source reference.
create or replace view question_contribution_queue with (security_invoker = true) as
  select id, status, snapshot, snapshot_hash, format, ai_written, includes_source, attestation, attestation_version,
         offered_at, decided_by, decided_at, taken_resource_id, taken_version_id
    from question_contribution_offer
   where status in ('offered', 'taken', 'promoted');
revoke all on question_contribution_queue from public, anon, authenticated;
grant select on question_contribution_queue to service_role;


-- ---- 3. a knowledge version of learner_contribution origin, created only by taking an offer --------------

alter table ckri_knowledge_version add column if not exists origin_offer_id uuid references question_contribution_offer(id);
alter table ckri_knowledge_version drop constraint if exists ckri_knowledge_version_check;
alter table ckri_knowledge_version add constraint ckri_knowledge_version_check
  check (version_no >= 1 and jsonb_typeof(content) = 'object' and octet_length(content::text) <= 32000
     and origin in ('educator', 'ai_draft', 'learner_contribution')
     and ((origin = 'ai_draft') = (ai_provenance is not null))
     and ((origin = 'learner_contribution') = (origin_offer_id is not null))
     and (ai_provenance is null or (jsonb_typeof(ai_provenance) = 'object' and ai_provenance ? 'model' and ai_provenance ? 'prompt_version'))
     and risk in ('standard', 'high')
     and state in ('draft', 'submitted', 'published', 'superseded', 'retired')
     and cardinality(authored_by) >= 1
     and ((educator_reviewed_by is null) = (educator_reviewed_hash is null)) and ((educator_reviewed_by is null) = (educator_reviewed_at is null))
     and (state = 'draft') = (submitted_at is null)
     and (state = 'draft' or (submitted_by is not null and submitted_by = any(authored_by) and educator_reviewed_hash = content_hash))
     and (state not in ('published', 'superseded') or (published_at is not null and published_by is not null))) not valid;
alter table ckri_knowledge_version validate constraint ckri_knowledge_version_check;
create index if not exists idx_ckri_knowledge_version_origin_offer on ckri_knowledge_version(origin_offer_id);

create or replace function public.ckri_knowledge_version_offer_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if (new.origin = 'learner_contribution' or new.origin_offer_id is not null)
       and coalesce(current_setting('competen.question_offer', true), '') <> 'on' then
      raise exception 'ckri_knowledge_version: a draft of learner_contribution origin is created only by taking an offer (question_contribution_take)';
    end if;
    return new;
  end if;
  if new.origin_offer_id is distinct from old.origin_offer_id then
    raise exception 'ckri_knowledge_version: the offer a version came from cannot be rewritten';
  end if;
  return new;
end;
$$;
drop trigger if exists ckri_knowledge_version_offer_guard on ckri_knowledge_version;
create trigger ckri_knowledge_version_offer_guard before insert or update on ckri_knowledge_version
  for each row execute function public.ckri_knowledge_version_offer_guard();

-- A version of a resource drafted from an offer is published: the offer is promoted.
create or replace function public.ckri_knowledge_version_offer_promote()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.state = 'published' and old.state is distinct from 'published' then
    perform set_config('competen.question_offer', 'on', true);
    update question_contribution_offer set status = 'promoted' where taken_resource_id = new.resource_id and status = 'taken';
    perform set_config('competen.question_offer', 'off', true);
  end if;
  return null;
end;
$$;
drop trigger if exists ckri_knowledge_version_offer_promote on ckri_knowledge_version;
create trigger ckri_knowledge_version_offer_promote after update on ckri_knowledge_version
  for each row execute function public.ckri_knowledge_version_offer_promote();


-- ---- 4. the functions ----------------------------------------------------------------------------------

-- Grant (or re-grant) the permission on the attestation text the learner read. Granting offers nothing.
create or replace function public.question_contribution_grant(p_user uuid, p_attestation text, p_version text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if p_attestation not in ('own_notes', 'licensed_to_share') then raise exception 'question_contribution_grant: the attestation is own_notes or licensed_to_share'; end if;
  if p_version is null or char_length(p_version) not between 1 and 60 then raise exception 'question_contribution_grant: name the attestation text version'; end if;
  insert into question_contribution_permission (user_id, status, attestation, attestation_version, granted_at)
    values (p_user, 'granted', p_attestation, p_version, now())
  on conflict (user_id) do update set status = 'granted', attestation = excluded.attestation, attestation_version = excluded.attestation_version,
    granted_at = now(), revoked_at = null, revoked_reason = null, updated_at = now();
  insert into question_contribution_permission_event (user_id, event, attestation, attestation_version) values (p_user, 'granted', p_attestation, p_version);
end;
$$;

-- Revoke the permission. Every offer not yet taken is withdrawn and its content purged, in this transaction.
create or replace function public.question_contribution_revoke(p_user uuid, p_reason text)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  g question_contribution_permission%rowtype;
  v_n int;
begin
  select * into g from question_contribution_permission where user_id = p_user for update;
  if not found or g.status <> 'granted' then return 0; end if;
  update question_contribution_permission set status = 'revoked', revoked_at = now(), revoked_reason = coalesce(p_reason, 'learner'), updated_at = now() where user_id = p_user;
  insert into question_contribution_permission_event (user_id, event, attestation, attestation_version, reason)
    values (p_user, 'revoked', g.attestation, g.attestation_version, coalesce(p_reason, 'learner'));
  update question_contribution_offer set status = 'withdrawn', withdrawn_reason = 'revoked'
   where user_id = p_user and status in ('offered', 'declined');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Withdraw one offer: an act of the learner, never gated. 0 when it is not theirs or is already taken.
create or replace function public.question_contribution_withdraw(p_user uuid, p_offer uuid)
returns int
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_n int;
begin
  update question_contribution_offer set status = 'withdrawn', withdrawn_reason = 'learner'
   where id = p_offer and user_id = p_user and status in ('offered', 'declined');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- An educator declines an offer, with a reason. Its content is purged.
create or replace function public.question_contribution_decline(p_offer uuid, p_educator uuid, p_reason text)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  o question_contribution_offer%rowtype;
begin
  select * into o from question_contribution_offer where id = p_offer for update;
  if not found or o.status <> 'offered' then raise exception 'question_contribution_decline: only an offer waiting in the queue is declined'; end if;
  if not ckri_holds_capability(p_educator, 'hq.learning.ckri.educator') then
    raise exception 'question_contribution_decline: not authorised. Declining needs hq.learning.ckri.educator';
  end if;
  update question_contribution_offer set status = 'declined', decided_by = p_educator, decline_reason = btrim(p_reason) where id = p_offer;
end;
$$;

-- An educator takes an offer: a new CKRI resource and its DRAFT version 1, of origin learner_contribution, authored by
-- the educator, naming the offer. The content is the snapshot without the quoted passage, with the rights the learner
-- attested declared as its source. Then the normal review, approval and publication apply (442, 395, 640).
create or replace function public.question_contribution_take(p_offer uuid, p_educator uuid, p_code text, p_title text)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  o question_contribution_offer%rowtype;
  v_res uuid;
  v_ver uuid;
  v_content jsonb;
begin
  select * into o from question_contribution_offer where id = p_offer for update;
  if not found or o.status <> 'offered' then raise exception 'question_contribution_take: only an offer waiting in the queue is taken'; end if;
  if not ckri_holds_capability(p_educator, 'hq.learning.ckri.educator') then
    raise exception 'question_contribution_take: not authorised. Taking an offer needs hq.learning.ckri.educator';
  end if;
  v_content := (o.snapshot - 'sourceQuote') || jsonb_build_object('source', jsonb_build_object(
    'kind', 'permission', 'reference', 'Learner offer ' || o.id::text,
    'permissionNote', 'Offered by a learner who attested ' || replace(o.attestation, '_', ' ') || ' under ' || o.attestation_version || ' on ' || to_char(o.offered_at, 'YYYY-MM-DD')));
  insert into ckri_knowledge_resource (code, kind, title, created_by) values (p_code, 'revision_question', p_title, p_educator) returning id into v_res;
  perform set_config('competen.question_offer', 'on', true);
  insert into ckri_knowledge_version (resource_id, version_no, content, origin, origin_offer_id, authored_by)
    values (v_res, 1, v_content, 'learner_contribution', o.id, array[p_educator]) returning id into v_ver;
  update question_contribution_offer set status = 'taken', decided_by = p_educator, taken_resource_id = v_res, taken_version_id = v_ver where id = o.id;
  perform set_config('competen.question_offer', 'off', true);
  return v_ver;
end;
$$;

revoke all on function public.question_contribution_grant(uuid, text, text) from public, anon, authenticated;
revoke all on function public.question_contribution_revoke(uuid, text) from public, anon, authenticated;
revoke all on function public.question_contribution_withdraw(uuid, uuid) from public, anon, authenticated;
revoke all on function public.question_contribution_decline(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.question_contribution_take(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.question_contribution_grant(uuid, text, text) to service_role;
grant execute on function public.question_contribution_revoke(uuid, text) to service_role;
grant execute on function public.question_contribution_withdraw(uuid, uuid) to service_role;
grant execute on function public.question_contribution_decline(uuid, uuid, text) to service_role;
grant execute on function public.question_contribution_take(uuid, uuid, text, text) to service_role;

comment on column ckri_knowledge_version.origin_offer_id is
  'SQIE-LIBRARY-EXPANSION-01 (802). For a version of origin learner_contribution: the learner offer it was drafted from (question_contribution_take). Never names the learner. Frozen.';

notify pgrst, 'reload schema';
