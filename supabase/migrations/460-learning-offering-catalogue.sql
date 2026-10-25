-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql functions between dollar quotes. A runner that splits on the
-- statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 460: COMPETEN LEARNING -- THE HOLDINGS LEARNING CATALOGUE (PROVIDERS, OFFERINGS, VERSIONS, OUTCOMES)
--
-- COMPETEN-LEARNING-01 Phase 2 S1 (owner GO 2026-10-25, decision D1 option C). Discovery:
-- docs/COMPETEN-LEARNING-01-phase1-discovery.md s2.1 and s5. Product definition s3, s4, s5, s6, s8.
--
-- APPLY ON STAGING FIRST. ADDITIVE. Four new tables, their guards and one private storage bucket. It alters no existing
-- table. Re-running it is a no-op. OPS-001 s8: proposed Low (new objects only, no existing object changed). Depends on profiles and the CFCA
-- competency tables (framework_competencies). 461 (review and publication) and 462 (the personal record) depend on it.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It gives Competen Holdings one shared catalogue of learning -- Competen, partner and externally linked -- whose
-- content is versioned, hashed and frozen from submission exactly as the case library (422), so a learner is only
-- ever offered a version someone governed, and the organisation-owned learning tables are never read or widened.
--
-- ----------------------------------------------------------------------------------------------------
-- THE PIECES.
--
--   learning_provider          who a responsibility belongs to: Competen, a partner, or an external provider. Code and
--                              kind are frozen. Content owner, delivery provider, certificate issuer and commercial
--                              party are four separate references on each version (product definition s3B, s3C).
--   learning_offering          an offering identity: code, title, source (competen, partner, external), delivery
--                              (hosted or external), offering type. Active or retired. Code, source and delivery are frozen.
--   learning_offering_version  the content (the learning-blueprint/1 document) with a database-computed hash, and the
--                              lifecycle draft, submitted, published, superseded, retired. The filter columns are the
--                              database reading the content, never a writer. A draft is editable by its authors. From
--                              submission the content and its responsibilities are frozen. APPROVAL IS NOT STORED HERE:
--                              a hosted version is approved by its 395 record (461), an external listing by its listing
--                              publication, which is NOT clinical endorsement.
--   learning_offering_version_outcome  the CFCA competencies (and optionally one recorded learning outcome) a version
--                              serves, each with its relation: introduces, develops, practises, assesses or
--                              supports_verification (product definition s6). Frozen from submission.
--
-- NO hospital_id ANYWHERE, AND NO PERSONAL DATA. These are Holdings-owned shared records (ADR-017). The personal
-- enrolment, progress and completion are 462, in separate tables no estate analytics reads.
--
-- NOTHING HARD-CODED BEYOND STRUCTURE. Offering types, formats and levels are lowercase codes checked for shape,
-- and the allowed lists are the Learning policy (WCE, platform / learning). No profession, country or price is here.
--
-- RLS: on for the four new tables, no policy. The server uses the service role. Execute on functions: none here.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-460.sql drops the four tables, their functions and the empty bucket. It refuses once an
--   offering exists.
-- ====================================================================================================


-- ---- 1. learning_provider ---------------------------------------------------------------------------

