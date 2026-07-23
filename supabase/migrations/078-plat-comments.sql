-- 078: Collaboration primitive (PCS-000 Collaboration). plat_comments is the
-- reusable, entity-agnostic comment/discussion store — threaded comments with
-- @-mentions that any workspace can attach to any record (a CAPA, an escalation, a
-- tenant, a competency, a platform note…) via (entity_type, entity_id). Threading is
-- self-referential (parent_id); mentions is an array of profile ids; edits and
-- deletes are soft (edited_at / deleted_at) so the trail stays intact. The store
-- starts empty — consoles show honest empty states until comments are posted; nothing
-- is fabricated. Idempotent; RLS service-role only (writes go through the audited,
-- role-gated /api/platform/comments route).

create table if not exists plat_comments (
  id           uuid primary key default gen_random_uuid(),
  hospital_id  uuid references hospitals(id) on delete cascade,   -- tenant scope (null = platform-level)
  entity_type  text not null,                                     -- what it's attached to
  entity_id    uuid not null,                                     -- the target record
  parent_id    uuid references plat_comments(id) on delete cascade, -- threading (null = root)
  body         text not null,
  mentions     uuid[] not null default '{}',                      -- mentioned profile ids
  author_id    uuid references profiles(id) on delete set null,
  author_name  text,
  edited_at    timestamptz,
  deleted_at   timestamptz,                                       -- soft delete
  created_at   timestamptz not null default now()
);
create index if not exists idx_plat_comments_entity on plat_comments(entity_type, entity_id, created_at);
create index if not exists idx_plat_comments_hospital on plat_comments(hospital_id, created_at desc);
create index if not exists idx_plat_comments_author on plat_comments(author_id);
create index if not exists idx_plat_comments_parent on plat_comments(parent_id);

alter table plat_comments enable row level security;
-- No client policies on purpose: all reads/writes go through the service-role admin
-- client behind the audited, role-gated /api/platform/comments route.
