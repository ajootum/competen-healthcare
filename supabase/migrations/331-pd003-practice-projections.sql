-- CPR-PD-003 Operationalisation - the Practice activity and health PROJECTIONS. s4, s6, s13 steps 3-4.
--
-- APPLY THIS FILE WHOLE. It defines plpgsql trigger functions with dollar-quoted bodies.
--
-- WHY A PROJECTION AND NOT THE LIVE READ THIS REPLACES
--
-- s4: "PD-003 MUST NOT SCAN appointments and encounters on each page load. Activity is a
-- management-plane PROJECTION derived from the common MOS event substrate."
--
-- The register briefly read mos_event directly with a thirty-day filter on every render. It was honest
-- and it was the wrong shape: a landlord list page cannot own a scan over the event store, and s14
-- requires "every projection exposes freshness/effective timestamps sufficient to PREVENT STALE STATE
-- BEING PRESENTED AS CURRENT" - which a live read cannot do, because it has no way to say how old it is.
-- A projection knows when it was observed. A live query only knows that it just ran, which is a
-- different claim and the one that hides a broken refresher.
--
-- THE SEVENTH TIME THIS ARC OMITS THE OBVIOUS COLUMN
--
-- activity carries no `classification` a writer may choose freely, and health carries no default state.
--
--   s4: "DO NOT INVENT 'recent activity' thresholds. Any classification must be DEFINED AND VERSIONED."
--   s6: "PD-003 must not create a second health methodology ... never independently labels a Practice
--       Healthy." s14 repeats it as an acceptance criterion.
--
-- So classification is a foreign key to a PUBLISHED, VERSIONED definition. No definition, no
-- classification - the column stays null and the register renders Not Measured. "Active today" is a
-- threshold somebody has to own, and the place it would otherwise be invented is a CASE expression in a
-- loader, where nobody would ever look for a policy.
--
-- AND HEALTH DEFAULTS TO 'unknown', NOT TO 'healthy'
--
-- The default is the value every row gets before anybody thinks about it, which makes it the most
-- consequential word in the table. s6 lists Unknown among the legitimate states precisely so that the
-- absence of evidence has somewhere to sit that is not reassurance.

-- ---- 1. THE ACTIVITY CLASSIFICATION DEFINITION (s4) -------------------------------------------------
--
-- Versioned on the pattern migration 320 established for the risk methodology, and EMPTY for the same
-- reason: publishing "dormant means fourteen days" is a governance act, not a default.

create table if not exists pd_activity_definition (
  definition_id uuid primary key default gen_random_uuid(),
  version       int not null unique,
  name          text not null check (btrim(name) <> ''),
  -- the classifications this version declares, and what each MEANS. Prose a reader can check
  rule_text     text not null check (btrim(rule_text) <> ''),
  status        text not null default 'draft'
                check (status in ('draft', 'published', 'superseded')),
  published_by  text,
  published_at  timestamp with time zone,
  effective_from timestamp with time zone,
  created_at    timestamp with time zone not null default now(),

  constraint pd_activity_definition_published_is_attributed
    check ((status in ('published', 'superseded'))
           = (published_by is not null and published_at is not null and effective_from is not null))
);

comment on table pd_activity_definition is
  'CPR-PD-003 s4 activity classification definition, versioned and EMPTY until published. s4: do not invent recent-activity thresholds - any classification must be defined and versioned.';

alter table pd_activity_definition enable row level security;

create table if not exists pd_activity_class (
  class_id      uuid primary key default gen_random_uuid(),
  definition_id uuid not null references pd_activity_definition(definition_id) on delete cascade,
  code          text not null check (btrim(code) <> ''),
  label         text not null check (btrim(label) <> ''),
  meaning       text not null check (btrim(meaning) <> ''),
  sort_order    int not null default 100,
  unique (definition_id, code)
);

alter table pd_activity_class enable row level security;

-- ---- 2. THE ACTIVITY PROJECTION (s4) ----------------------------------------------------------------

