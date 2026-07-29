-- 135: CST-042 Portfolio Assessment Designer — portfolio templates with required-evidence sections. A
-- template defines a portfolio type and a set of sections, each requiring a number of evidence artefacts
-- of a given type at a weight (sections should sum to 100%). Plain, idempotent statements only. RLS =
-- authenticated read; service-role writes.

create table if not exists cst_portfolio_templates (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  description       text,
  portfolio_type    text not null default 'competency'
                      check (portfolio_type in ('learning','competency','epa','clinical','leadership','research','custom')),
  status            text not null default 'draft' check (status in ('draft','active','archived')),
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_cstpf_hospital on cst_portfolio_templates(hospital_id);
create index if not exists idx_cstpf_status on cst_portfolio_templates(status);
alter table cst_portfolio_templates enable row level security;
drop policy if exists cst_portfolio_templates_read on cst_portfolio_templates;
create policy cst_portfolio_templates_read on cst_portfolio_templates for select to authenticated using (true);

create table if not exists cst_portfolio_sections (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references cst_portfolio_templates(id) on delete cascade,
  name              text not null,
  evidence_type     text not null default 'document'
                      check (evidence_type in ('case_log','procedure_log','reflection','certificate','assessment','project','document','feedback','osce','other')),
  required_count    int not null default 1,
  weight            int not null default 0,
  is_required       boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_cstpfsec_template on cst_portfolio_sections(template_id);
alter table cst_portfolio_sections enable row level security;
drop policy if exists cst_portfolio_sections_read on cst_portfolio_sections;
create policy cst_portfolio_sections_read on cst_portfolio_sections for select to authenticated using (true);

notify pgrst, 'reload schema';
