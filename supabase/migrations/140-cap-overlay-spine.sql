-- 140: CAP-001 Phase 4 (overlay spine). Promotes cap_assets from a read-only index to the referential
-- CENTRE: the existing polymorphic overlays gain a real FK to cap_assets, so tags, translations, package
-- items and embeddings all point at the one governed header. Additive & reversible — a nullable
-- cap_asset_id (drop the column to undo).
--
-- Resilient by design: `alter table if exists` means a missing overlay table (e.g. cap_asset_translations
-- if migration 137 hasn't been applied on this database) is skipped silently rather than aborting the whole
-- migration. The backfill/relink is done by the populator (src/lib/assets/registry.ts relinkOverlays), which
-- runs on every "Refresh index" and reconciles the few divergent type names (osce→osce_station,
-- resource→learning_resource) with per-overlay guards — so overlays that don't exist yet just report 0/0.
-- knowledge_edges (a relationship BETWEEN two assets, not one) is deliberately deferred — it needs two FKs.

alter table if exists object_tags              add column if not exists cap_asset_id uuid references cap_assets(id) on delete set null;
alter table if exists cap_asset_translations   add column if not exists cap_asset_id uuid references cap_assets(id) on delete set null;
alter table if exists competency_package_items add column if not exists cap_asset_id uuid references cap_assets(id) on delete set null;
alter table if exists knowledge_embeddings     add column if not exists cap_asset_id uuid references cap_assets(id) on delete set null;

notify pgrst, 'reload schema';
