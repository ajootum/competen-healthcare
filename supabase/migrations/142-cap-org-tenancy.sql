-- 142: CAP-001 Phase 4 (T1) — org-tenancy dimension on cap_assets. Adds a DENORMALISED organisation_id +
-- tenant_id snapshot, resolved on populate from each asset's hospital → hospitals.organisation_id / tenant_id
-- (that hierarchy already exists: migrations 006/041). This is a VISIBILITY / inheritance dimension for the
-- Asset Browser — assets roll up to the org that owns their hospital. It is NOT an isolation boundary: access
-- is still governed by hospital_id. No FK (snapshot idiom, same as cap_assets.hospital_id). Plain, idempotent.

alter table cap_assets add column if not exists organisation_id uuid;
alter table cap_assets add column if not exists tenant_id       uuid;
create index if not exists idx_cap_assets_org on cap_assets(organisation_id);

notify pgrst, 'reload schema';
