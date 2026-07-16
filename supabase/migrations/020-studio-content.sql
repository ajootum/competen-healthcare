-- ============================================================
-- MIGRATION 020: COMPETEN STUDIO — modular reusable content
-- Implements "latest competen" spec: build once, reuse everywhere.
--  1) skill_library — skills as standalone reusable objects with types,
--     attachable to many competencies (competency_skills gains a
--     library_skill_id lineage reference; existing rows untouched)
--  2) checklist_items — sections, scoring methods, evidence capture,
--     assessor notes (extends 007 schema)
-- Additive & idempotent.
-- ============================================================

-- ── SKILL LIBRARY (reusable skill objects) ──────────────────
create table if not exists skill_library (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  skill_type           text not null default 'psychomotor'
                         check (skill_type in ('psychomotor','cognitive','communication',
                                               'decision_making','leadership','documentation','safety_critical')),
  performance_criteria text,
  required_knowledge   text,
  is_active            boolean not null default true,
  created_by           uuid references profiles(id),
  created_at           timestamptz default now()
);

-- Lineage: a competency skill can be an instance of a library skill
alter table competency_skills add column if not exists library_skill_id uuid references skill_library(id) on delete set null;
create index if not exists idx_cskills_library on competency_skills(library_skill_id);

-- ── CHECKLIST DEPTH (spec §4) ───────────────────────────────
alter table skill_checklists add column if not exists assessor_instructions text;

alter table checklist_items add column if not exists section text;
alter table checklist_items add column if not exists is_required boolean not null default true;
alter table checklist_items add column if not exists scoring_method text not null default 'done_not_done';
alter table checklist_items add column if not exists evidence_required text;
alter table checklist_items add column if not exists assessor_note text;

do $$ begin
  alter table checklist_items add constraint checklist_items_scoring_method_check
    check (scoring_method in ('done_not_done','competent_nyc','scale_0_2','scale_0_4','entrustment','narrative'));
exception when duplicate_object then null; end $$;

-- ── RLS ─────────────────────────────────────────────────────
alter table skill_library enable row level security;
do $$ begin
  create policy "Authenticated read" on skill_library for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write" on skill_library for all using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('super_admin','hospital_admin')));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
