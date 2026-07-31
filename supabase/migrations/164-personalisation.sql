-- 164: Personalisation, Preferences & Workspace Experience (UMW-TLS-005).
--
-- THE GAP THIS CLOSES. Personal preferences today live in a per-browser cookie (pw_prefs, PW-012). That is
-- genuinely persistent on one device and was honestly labelled as such, but TLS-005's acceptance criterion
-- is "preferences sync automatically" and "preferences roam across devices" - which a cookie cannot do.
-- These tables move preferences server-side so one person has ONE set of settings, not one per browser.
--
-- WHAT IS DELIBERATELY *NOT* ADDED HERE: a second module-visibility mechanism. The Workspace Configuration
-- Engine (migration 076) already resolves platform -> tenant -> hospital -> unit -> role -> USER, and its
-- user scope is exactly TLS-005's "enterprise defaults inherited, permitted user overrides configurable".
-- Personal show/hide therefore writes workspace_config_overrides at user scope. A parallel store would let
-- a manager's personal view disagree with what their tenant actually enabled.
--
-- pref_policies is the governance half the spec asks for: a tenant or hospital sets the default AND decides
-- whether a person may change it at all. Without it "enterprise defaults" would just be initial values that
-- anyone could overwrite, which is not governance.
--
-- Plain idempotent statements only (no do-blocks). Pure ASCII. RLS: a user reads their OWN rows; policies are
-- readable by any authenticated user (they describe what is permitted, not personal data); writes service-role.

-- One row per person. Sparse on purpose: a NULL column means "not chosen", so the resolver falls through to
-- the policy default rather than to a hard-coded value that would silently override the tenant.
create table if not exists user_preferences (
  user_id        uuid primary key references profiles(id) on delete cascade,
  theme          text check (theme in ('light','dark','system')),
  density        text check (density in ('standard','compact','spacious')),
  font_scale     text check (font_scale in ('small','standard','large','x-large')),
  reduced_motion boolean,
  high_contrast  boolean,
  language       text,
  timezone       text,
  date_format    text check (date_format in ('iso','dmy','mdy')),
  time_format    text check (time_format in ('12h','24h')),
  landing_route  text,
  email_digest   text check (email_digest in ('daily','weekly','none')),
  ai_suggestions boolean,
  ai_verbosity   text check (ai_verbosity in ('brief','standard','detailed')),
  notes          text,
  updated_at     timestamptz not null default now()
);

-- Saved workspace views: a named route + filter set a person returns to. `is_default` is what a landing
-- route resolves to; enforced as at most one per (user, workspace) by a partial unique index.
create table if not exists user_saved_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  workspace  text not null default 'unit-manager',
  name       text not null,
  route      text not null,
  filters    jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_saved_views_user on user_saved_views(user_id, workspace);
create unique index if not exists idx_user_saved_views_one_default
  on user_saved_views(user_id, workspace) where is_default;

-- Enterprise defaults AND the permission to override them. scope_type mirrors the configuration engine's
-- vocabulary so the two layers cannot describe the same hierarchy in two different ways.
create table if not exists pref_policies (
  id           uuid primary key default gen_random_uuid(),
  scope_type   text not null default 'hospital' check (scope_type in ('platform','tenant','hospital','unit','role')),
  scope_ref    uuid,
  pref_key     text not null,
  default_value text,
  user_editable boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  unique (scope_type, scope_ref, pref_key)
);
create index if not exists idx_pref_policies_key on pref_policies(pref_key);

-- "All preference changes auditable where required" - so the audit records the OLD and NEW value and which
-- policy, if any, governed the change. A change that a policy forbade never reaches this table: it is
-- rejected at the API, and rejecting silently would be the worse failure.
create table if not exists user_preference_audit (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  pref_key   text not null,
  old_value  text,
  new_value  text,
  source     text not null default 'user',
  created_at timestamptz not null default now()
);
create index if not exists idx_user_preference_audit_user on user_preference_audit(user_id, created_at desc);

alter table user_preferences enable row level security;
alter table user_saved_views enable row level security;
alter table pref_policies enable row level security;
alter table user_preference_audit enable row level security;

drop policy if exists user_preferences_own on user_preferences;
create policy user_preferences_own on user_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_saved_views_own on user_saved_views;
create policy user_saved_views_own on user_saved_views for select to authenticated
  using (user_id = auth.uid());

drop policy if exists user_preference_audit_own on user_preference_audit;
create policy user_preference_audit_own on user_preference_audit for select to authenticated
  using (user_id = auth.uid());

-- Policies describe what is permitted, not who anyone is - readable by any authenticated user, because the
-- client has to be able to tell a person WHY a setting is locked.
drop policy if exists pref_policies_read on pref_policies;
create policy pref_policies_read on pref_policies for select to authenticated using (true);

notify pgrst, 'reload schema';
