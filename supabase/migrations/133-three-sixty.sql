-- 133: CST-041 360° Assessment Designer — multisource feedback templates. An assessment defines the
-- rating scale, confidentiality (anonymous + minimum raters) and a set of WEIGHTED respondent groups
-- (self / peer / supervisor / subordinate / team / patient / family / external) that should sum to 100%.
-- Plain, idempotent statements only. RLS = authenticated read; service-role writes.

create table if not exists cst_360_assessments (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  description       text,
  rating_scale      text not null default 'likert5' check (rating_scale in ('likert5','likert3','bars','global','binary')),
  min_raters        int not null default 3,
  anonymous         boolean not null default true,
  status            text not null default 'draft' check (status in ('draft','active','archived')),
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_cst360_hospital on cst_360_assessments(hospital_id);
create index if not exists idx_cst360_status on cst_360_assessments(status);
alter table cst_360_assessments enable row level security;
drop policy if exists cst_360_assessments_read on cst_360_assessments;
create policy cst_360_assessments_read on cst_360_assessments for select to authenticated using (true);

create table if not exists cst_360_respondent_groups (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references cst_360_assessments(id) on delete cascade,
  group_type        text not null default 'peer'
                      check (group_type in ('self','peer','supervisor','subordinate','team','patient','family','external')),
  weight            int not null default 0,
  is_required       boolean not null default false,
  created_at        timestamptz not null default now()
);
create unique index if not exists uq_cst360_group on cst_360_respondent_groups (assessment_id, group_type);
create index if not exists idx_cst360grp_assessment on cst_360_respondent_groups(assessment_id);
alter table cst_360_respondent_groups enable row level security;
drop policy if exists cst_360_respondent_groups_read on cst_360_respondent_groups;
create policy cst_360_respondent_groups_read on cst_360_respondent_groups for select to authenticated using (true);

notify pgrst, 'reload schema';
