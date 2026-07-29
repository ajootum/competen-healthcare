-- 139: CAP-001 Unified Asset-Object Model (Phase 1 — additive overlay).
-- A single governed HEADER/INDEX row per competency asset, referencing the existing 12 asset tables
-- via the platform's own (object_type, object_id) polymorphic idiom — no data is moved and no consumer
-- is rewritten. Populated by src/lib/assets/registry.ts (refreshAssets), the same way the CAP-006
-- search indexer populates knowledge_embeddings. hospital_id/status/version are DENORMALISED snapshots
-- resolved on populate (advisory, not transactional truth — the source table stays authoritative).
-- Plain, idempotent statements only (no do-blocks — the ;-splitting runner requires it).

-- ── CANONICAL ASSET-TYPE VOCABULARY ─────────────────────────
-- One agreed list, reconciling the four disagreeing per-table CHECK vocabularies. Drives the type
-- filter in the Asset Browser; the populator (registry.ts) is the authoritative source→header logic.
create table if not exists cap_asset_types (
  key          text primary key,
  label        text not null,
  source_table text not null,
  id_column    text not null default 'id',
  name_column  text not null default 'name',
  tenant_mode  text not null default 'global',   -- direct | chain | global
  sort_order   int  not null default 0
);

insert into cap_asset_types (key, label, source_table, id_column, name_column, tenant_mode, sort_order) values
  ('framework',         'Framework',              'frameworks',              'id', 'name',  'direct', 1),
  ('competency',        'Competency',             'framework_competencies',  'id', 'name',  'chain',  2),
  ('skill',             'Skill',                  'skill_library',           'id', 'name',  'global', 3),
  ('cpu',               'Clinical Practice Unit', 'clinical_practice_units', 'id', 'name',  'chain',  4),
  ('blueprint',         'Assessment Blueprint',   'assessment_blueprints',   'id', 'id',    'chain',  5),
  ('question_bank',     'Question Bank',          'question_banks',          'id', 'name',  'chain',  6),
  ('osce_station',      'OSCE Station',           'osce_stations',           'id', 'name',  'chain',  7),
  ('simulation',        'Simulation Scenario',    'simulation_scenarios',    'id', 'name',  'direct', 8),
  ('learning_resource', 'Learning Resource',      'learning_resources',      'id', 'title', 'direct', 9),
  ('knowledge_object',  'Knowledge Object',       'knowledge_objects',       'id', 'title', 'chain',  10),
  ('package',           'Competency Package',     'competency_packages',     'id', 'name',  'direct', 11),
  ('publication',       'Publication',            'cmo_publications',        'id', 'name',  'direct', 12)
on conflict (key) do update set
  label = excluded.label, source_table = excluded.source_table, id_column = excluded.id_column,
  name_column = excluded.name_column, tenant_mode = excluded.tenant_mode, sort_order = excluded.sort_order;

-- ── UNIFIED ASSET HEADER / INDEX ────────────────────────────
-- object_id is a soft reference (no FK — the referenced table varies by type, exactly as object_tags,
-- knowledge_edges, cap_asset_translations and competency_package_items already do). hospital_id/owner_id
-- are denormalised snapshots (no FK) so a populate never fails on an orphaned parent reference.
create table if not exists cap_assets (
  id                uuid primary key default gen_random_uuid(),
  object_type       text not null,
  object_id         uuid not null,
  name              text,
  owner_id          uuid,
  hospital_id       uuid,                     -- resolved on populate; null = enterprise/global
  domain            text,
  status            text,                     -- normalised: draft|in_review|approved|published|active|archived
  version           text,
  language          text not null default 'en',
  tags              jsonb not null default '[]'::jsonb,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  indexed_at        timestamptz not null default now(),
  unique (object_type, object_id)
);

create index if not exists idx_cap_assets_type     on cap_assets(object_type);
create index if not exists idx_cap_assets_hospital  on cap_assets(hospital_id);
create index if not exists idx_cap_assets_status    on cap_assets(status);
create index if not exists idx_cap_assets_name      on cap_assets(name);

-- ── RLS ── authenticated read; writes are service-role (createAdminClient bypasses RLS) ──
alter table cap_asset_types enable row level security;
drop policy if exists cap_asset_types_read on cap_asset_types;
create policy cap_asset_types_read on cap_asset_types for select to authenticated using (true);

alter table cap_assets enable row level security;
drop policy if exists cap_assets_read on cap_assets;
create policy cap_assets_read on cap_assets for select to authenticated using (true);

notify pgrst, 'reload schema';
