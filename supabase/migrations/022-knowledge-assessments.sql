-- ============================================================
-- MIGRATION 022: GOVERNED KNOWLEDGE ASSESSMENTS
-- Closes the loop for blueprint "knowledge" methods: question banks
-- with pass marks and validity, linked to CPUs, with formal graded
-- attempts. Reuses the existing `questions` table (practice quiz)
-- by adding bank membership — practice questions are untouched.
-- Additive & idempotent.
-- ============================================================

create table if not exists question_banks (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  cpu_id             uuid references clinical_practice_units(id) on delete set null,
  pass_mark          int not null default 80 check (pass_mark between 1 and 100),
  time_limit_minutes int,
  validity_months    int not null default 24,
  is_active          boolean not null default true,
  created_by         uuid references profiles(id),
  created_at         timestamptz default now()
);

-- Bank membership for existing questions table (null = practice-only question)
alter table questions add column if not exists bank_id uuid references question_banks(id) on delete set null;
create index if not exists idx_questions_bank on questions(bank_id);

-- Formal graded attempts (bank-level, unlike per-question quiz_attempts)
create table if not exists knowledge_attempts (
  id           uuid primary key default gen_random_uuid(),
  bank_id      uuid not null references question_banks(id) on delete cascade,
  nurse_id     uuid not null references profiles(id) on delete cascade,
  total        int not null,
  correct      int not null,
  score        numeric not null,          -- percentage
  passed       boolean not null,
  answers      jsonb,                     -- { question_id: chosen_index }
  completed_at timestamptz default now()
);
create index if not exists idx_kattempts_nurse on knowledge_attempts(nurse_id, bank_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table question_banks     enable row level security;
alter table knowledge_attempts enable row level security;

do $$ begin
  create policy "Authenticated read banks" on question_banks for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write banks" on question_banks for all using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Nurse reads own attempts" on knowledge_attempts for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff read attempts" on knowledge_attempts for select using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
