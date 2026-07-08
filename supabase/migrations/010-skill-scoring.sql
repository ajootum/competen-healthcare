-- ============================================================
-- PHASE 4: Skill-Level Scoring (Benner 0-6 Scale)
-- Skills scored independently, aggregated to competency → domain → framework
-- ============================================================

-- ── SKILL SCORES ────────────────────────────────────────────
-- One row per skill per assessment session (per nurse per cycle per assessor)
create table if not exists skill_scores (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references competency_cycles(id) on delete cascade,
  skill_id      uuid not null references competency_skills(id) on delete cascade,
  competency_id uuid not null references framework_competencies(id),
  domain_id     uuid not null references framework_domains(id),
  framework_id  uuid not null references frameworks(id),
  assessor_id   uuid references profiles(id),
  score         int  not null check (score >= 0 and score <= 6),
  notes         text,
  assessed_at   timestamptz default now(),
  created_at    timestamptz default now(),
  unique (cycle_id, skill_id, assessor_id)
);

-- ── BENNER SCALE REFERENCE ──────────────────────────────────
create table if not exists benner_scale (
  score       int  primary key check (score >= 0 and score <= 6),
  label       text not null,
  description text not null,
  is_passing  boolean not null default false
);

insert into benner_scale (score, label, description, is_passing) values
  (0, 'Requires Training',    'Requires training to perform this activity satisfactorily to participate in the clinical environment.', false),
  (1, 'Novice',               'Can perform this activity with constant supervision and some assistance.', false),
  (2, 'Advanced Beginner',    'Can perform this activity satisfactorily but requires some supervision and assistance.', false),
  (3, 'Competent',            'Can perform this activity satisfactorily without supervision and assistance.', true),
  (4, 'Competent+',           'Can perform this activity without supervision with more than acceptable speed and quality of work.', true),
  (5, 'Proficient',           'Can perform this activity with initiative and adaptability to special problem situations.', true),
  (6, 'Expert',               'Can perform this activity and can lead others in performing this activity.', true)
on conflict (score) do update set
  label = excluded.label,
  description = excluded.description,
  is_passing = excluded.is_passing;

-- ── AGGREGATE: skill → competency score ─────────────────────
-- Function to recalculate competency_scores from skill_scores
create or replace function recalculate_competency_score(p_cycle_id uuid, p_competency_id uuid)
returns void language plpgsql security definer as $$
declare
  v_avg      numeric;
  v_final    int;
  v_label    text;
  v_passing  boolean;
  v_domain   uuid;
  v_framework uuid;
  v_count    int;
begin
  select
    round(avg(s.score), 2),
    round(avg(s.score))::int,
    count(*)
  into v_avg, v_final, v_count
  from skill_scores s
  where s.cycle_id = p_cycle_id and s.competency_id = p_competency_id;

  if v_count = 0 then return; end if;

  select label, is_passing into v_label, v_passing
  from benner_scale where score = v_final;

  select domain_id, framework_id into v_domain, v_framework
  from skill_scores where cycle_id = p_cycle_id and competency_id = p_competency_id limit 1;

  insert into competency_scores (cycle_id, competency_id, domain_id, framework_id, assessor_count, avg_score, final_score, level_label, is_passing)
  values (p_cycle_id, p_competency_id, v_domain, v_framework, v_count, v_avg, v_final, v_label, coalesce(v_passing, false))
  on conflict (cycle_id, competency_id) do update set
    assessor_count = excluded.assessor_count,
    avg_score      = excluded.avg_score,
    final_score    = excluded.final_score,
    level_label    = excluded.level_label,
    is_passing     = excluded.is_passing;
end;
$$;

-- ── AGGREGATE: competency → domain score ────────────────────
create or replace function recalculate_domain_score(p_cycle_id uuid, p_domain_id uuid)
returns void language plpgsql security definer as $$
declare
  v_avg        numeric;
  v_count      int;
  v_passing    int;
  v_framework  uuid;
begin
  select
    round(avg(cs.avg_score), 2),
    count(*),
    count(*) filter (where cs.is_passing)
  into v_avg, v_count, v_passing
  from competency_scores cs
  where cs.cycle_id = p_cycle_id and cs.domain_id = p_domain_id;

  if v_count = 0 then return; end if;

  select framework_id into v_framework
  from competency_scores where cycle_id = p_cycle_id and domain_id = p_domain_id limit 1;

  insert into domain_scores (cycle_id, domain_id, framework_id, avg_score, competency_count, passing_count, is_passing)
  values (p_cycle_id, p_domain_id, v_framework, v_avg, v_count, v_passing, v_passing = v_count)
  on conflict (cycle_id, domain_id) do update set
    avg_score        = excluded.avg_score,
    competency_count = excluded.competency_count,
    passing_count    = excluded.passing_count,
    is_passing       = excluded.is_passing;
end;
$$;

-- ── RLS ─────────────────────────────────────────────────────
alter table skill_scores enable row level security;
alter table benner_scale enable row level security;

-- Benner scale is public reference data
create policy "Anyone reads benner scale"
  on benner_scale for select using (true);

-- Nurses see their own skill scores
create policy "Nurse views own skill scores"
  on skill_scores for select
  using (
    exists (select 1 from competency_cycles c where c.id = cycle_id and c.nurse_id = auth.uid())
    or current_user_is_super_admin()
  );

-- Assessors can insert/update skill scores for nurses in their hospital
create policy "Assessor manages skill scores"
  on skill_scores for all
  using (
    assessor_id = auth.uid()
    or exists (
      select 1 from competency_cycles cy
      join profiles p on p.id = auth.uid()
      where cy.id = cycle_id and cy.hospital_id = p.hospital_id
        and p.role in ('assessor','educator','hospital_admin','super_admin')
    )
  );
