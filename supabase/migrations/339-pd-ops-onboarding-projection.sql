-- APPLY THIS FILE WHOLE. It defines function bodies, so a statement-splitting runner would cut them in
-- half.
--
-- Migration 339: the privacy-safe onboarding projection and its thresholds (CPR-PD-014 sections 8.1, 8.4)
--
-- ============================ WHAT THIS IS FOR ============================
--
-- CPR-PD-014 section 4.2: the Provisioning and Onboarding screen must show real lifecycle progress, and
-- "missing onboarding telemetry must be labelled unavailable until the projection in section 8 is
-- implemented". This is that projection. Until it exists the screen is required to say so rather than
-- render a zero -- section 10: "Unavailable values: say Not yet measured or Unavailable, never render 0."
--
-- ============================ WHY A PROJECTION AND NOT A JOIN IN THE PAGE ============================
--
-- !! practice_onboarding.step_data HOLDS PRACTITIONER-ENTERED PAYLOADS, and the Product Operations plane
-- must never receive them. Section 8.1: "This projection must not include practitioner-entered clinical
-- content, patient data, notes or unrestricted onboarding payloads." A page that selected from
-- practice_onboarding directly would have to remember to exclude that column every time, in every
-- caller, forever. A projection that CANNOT return it makes the wrong state unrepresentable, which is
-- what this repository already prefers over a rule somebody has to remember.
--
-- The eight fields below are exactly section 8.1's contract. Nothing else is exposed.
--
-- ============================ STAGE IS READ, NEVER INFERRED ============================
--
-- Section 4.6: "Onboarding stage is never inferred from unrelated workspace status." stage comes from
-- practice_onboarding.current_step and from nowhere else. A workspace with no onboarding row projects no
-- row here at all, so the caller renders an absence rather than a guess.
--
-- steps_total is counted from the catalogue rather than assumed, so a catalogue change moves the
-- denominator without a code change. Only REQUIRED steps count toward the denominator -- an optional
-- step that nobody completes must not hold a practice at 5/6 forever.
--
-- ============================ THRESHOLDS ARE CONFIGURATION, NOT UI MAGIC ============================
--
-- Section 4.5: "store threshold as configuration rather than UI magic". pd_ops_config follows the shape
-- cdp_delivery_config already established in this estate rather than inventing a second idea.
--
-- !! stalled_reason_code IS A CODE, NOT A SENTENCE. Section 8.1 calls for a "non-clinical operational
-- reason", and section 3 requires human labels in the UI with codes as secondary. Wording belongs to the
-- screen, which can change it without a migration.


-- ---- Thresholds -----------------------------------------------------------------------------------

create table if not exists pd_ops_config (
  config_key   text primary key,
  value_hours  integer not null check (value_hours > 0),
  description  text not null,
  updated_at   timestamptz not null default now()
);

alter table pd_ops_config enable row level security;

-- Seeded with the defaults CPR-PD-014 names. on conflict do nothing so a re-run never overwrites a
-- threshold an operator has since tuned.
insert into pd_ops_config (config_key, value_hours, description) values
  ('onboarding_stall_hours', 24,
   'No onboarding progress for this many hours marks a practice STALLED. CPR-PD-014 section 4.5 default.'),
  ('activation_window_hours', 72,
   'A practice provisioned within this window is NEW rather than STALLED. CPR-PD-014 section 5.4.')
on conflict (config_key) do nothing;


-- ---- The projection -------------------------------------------------------------------------------

create or replace function plat_practice_onboarding_projection()
returns table(
  practice_id         uuid,
  stage               text,
  steps_total         integer,
  steps_completed     integer,
  started_at          timestamptz,
  last_progress_at    timestamptz,
  completed_at        timestamptz,
  stalled_reason_code text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with threshold as (
    select coalesce(
      (select value_hours from public.pd_ops_config where config_key = 'onboarding_stall_hours'),
      24
    ) as stall_hours
  ),
  required_steps as (
    select count(*)::int as total
    from public.practice_onboarding_step_catalog
    where required is true
  ),
  -- One row per workspace: the most recent onboarding record. A practice that restarted onboarding
  -- should report where it is NOW, not the first attempt.
  latest as (
    select distinct on (o.workspace_id)
      o.workspace_id, o.current_step, o.completed_steps, o.state,
      o.started_at, o.updated_at, o.completed_at
    from public.practice_onboarding o
    order by o.workspace_id, o.started_at desc
  )
  select
    l.workspace_id,
    l.current_step,
    (select total from required_steps),
    -- jsonb_array_length refuses a non-array, and completed_steps has been seen as null on a fresh row.
    case
      when jsonb_typeof(l.completed_steps) = 'array' then jsonb_array_length(l.completed_steps)
      else 0
    end,
    l.started_at,
    l.updated_at,
    l.completed_at,
    case
      when l.completed_at is not null then null
      when l.state = 'completed' then null
      when l.updated_at < now() - make_interval(hours => (select stall_hours from threshold))
        then 'NO_PROGRESS'
      else null
    end
  from latest l
$$;

revoke all on function plat_practice_onboarding_projection() from public;

revoke all on function plat_practice_onboarding_projection() from anon;

grant execute on function plat_practice_onboarding_projection() to service_role;

notify pgrst, 'reload schema';
