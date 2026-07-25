-- 092: Platform Configuration Registry (WCE-002) — the authoritative catalogue of every configurable platform
-- object. Complements WCE-001 (which resolves sparse workspace_config_overrides onto a code catalogue): WCE-002
-- turns that catalogue into structured, versioned registry data so configuration is no longer hard-coded. The
-- registry is SEEDED from the real in-code WORKSPACE_CATALOG via the app's "sync from catalogue" action (the
-- registry never invents objects). MVP object model + immutable audit; the deeper property / version /
-- relationship tables (§32) are next-phase. Idempotent; RLS service-role only (writes via the admin client
-- behind super-admin-gated APIs).

create table if not exists configuration_registry_objects (
  id uuid primary key default gen_random_uuid(),
  object_key text not null unique,                     -- permanent machine key, e.g. workspace.unit-manager.quality
  object_type text not null default 'MODULE'
    check (object_type in ('PLATFORM','PRODUCT_SUITE','WORKSPACE','NAVIGATION_SECTION','MODULE','PAGE','VIEW','TAB','PANEL','WIDGET','METRIC','FORM','FIELD','TABLE','COLUMN','FILTER','ACTION','WORKFLOW','APPROVAL_RULE','BUSINESS_RULE','NOTIFICATION','ALERT','REPORT','DASHBOARD','TEMPLATE','DATA_SOURCE','INTEGRATION','AI_CAPABILITY','TERMINOLOGY_SET','PERMISSION','FEATURE_FLAG','POLICY_CONTROL')),
  display_name text not null,
  short_name text,
  description text,
  parent_object_key text,                              -- soft reference to another object_key
  schema_version text not null default '1.0.0',
  status text not null default 'active'
    check (status in ('draft','technical_review','product_review','safety_review','approved','published','active','deprecated','retired')),
  configurability_class text not null default 'optional'
    check (configurability_class in ('mandatory_locked','mandatory_configurable','optional','conditional','user_personalisable','deprecated','retired')),
  safety_classification text not null default 'operational'
    check (safety_classification in ('non_clinical','administrative','operational','clinical_support','clinical_safety_relevant','clinical_safety_critical','security_critical','regulatory_critical','financial_control_critical')),
  override_policy text not null default 'full'
    check (override_policy in ('none','full','restricted','extend_only','narrow_only','local_display_only','approval_required')),
  default_enabled boolean not null default true,
  mandatory boolean not null default false,
  configuration_owner text,                            -- PLATFORM / ENTERPRISE / TENANT / UNIT / ROLE / USER
  owner_team text,
  route text,
  data_source_key text,
  allowed_config_levels jsonb not null default '[]',   -- ["PLATFORM","ENTERPRISE","TENANT","UNIT"]
  dependencies jsonb not null default '[]',            -- [{type,objectKey}]
  tags jsonb not null default '[]',
  display_order int not null default 0,
  source text not null default 'catalogue',            -- catalogue (synced) | manual
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null
);
create index if not exists idx_registry_type on configuration_registry_objects(object_type);
create index if not exists idx_registry_parent on configuration_registry_objects(parent_object_key);
create index if not exists idx_registry_status on configuration_registry_objects(status);

create table if not exists configuration_registry_audit (
  id uuid primary key default gen_random_uuid(),
  object_key text,
  object_version text,
  action text not null,                                -- created / updated / synced / published / deprecated / retired
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  change_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_registry_audit_object on configuration_registry_audit(object_key, created_at desc);

alter table configuration_registry_objects enable row level security;
alter table configuration_registry_audit enable row level security;
-- No client policies on purpose: reads/writes go through the service-role admin client behind super-admin-gated APIs.
