-- 085: Operational Documentation store (POS-109). Operational documents (shift summary, handover
-- summary, admission summary, ward-round summary, transfer note, discharge summary) are GENERATED
-- from the live operational dataset and then held as an immutable, versioned, signable record —
-- "current state plus immutable history" (POS-001 §3.2). Template DEFINITIONS live in code
-- (lib/operations/doc-templates.ts) with tenant-configurable templates governed by POS-112 as an
-- honest next-phase; this store holds the generated document INSTANCES.
--
-- Key rules:
--   • content is a jsonb SNAPSHOT of what the document said at generation time — regenerating never
--     mutates a finalised document; it supersedes it (supersedes_id), preserving history (BR-008-style).
--   • A signed document is immutable: electronic signature (§6) records signed_by + signed_at.
--   • No PHI: documents reference operational patient labels; identity/clinical detail stays in EMR.
--
-- Idempotent; RLS enabled, service-role only — reads/writes go through the audited, role-gated
-- /api/operations/pos-documents API, matching migrations 050 / 084.

create table if not exists op_documents (
  id             uuid primary key default gen_random_uuid(),
  hospital_id    uuid not null references hospitals(id) on delete cascade,
  department_id  uuid references departments(id) on delete set null,
  patient_id     uuid references op_patients(id) on delete set null,
  template_key   text not null,                       -- 'shift_summary','handover_summary',…
  doc_type       text,
  title          text not null,
  content        jsonb not null default '[]'::jsonb,  -- [{heading, lines:[…]}] generation snapshot
  status         text not null default 'draft' check (status in ('draft','finalised','signed','superseded')),
  version        integer not null default 1,
  supersedes_id  uuid references op_documents(id) on delete set null,
  generated_by   uuid references profiles(id) on delete set null,
  signed_by      uuid references profiles(id) on delete set null,
  signed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_op_documents_hosp on op_documents(hospital_id, created_at desc);
create index if not exists idx_op_documents_patient on op_documents(patient_id, created_at desc);
create index if not exists idx_op_documents_template on op_documents(hospital_id, template_key);
create index if not exists idx_op_documents_status on op_documents(hospital_id, status);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='op_documents') then
    execute 'alter table public.op_documents enable row level security';
  end if;
end $$;
