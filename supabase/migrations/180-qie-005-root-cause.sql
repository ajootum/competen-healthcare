-- ============================================================
-- MIGRATION 180: QIE-005 ROOT CAUSE & CAUSAL INTELLIGENCE
--
-- The one genuine gap the QIE-000 inventory found. Ten of the thirteen engines the spec describes already
-- exist here under other names -- metrics, predictions, benchmarks, the event spine, the executive
-- service, configuration, the audit trail -- so QIE composes those rather than copying them. This is the
-- module with nothing behind it: 8 incidents are recorded and NOT ONE has a root-cause analysis, because
-- there is nowhere to put one. Every incident is captured, closed, and forgotten.
--
-- TWO TABLES, NOT SEVEN. The spec names a Causal Knowledge Graph, an RCA Engine, a Contributing Factors
-- Engine, a Correlation Engine, an Evidence Engine and an Explainability Service. Those are capabilities,
-- not tables. What an investigation actually needs to persist is: the investigation, and the factors it
-- found. Correlation and explainability are computed from those; a knowledge graph over 8 incidents would
-- be furniture.
--
-- THE FIVE WHYS LIVE ON THE INVESTIGATION, as an ordered jsonb array, because a why-chain is linear, owned
-- entirely by one investigation, and never queried across investigations. A table for it would buy nothing
-- but joins.
--
-- LINKAGE IS THE POINT. incident_id ties the analysis to the event that prompted it, and capa_action_id
-- ties it to the corrective action that came out of it -- the loop QIE-005 exists to close. Both are
-- nullable and ON DELETE SET NULL: an investigation can be opened without an incident (a trend, an audit
-- finding), and deleting a CAPA must not erase the analysis that justified it.
--
-- RLS enabled with no client policies -- the service-role-only pattern this codebase settled on in
-- migration 074 and uses for 140 tables. Tenant scope is enforced in code.
--
-- Additive, idempotent, plain statements, ASCII only.
-- ============================================================

create table if not exists rca_investigations (
  id                 uuid primary key default gen_random_uuid(),
  hospital_id        uuid references hospitals(id) on delete cascade,
  incident_id        uuid references op_incidents(id) on delete set null,
  capa_action_id     uuid references capa_actions(id) on delete set null,
  title              text not null,
  status             text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'closed')),
  method             text not null default 'fishbone' check (method in ('fishbone', 'five_whys', 'swiss_cheese', 'mixed')),
  whys               jsonb not null default '[]'::jsonb,
  root_cause_summary text,
  -- Confidence is recorded as a WORD, not a percentage. An investigator can defend "medium"; a 73% on a
  -- judgement made from five interviews is a number pretending to be evidence.
  confidence         text check (confidence in ('high', 'medium', 'low')),
  opened_by          uuid references profiles(id) on delete set null,
  opened_by_name     text,
  opened_at          timestamptz not null default now(),
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);

-- The Ishikawa categories the spec's fishbone names, plus the two the healthcare causal model adds
-- (communication and management). A factor that fits none of them is a category this list is missing.
create table if not exists rca_factors (
  id                uuid primary key default gen_random_uuid(),
  investigation_id  uuid not null references rca_investigations(id) on delete cascade,
  category          text not null check (category in ('people', 'process', 'equipment', 'environment', 'measurement', 'materials', 'communication', 'management')),
  description       text not null,
  -- A contributing factor is not a root cause. The spec separates them and so does this: several factors
  -- contribute, few are causal, and flattening the two is how an investigation ends with eight "causes".
  is_root_cause     boolean not null default false,
  impact_rank       int,
  evidence_note     text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_rca_inv_hospital  on rca_investigations(hospital_id, status, opened_at desc);
create index if not exists idx_rca_inv_incident  on rca_investigations(incident_id);
create index if not exists idx_rca_inv_capa      on rca_investigations(capa_action_id);
create index if not exists idx_rca_factors_inv   on rca_factors(investigation_id, is_root_cause);

-- One open investigation per incident: two people analysing the same event in parallel produce two
-- partial answers. Completed and closed ones do not block a re-investigation, which is a real need when
-- new evidence arrives.
create unique index if not exists ux_rca_open_per_incident
  on rca_investigations(incident_id)
  where incident_id is not null and status in ('open', 'in_progress');

alter table rca_investigations enable row level security;
alter table rca_factors enable row level security;

notify pgrst, 'reload schema';
