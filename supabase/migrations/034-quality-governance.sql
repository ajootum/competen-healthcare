-- 034: Quality & Governance module (Quality & Audit Architecture Redesign).
-- Design principle from the spec: checklists belong to the Competency
-- Framework — audits REFERENCE checklist items dynamically and never define
-- their own templates. audit_findings stores the immutable *record* of what
-- was observed (item snapshot + result) for governance, not a template.
-- Failed critical criteria auto-create CAPA actions (/api/quality/audits).
create table if not exists audits (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete set null,
  audit_type        text not null check (audit_type in ('concurrent','retrospective','clinical')),
  title             text not null,
  competency_id     uuid references framework_competencies(id) on delete set null,
  nurse_id          uuid references profiles(id) on delete set null,
  area              text,
  record_ref        text,
  status            text not null default 'completed'
                      check (status in ('planned','in_progress','completed')),
  compliance_pct    numeric,
  items_met         int not null default 0,
  items_not_met     int not null default 0,
  items_na          int not null default 0,
  note              text,
  conducted_by      uuid references profiles(id) on delete set null,
  conducted_by_name text,
  conducted_at      timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index if not exists idx_audits_hospital on audits(hospital_id, conducted_at desc);

create table if not exists audit_findings (
  id                uuid primary key default gen_random_uuid(),
  audit_id          uuid not null references audits(id) on delete cascade,
  checklist_item_id uuid references checklist_items(id) on delete set null,
  item_text         text not null,
  result            text not null check (result in ('met','not_met','na')),
  is_critical       boolean not null default false,
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_findings_audit on audit_findings(audit_id);

create table if not exists capa_actions (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   uuid references hospitals(id) on delete set null,
  audit_id      uuid references audits(id) on delete set null,
  title         text not null,
  description   text,
  priority      text not null default 'medium' check (priority in ('low','medium','high')),
  status        text not null default 'open'
                  check (status in ('open','in_progress','completed','verified','closed')),
  due_date      date,
  owner_id      uuid references profiles(id) on delete set null,
  owner_name    text,
  evidence_note text,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists idx_capa_hospital on capa_actions(hospital_id, status, due_date);

alter table audits         enable row level security;
alter table audit_findings enable row level security;
alter table capa_actions   enable row level security;

do $$ begin
  create policy audits_select_involved on audits
    for select using (conducted_by = auth.uid() or nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy findings_select_involved on audit_findings
    for select using (
      exists (select 1 from audits a where a.id = audit_id
              and (a.conducted_by = auth.uid() or a.nurse_id = auth.uid()))
    );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy capa_select_involved on capa_actions
    for select using (owner_id = auth.uid() or created_by = auth.uid());
exception when duplicate_object then null; end $$;
-- No client insert/update policies: writes go through /api/quality/* (service role).
