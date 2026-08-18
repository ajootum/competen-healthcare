-- CPR-CORE-MOS-001 phase 1 - canonical Practice identity and the typed subject model.
--
-- WHAT THIS DOES NOT DO, AND WHY THAT IS THE POINT
--
-- s3 warns: "Do not add polymorphism blindly to tables whose semantics are intrinsically
-- hospital-specific." So this migration adds NOTHING to op_incidents, gov_risks, gov_controls,
-- gov_obligations or workspace_config_overrides. Those five key on hospital_id, and op_incidents also
-- carries patient_id and shift_id. Bolting a subject column onto a clinical incident record would make
-- a product incident expressible in a table whose every other column means something else. Phases 4 and
-- 5 decide generalize-or-replace for each - this phase establishes the vocabulary they will use.
--
-- It also does NOT add commercial_account_id or subscription_id to practice_workspace, even though s4
-- lists both. plat_subscriptions.tenant_id and plat_billing_accounts.tenant_id are both NOT NULL and
-- reference tenants(id), so no row in either can exist for a Practice today. A nullable column pointing
-- at a table that cannot hold the row would read as "the gap is closed" while closing nothing. Phase 7
-- adds those references when the commercial substrate can actually carry a Practice.
--
-- WHAT IT ESTABLISHES
--
--   1. The eight subject types from s3, as one vocabulary a later table can key against.
--   2. A DERIVED subject registry - product to market to practice - so the s3 parent/context chain can be
--      reconstructed without a second copy of anything.
--   3. The two identity-contract fields from s4 that have no representation at all today.
--
-- WHY THE REGISTRY IS A VIEW AND NOT A TABLE
--
-- A subject table would need a trigger or a job to stay in step with practice_workspace, and a stale
-- subject registry is worse than none - it would answer confidently about a practice that had been
-- renamed, archived or created since the last sync. A view cannot drift. Nothing here needs to be
-- written to, because phase 1 establishes the MODEL, and the records that reference a subject arrive in
-- phases 4 onward carrying subject_type plus subject_id as their own columns.

create table if not exists mos_subject_type (
  code        text primary key,
  description text not null,
  -- true when a subject of this type is a singleton and its subject_id is therefore null
  singleton   boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table mos_subject_type is
  'CPR-CORE-MOS-001 s3 canonical subject types. One vocabulary so a management-plane record cannot invent a scope.';

-- RLS on, and DELIBERATELY WITHOUT A POLICY, so it fails closed. This is a platform vocabulary read by
-- management-plane loaders through the service-role client, which bypasses RLS. No authenticated caller
-- has any reason to read it directly, and granting one now would widen a surface before anything needs
-- it. A later phase that gives a client a reason adds the policy with that reason recorded.
alter table mos_subject_type enable row level security;

insert into mos_subject_type (code, description, singleton) values
  ('platform',     'Competen shared platform scope', true),
  ('product',      'Competen Practice as a product', true),
  ('market',       'Country or market localization scope', false),
  ('plan_segment', 'Commercial or entitlement cohort where applicable', false),
  ('practice',     'A canonical Competen Practice workspace', false),
  ('practitioner', 'A practitioner operating within or against Practice context', false),
  ('service',      'Product service or component', false),
  ('integration',  'External dependency or provider', false)
on conflict (code) do update
  set description = excluded.description,
      singleton   = excluded.singleton;

-- s4 identity contract - the two fields with no representation anywhere today.
--
-- product_code says WHICH product a workspace belongs to. practice_entitlement already carries a
-- product_code, but an entitlement is a commercial fact and a workspace can exist before it has one, so
-- the identity cannot depend on it.
alter table practice_workspace add column if not exists product_code text not null default 'competen_practice';

-- practice_handle is the s4 human-facing identifier. Nullable because every existing workspace predates
-- it and inventing handles for them here would be this migration authoring product data.
alter table practice_workspace add column if not exists practice_handle text;

comment on column practice_workspace.product_code is
  'CPR-CORE-MOS-001 s4 - which Competen product this workspace is an instance of.';
comment on column practice_workspace.practice_handle is
  'CPR-CORE-MOS-001 s4 - human-facing identifier. Null until one is assigned.';

-- Not partial - a plain unique index over a nullable column, which Postgres already treats as allowing
-- many nulls. Two workspaces may both have no handle and may not share one.
create unique index if not exists idx_practice_workspace_handle on practice_workspace (practice_handle);

-- The s3 parent/context chain, derived so it cannot drift.
--
-- subject_id is TEXT rather than uuid because the types do not share an identifier shape: a practice is
-- a uuid, a market is an ISO country code, and the two singletons have no id at all. Casting the uuid on
-- the way out keeps one column able to address all of them.
--
-- Only the three types that can be derived from what exists today appear here. practitioner, service,
-- integration and plan_segment are declared in the vocabulary above and produce no rows yet - a row for
-- a service would have to invent a service inventory, which s8 of CPR-PD-008 records as absent.
create or replace view mos_subject as
  select
    'product'::text                     as subject_type,
    'competen_practice'::text           as subject_id,
    'Competen Practice'::text           as label,
    'platform'::text                    as parent_type,
    'competen'::text                    as parent_id
  union all
  select
    'market'::text                      as subject_type,
    w.country                           as subject_id,
    w.country                           as label,
    'product'::text                     as parent_type,
    'competen_practice'::text           as parent_id
  from practice_workspace w
  group by w.country
  union all
  select
    'practice'::text                    as subject_type,
    w.id::text                          as subject_id,
    w.name                              as label,
    'market'::text                      as parent_type,
    w.country                           as parent_id
  from practice_workspace w;

comment on view mos_subject is
  'CPR-CORE-MOS-001 s3 subject registry, DERIVED from practice_workspace so it cannot fall out of step. Product to market to practice. Other subject types are declared in mos_subject_type and gain rows in later phases.';

notify pgrst, 'reload schema';