create table if not exists pd_practice_activity (
  practice_id   uuid primary key references practice_workspace(id) on delete cascade,

  -- s4's prescribed fields
  last_meaningful_activity_at timestamp with time zone,
  last_activity_type text,
  activity_window_count int,
  window_start  timestamp with time zone,
  window_end    timestamp with time zone,

  -- s4: classification "only where a published definition exists". The FK is how that is enforced
  classification text,
  class_id      uuid references pd_activity_class(class_id) on delete set null,
  definition_version int,

  -- s14: freshness, so stale state cannot be presented as current
  observed_at   timestamp with time zone not null default now(),
  source_version text,

  constraint pd_activity_classification_is_defined
    check ((classification is null) = (class_id is null)),
  constraint pd_activity_window_is_ordered
    check (window_end is null or window_start is null or window_end >= window_start)
);

comment on table pd_practice_activity is
  'CPR-PD-003 s4 Practice activity projection from MOS operational events. classification requires a published definition - the FK makes an invented threshold unstorable rather than merely discouraged.';

alter table pd_practice_activity enable row level security;

create index if not exists idx_pd_activity_observed on pd_practice_activity (observed_at desc);
create index if not exists idx_pd_activity_last on pd_practice_activity (last_meaningful_activity_at desc nulls last);

-- ---- 3. THE HEALTH PROJECTION (s6) ------------------------------------------------------------------
--
-- s6 names six states and PD-008 owns the methodology. This table is a PROJECTION: PD-003 reads it and
-- never writes it, so the register cannot label a practice Healthy on its own reasoning.

create table if not exists pd_practice_health (
  practice_id   uuid primary key references practice_workspace(id) on delete cascade,

  -- s6's six states. NOTE THE DEFAULT
  health_state  text not null default 'unknown'
                check (health_state in ('healthy', 'degraded', 'major_degradation',
                                        'critical', 'maintenance', 'unknown')),
  health_reason text,

  window_start  timestamp with time zone,
  window_end    timestamp with time zone,
  -- s6: drill-through to Product Health, so a state on the register is never a dead end
  evidence_ref  text,

  observed_at   timestamp with time zone not null default now(),
  produced_by   text not null default 'pd-008',
  source_version text,

  -- s6/s14: a state other than unknown is an evidenced judgement, so it says what the evidence was
  constraint pd_health_state_is_reasoned
    check (health_state = 'unknown' or btrim(coalesce(health_reason, '')) <> ''),
  constraint pd_health_window_is_ordered
    check (window_end is null or window_start is null or window_end >= window_start)
);

comment on table pd_practice_health is
  'CPR-PD-003 s6 Practice health projection. Defaults to unknown, never healthy - the default is what every row gets before anybody thinks about it, which makes it the most consequential word in the table.';

alter table pd_practice_health enable row level security;

create index if not exists idx_pd_health_state on pd_practice_health (health_state, observed_at desc);

-- ---- 4. A CLASSIFICATION CANNOT OUTLIVE ITS DEFINITION ----------------------------------------------
--
-- The FK above stops a classification existing without a class row. This stops one existing against a
-- class whose definition was never published - a draft is somebody thinking aloud, and a projection
-- built on it would present a proposal as policy.

create or replace function pd_activity_class_is_published()
returns trigger
language plpgsql
as $$
declare
  st text;
begin
  if new.class_id is null then
    return new;
  end if;

  select d.status into st
  from pd_activity_class c
  join pd_activity_definition d on d.definition_id = c.definition_id
  where c.class_id = new.class_id;

  if st is distinct from 'published' then
    raise exception
      'CPR-PD-003 s4: activity classification refers to a definition that is not published (status %). A draft definition is somebody thinking aloud - a projection built on one presents a proposal as policy.',
      coalesce(st, 'missing');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pd_activity_class_is_published on pd_practice_activity;
create trigger trg_pd_activity_class_is_published
  before insert or update on pd_practice_activity
  for each row execute function pd_activity_class_is_published();

-- ---- 5. NOTHING IS SEEDED ---------------------------------------------------------------------------
--
-- No definition, no classification, no projected row. s13 sequences the producers that fill these, and
-- a seeded row here would put a value on the estate register that no producer stands behind - which is
-- precisely the failure the whole operationalisation specification exists to correct.

notify pgrst, 'reload schema';
