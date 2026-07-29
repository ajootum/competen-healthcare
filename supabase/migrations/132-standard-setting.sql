-- 132: CST-044 Assessment Standard Setting — defensible cut-score studies (Angoff / Ebel / Bookmark /
-- Borderline / Hofstee). A study collects per-item judge ratings; the recommended cut score is computed
-- from the mean per-item rating, and its impact (pass rate) is derived from the linked bank's real
-- knowledge_attempts. Plain, idempotent statements only. RLS = authenticated read; service-role writes.

create table if not exists cst_standard_settings (
  id                uuid primary key default gen_random_uuid(),
  hospital_id       uuid references hospitals(id) on delete cascade,
  name              text not null,
  bank_id           uuid references question_banks(id) on delete set null,
  method            text not null default 'modified_angoff'
                      check (method in ('angoff','modified_angoff','ebel','borderline_group','borderline_regression','hofstee','bookmark','custom')),
  status            text not null default 'draft' check (status in ('draft','calibration','in_progress','review','approved','published')),
  target_pass_low   int,
  target_pass_high  int,
  final_cut         numeric,
  notes             text,
  created_by        uuid references profiles(id) on delete set null,
  created_by_name   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_cstss_hospital on cst_standard_settings(hospital_id);
create index if not exists idx_cstss_status on cst_standard_settings(status);
alter table cst_standard_settings enable row level security;
drop policy if exists cst_standard_settings_read on cst_standard_settings;
create policy cst_standard_settings_read on cst_standard_settings for select to authenticated using (true);

create table if not exists cst_standard_judgements (
  id                uuid primary key default gen_random_uuid(),
  study_id          uuid not null references cst_standard_settings(id) on delete cascade,
  judge_name        text not null,
  item_label        text not null,
  rating            numeric not null,
  round             int not null default 1,
  created_at        timestamptz not null default now()
);
create index if not exists idx_cstsj_study on cst_standard_judgements(study_id);
alter table cst_standard_judgements enable row level security;
drop policy if exists cst_standard_judgements_read on cst_standard_judgements;
create policy cst_standard_judgements_read on cst_standard_judgements for select to authenticated using (true);

notify pgrst, 'reload schema';
