-- 141: CAP-001 Phase 4 (binary/object storage). Lets any competency asset carry binary files — documents,
-- images, video (CAP-001 "binary assets"). Metadata lives here; the bytes live in the private Supabase
-- Storage bucket "asset-files" (auto-created on first upload), reached only through short-lived signed URLs
-- issued server-side. Keyed the CAP way — (object_type, object_id) + a cap_asset_id FK to the unified header
-- (resolved on upload, and self-healing via relinkOverlays). Plain, idempotent statements only (no do-blocks).

create table if not exists cap_asset_files (
  id               uuid primary key default gen_random_uuid(),
  object_type      text not null,
  object_id        uuid not null,
  cap_asset_id     uuid references cap_assets(id) on delete set null,
  hospital_id      uuid,
  file_name        text not null,
  storage_path     text not null,          -- path within the asset-files bucket
  mime_type        text,
  size_bytes       bigint,
  uploaded_by      uuid references profiles(id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_cap_asset_files_obj on cap_asset_files(object_type, object_id);
create index if not exists idx_cap_asset_files_capasset on cap_asset_files(cap_asset_id);

alter table cap_asset_files enable row level security;
drop policy if exists cap_asset_files_read on cap_asset_files;
create policy cap_asset_files_read on cap_asset_files for select to authenticated using (true);

notify pgrst, 'reload schema';
