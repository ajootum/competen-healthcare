-- ============================================================
-- MIGRATION 185: PINNED MODULES / FAVOURITES (HWW-UI-005 s19)
--
-- "Allow users to pin favourite modules." A personal preference, so it belongs beside the personalisation
-- layer from migration 164 (user_preferences, user_saved_views) rather than in the WCE override store --
-- workspace_config_overrides is GOVERNANCE (what a hospital permits), and a nurse pinning Medications is
-- not a governance act. Filing it there would let a personal choice look like a configured policy.
--
-- Deliberately NOT reusing user_saved_views: that table carries a route PLUS a filter set and an is_default
-- flag, i.e. "a view I return to". A pin is a pointer to a module the sidebar already resolves. Storing one
-- as the other would mean every reader of saved views had to learn to skip the rows that are not views.
--
-- STORES THE KEY, NOT THE LABEL OR HREF. Labels are renameable per hospital through the WCE and hrefs move
-- between releases; a pin that cached either would drift into showing a stale name or a dead link. The key
-- is resolved against the live nav catalogue at render time, so a pin to a module that is later disabled or
-- removed simply stops appearing rather than becoming a broken row.
--
-- RLS: own-row select, matching migration 164. Writes go through the API on the service-role client, which
-- checks the caller owns the row.
--
-- Plain statements, idempotent, no do-blocks, ASCII only.
-- ============================================================

create table if not exists user_pinned_modules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  workspace  text not null default 'healthcare-worker',
  module_key text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

-- One pin per module per workspace per person: pinning twice is a no-op, not a duplicate row.
create unique index if not exists ux_pinned_module on user_pinned_modules(user_id, workspace, module_key);
create index if not exists idx_pinned_user on user_pinned_modules(user_id, workspace, sort_order);

alter table user_pinned_modules enable row level security;

drop policy if exists user_pinned_modules_own on user_pinned_modules;
create policy user_pinned_modules_own on user_pinned_modules for select to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