create table if not exists learning_provider (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  name         text not null,
  kind         text not null,
  website_url  text,
  description  text,
  status       text not null default 'active',
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table learning_provider drop constraint if exists learning_provider_check;
alter table learning_provider add constraint learning_provider_check
  check (code ~ '^[A-Z0-9][A-Z0-9-]{1,40}$' and char_length(btrim(name)) between 2 and 160
     and kind in ('competen', 'partner', 'external') and status in ('active', 'retired')
     and (website_url is null or (website_url ~ '^https://[A-Za-z0-9.-]{3,253}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' and char_length(website_url) <= 500))
     and char_length(coalesce(description, '')) <= 2000);
create unique index if not exists ux_learning_provider_code on learning_provider(code);
alter table learning_provider enable row level security;

create or replace function public.learning_provider_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_provider: a provider is part of the record. Retire it instead';
  end if;
  if new.code is distinct from old.code or new.kind is distinct from old.kind or new.created_at is distinct from old.created_at then
    raise exception 'learning_provider: a provider code and kind cannot be rewritten';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'learning_provider: a retired provider stays retired';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists learning_provider_guard on learning_provider;
create trigger learning_provider_guard before update or delete on learning_provider for each row execute function public.learning_provider_guard();


-- ---- 2. learning_offering ---------------------------------------------------------------------------

create table if not exists learning_offering (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  title          text not null,
  source         text not null,
  delivery       text not null,
  offering_type  text not null,
  status         text not null default 'active',
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table learning_offering drop constraint if exists learning_offering_check;
alter table learning_offering add constraint learning_offering_check
  check (code ~ '^LRN-[A-Z0-9][A-Z0-9-]{2,40}$' and char_length(btrim(title)) between 2 and 200
     and source in ('competen', 'partner', 'external') and delivery in ('hosted', 'external')
     and (source <> 'external' or delivery = 'external')
     and offering_type ~ '^[a-z][a-z_]{1,30}$' and status in ('active', 'retired'));
create unique index if not exists ux_learning_offering_code on learning_offering(code);
create index if not exists idx_learning_offering_status on learning_offering(status, updated_at desc);
alter table learning_offering enable row level security;

create or replace function public.learning_offering_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'learning_offering: an offering is the record. Retire it instead';
  end if;
  if new.code is distinct from old.code or new.source is distinct from old.source or new.delivery is distinct from old.delivery
     or new.created_at is distinct from old.created_at then
    raise exception 'learning_offering: an offering code, source and delivery cannot be rewritten';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'learning_offering: a retired offering stays retired';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists learning_offering_guard on learning_offering;
create trigger learning_offering_guard before update or delete on learning_offering for each row execute function public.learning_offering_guard();


-- ---- 3. learning_offering_version -------------------------------------------------------------------

create table if not exists learning_offering_version (
  id                     uuid primary key default gen_random_uuid(),
  offering_id            uuid not null references learning_offering(id) on delete cascade,
  version_no             int not null,
  content                jsonb not null,
  content_hash           text not null default 'computed-by-trigger',
  review_route           text not null,
  risk                   text not null default 'standard',
  state                  text not null default 'draft',
  content_owner_id       uuid references learning_provider(id),
  delivery_provider_id   uuid references learning_provider(id),
  certificate_issuer_id  uuid references learning_provider(id),
  commercial_provider_id uuid references learning_provider(id),
  level                  text,
  format                 text,
  language               text,
  duration_minutes       int,
  access_model           text,
  external_url           text,
  review_due_on          date,
  profession_term_ids    uuid[] not null default '{}',
  specialty_term_ids     uuid[] not null default '{}',
  topics                 text[] not null default '{}',
  authored_by            uuid[] not null,
  submitted_by           uuid,
  submitted_at           timestamptz,
  published_by           uuid,
  published_at           timestamptz,
  superseded_at          timestamptz,
  retired_at             timestamptz,
  origin_kind            text not null default 'educator',
  parent_version_id      uuid references learning_offering_version(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table learning_offering_version drop constraint if exists learning_offering_version_check;
alter table learning_offering_version add constraint learning_offering_version_check
  check (version_no >= 1 and jsonb_typeof(content) = 'object'
     and review_route in ('clinical', 'listing') and risk in ('standard', 'high')
     and state in ('draft', 'submitted', 'published', 'superseded', 'retired')
     and cardinality(authored_by) >= 1
     and (state = 'draft') = (submitted_at is null)
     and (state = 'draft' or (submitted_by is not null and submitted_by = any(authored_by)))
     and (state not in ('published', 'superseded') or (published_at is not null and published_by is not null))
     and (published_by is null or not (published_by = any(authored_by)))
     and origin_kind in ('educator', 'revision')
     and (origin_kind <> 'revision' or parent_version_id is not null)
     and (external_url is null or (external_url ~ '^https://[A-Za-z0-9.-]{3,253}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' and char_length(external_url) <= 1900))
     and (access_model is null or access_model in ('free', 'paid', 'external'))
     and (duration_minutes is null or duration_minutes between 1 and 100000));
create unique index if not exists ux_learning_offering_version_no on learning_offering_version(offering_id, version_no);
create index if not exists idx_learning_offering_version_state on learning_offering_version(state, updated_at desc);
alter table learning_offering_version enable row level security;

-- The hash and the filter columns belong to the database. A draft is editable. From submission the content, the four
-- responsibilities, the route, the risk and the authorship are frozen, and the state moves only through the 461
-- functions (the setting competen.learning). A hosted offering is always reviewed clinically. An external listing
-- takes the listing route unless a writer asked for clinical review of it.
create or replace function public.learning_offering_version_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_delivery text;
  v_arr jsonb;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or old.state = 'draft' then return old; end if;
    raise exception 'learning_offering_version: a submitted version is the record and cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then raise exception 'learning_offering_version: a version starts as a draft'; end if;
    select o.delivery into v_delivery from learning_offering o where o.id = new.offering_id;
    if v_delivery = 'hosted' and new.review_route <> 'clinical' then
      raise exception 'learning_offering_version: hosted learning is clinically reviewed before it is published';
    end if;
    new.submitted_by := null;
    new.submitted_at := null;
    new.published_by := null;
    new.published_at := null;
  else
    if new.offering_id is distinct from old.offering_id or new.version_no is distinct from old.version_no or new.created_at is distinct from old.created_at
       or new.origin_kind is distinct from old.origin_kind or new.parent_version_id is distinct from old.parent_version_id or new.review_route is distinct from old.review_route then
      raise exception 'learning_offering_version: a version''s identity, route and provenance cannot be rewritten';
    end if;
    if coalesce(current_setting('competen.learning', true), '') <> 'on' then
      if old.state <> 'draft' or new.state <> 'draft' then
        raise exception 'learning_offering_version: only a draft is edited directly. Submission, publication and retirement go through their functions';
      end if;
    elsif new.content is distinct from old.content or new.authored_by is distinct from old.authored_by or new.risk is distinct from old.risk
       or new.content_owner_id is distinct from old.content_owner_id or new.delivery_provider_id is distinct from old.delivery_provider_id
       or new.certificate_issuer_id is distinct from old.certificate_issuer_id or new.commercial_provider_id is distinct from old.commercial_provider_id then
      raise exception 'learning_offering_version: a submitted version''s content and responsibilities cannot change. Make a new version, which needs renewed review';
    end if;
  end if;
  -- The database reads the content: a writer never sets a filter column or the hash.
  new.content_hash := md5(new.content::text);
  new.level := nullif(btrim(coalesce(new.content->>'level', '')), '');
  new.format := nullif(btrim(coalesce(new.content->>'format', '')), '');
  new.language := nullif(btrim(coalesce(new.content->>'language', '')), '');
  new.duration_minutes := case when coalesce(new.content->>'durationMinutes', '') ~ '^[0-9]{1,6}$' and (new.content->>'durationMinutes')::int between 1 and 100000
    then (new.content->>'durationMinutes')::int else null end;
  new.access_model := case when new.content #>> '{access,model}' in ('free', 'paid', 'external') then new.content #>> '{access,model}' else null end;
  new.external_url := case when coalesce(new.content #>> '{external,url}', '') ~ '^https://[A-Za-z0-9.-]{3,253}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' and char_length(new.content #>> '{external,url}') <= 1900 then new.content #>> '{external,url}' else null end;
  new.review_due_on := case when coalesce(new.content #>> '{external,reviewDueOn}', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then (new.content #>> '{external,reviewDueOn}')::date else null end;
  v_arr := new.content #> '{audience,professionTermIds}';
  new.profession_term_ids := case when jsonb_typeof(v_arr) = 'array' then array(select x::uuid from jsonb_array_elements_text(v_arr) x where x ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') else '{}'::uuid[] end;
  v_arr := new.content #> '{audience,specialtyTermIds}';
  new.specialty_term_ids := case when jsonb_typeof(v_arr) = 'array' then array(select x::uuid from jsonb_array_elements_text(v_arr) x where x ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') else '{}'::uuid[] end;
  v_arr := new.content -> 'topics';
  new.topics := case when jsonb_typeof(v_arr) = 'array' then array(select left(btrim(x), 80) from jsonb_array_elements_text(v_arr) x where char_length(btrim(x)) between 1 and 80 limit 30) else '{}'::text[] end;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists learning_offering_version_guard on learning_offering_version;
create trigger learning_offering_version_guard before insert or update or delete on learning_offering_version for each row execute function public.learning_offering_version_guard();


-- ---- 4. learning_offering_version_outcome -----------------------------------------------------------
--
-- outcome_index is the position of one recorded learning outcome of the competency (framework_competencies
-- learning_outcomes, 384), or -1 for the competency as a whole. The relation is never implied: the five values are
-- distinct claims, and none of them is verification of competence.

create table if not exists learning_offering_version_outcome (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references learning_offering_version(id) on delete cascade,
  competency_id  uuid not null references framework_competencies(id),
  outcome_index  int not null default -1,
  relation       text not null,
  objective_key  text not null
);
alter table learning_offering_version_outcome drop constraint if exists learning_offering_version_outcome_check;
alter table learning_offering_version_outcome add constraint learning_offering_version_outcome_check
  check (outcome_index >= -1 and outcome_index < 200
     and relation in ('introduces', 'develops', 'practises', 'assesses', 'supports_verification')
     and objective_key ~ '^[a-z0-9][a-z0-9_-]{0,40}$');
create unique index if not exists ux_learning_offering_version_outcome
  on learning_offering_version_outcome(version_id, objective_key, competency_id, outcome_index, relation);
create index if not exists idx_learning_offering_version_outcome_comp on learning_offering_version_outcome(competency_id);
alter table learning_offering_version_outcome enable row level security;

create or replace function public.learning_offering_version_outcome_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_state text;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  select state into v_state from learning_offering_version where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if v_state is distinct from 'draft' then
    raise exception 'learning_offering_version_outcome: the outcomes a submitted version serves cannot change. Make a new version';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists learning_offering_version_outcome_guard on learning_offering_version_outcome;
create trigger learning_offering_version_outcome_guard before insert or update or delete on learning_offering_version_outcome for each row execute function public.learning_offering_version_outcome_guard();


-- ---- 5. THE PRIVATE CONTENT BUCKET -------------------------------------------------------------------
--
-- Lesson media an educator uploads (PDFs and images, video by https link only). Server-mediated with NO storage
-- policies: a learner receives a short-lived signed URL only for a deliverable version they may access. Objects are
-- written once under a new path and never overwritten, so a frozen version never changes underneath its approval.
-- ON CONFLICT DO NOTHING: an existing bucket keeps its configuration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'learning-content', 'learning-content', false, 20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;


-- Verification: four new tables with RLS on and no policy, and no rows.
select c.relname, c.relrowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname) as policies
  from pg_class c
 where c.relname in ('learning_provider', 'learning_offering', 'learning_offering_version', 'learning_offering_version_outcome')
 order by c.relname;

select (select count(*) from learning_provider) as providers, (select count(*) from learning_offering) as offerings,
       (select count(*) from learning_offering_version) as versions, (select count(*) from learning_offering_version_outcome) as outcomes;

notify pgrst, 'reload schema';
