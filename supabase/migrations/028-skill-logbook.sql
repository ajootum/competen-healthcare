-- 028 — Clinician-owned Skills Logbook (Skills Logbook Redesign spec)
-- Workers log skills they performed; a supervisor (assessor/educator) verifies.
-- Distinct from skill_scores, which remain the assessor-scored record.
-- Idempotent: safe to re-run.

create table if not exists skill_log_entries (
  id                uuid primary key default gen_random_uuid(),
  nurse_id          uuid not null references profiles(id) on delete cascade,
  skill_id          uuid references competency_skills(id) on delete set null,
  skill_name        text not null,
  competency_id     uuid references framework_competencies(id) on delete set null,
  cpu_id            uuid references clinical_practice_units(id) on delete set null,
  performed_at      date not null default current_date,
  location          text,
  supervision_level text not null default 'supervised' check (supervision_level in
                      ('observed','assisted','supervised','independent')),
  notes             text,
  status            text not null default 'pending' check (status in
                      ('pending','verified','rejected','changes_requested')),
  verified_by       uuid references profiles(id),
  verified_by_name  text,
  verified_at       timestamptz,
  verifier_comment  text,
  created_at        timestamptz default now()
);

create index if not exists idx_skill_log_nurse  on skill_log_entries(nurse_id, performed_at desc);
create index if not exists idx_skill_log_status on skill_log_entries(status) where status = 'pending';

alter table skill_log_entries enable row level security;

do $$ begin
  create policy skill_log_read_own on skill_log_entries
    for select using (nurse_id = auth.uid() or current_user_is_super_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy skill_log_insert_own on skill_log_entries
    for insert with check (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
