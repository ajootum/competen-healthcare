-- ============================================================
-- PHASE 3: Assessment Engine
-- Cycle → Assessment → Evidence → Score → Validation
-- ============================================================

-- ── COMPETENCY CYCLES ──────────────────────────────────────
create table if not exists competency_cycles (
  id           uuid primary key default gen_random_uuid(),
  nurse_id     uuid not null references profiles(id) on delete cascade,
  hospital_id  uuid not null references hospitals(id),
  cycle_type   text not null check (cycle_type in ('orientation','probation','annual','remediation','specialty')),
  status       text not null default 'active'
                 check (status in ('pending','active','complete','failed','expired')),
  start_date   date not null default current_date,
  end_date     date,
  notes        text,
  created_by   uuid references profiles(id),
  created_at   timestamptz default now()
);

-- Which frameworks are in scope for a cycle
create table if not exists cycle_frameworks (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references competency_cycles(id) on delete cascade,
  framework_id uuid not null references frameworks(id),
  status       text not null default 'pending'
                 check (status in ('pending','in_progress','complete','failed')),
  framework_score numeric,
  created_at   timestamptz default now(),
  unique (cycle_id, framework_id)
);

-- ── ASSESSMENTS ─────────────────────────────────────────────
-- One row per competency per assessor per visit
create table if not exists assessments (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references competency_cycles(id) on delete cascade,
  competency_id  uuid not null references framework_competencies(id),
  assessor_id    uuid references profiles(id),
  method         text not null check (method in (
                   'knowledge','direct_observation','simulation',
                   'osce','concurrent_audit','retrospective_audit','logbook'
                 )),
  status         text not null default 'pending'
                   check (status in ('pending','in_progress','complete','validated')),
  score          int check (score >= 0 and score <= 6),
  notes          text,
  assessed_at    timestamptz,
  validated_by   uuid references profiles(id),
  validated_at   timestamptz,
  created_at     timestamptz default now()
);

-- ── EVIDENCE ────────────────────────────────────────────────
create table if not exists assessment_evidence (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references assessments(id) on delete cascade,
  evidence_type  text not null check (evidence_type in (
                   'observation_note','simulation_record','osce_result',
                   'audit_finding','logbook_entry','document','photo'
                 )),
  title          text not null,
  content        text,
  file_url       text,
  recorded_by    uuid references profiles(id),
  created_at     timestamptz default now()
);

-- ── CHECKLIST RESPONSES (direct observation) ────────────────
create table if not exists checklist_responses (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references assessments(id) on delete cascade,
  checklist_item_id uuid not null references checklist_items(id),
  response          text not null check (response in ('yes','no','na')),
  notes             text,
  created_at        timestamptz default now(),
  unique (assessment_id, checklist_item_id)
);

-- ── COMPETENCY SCORES (aggregated after all assessors) ──────
create table if not exists competency_scores (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references competency_cycles(id) on delete cascade,
  competency_id   uuid not null references framework_competencies(id),
  domain_id       uuid references framework_domains(id),
  framework_id    uuid references frameworks(id),
  assessor_count  int not null default 0,
  avg_score       numeric(4,2),
  final_score     int,
  level_label     text,
  is_passing      boolean not null default false,
  validated_by    uuid references profiles(id),
  validated_at    timestamptz,
  created_at      timestamptz default now(),
  unique (cycle_id, competency_id)
);

-- ── DOMAIN SCORES ───────────────────────────────────────────
create table if not exists domain_scores (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references competency_cycles(id) on delete cascade,
  domain_id       uuid not null references framework_domains(id),
  framework_id    uuid not null references frameworks(id),
  avg_score       numeric(4,2),
  competency_count int not null default 0,
  passing_count    int not null default 0,
  is_passing      boolean not null default false,
  created_at      timestamptz default now(),
  unique (cycle_id, domain_id)
);

-- ── FRAMEWORK SCORES ────────────────────────────────────────
create table if not exists framework_scores (
  id                       uuid primary key default gen_random_uuid(),
  cycle_id                 uuid not null references competency_cycles(id) on delete cascade,
  framework_id             uuid not null references frameworks(id),
  avg_score                numeric(4,2),
  domain_count             int not null default 0,
  passing_domain_count     int not null default 0,
  is_passing               boolean not null default false,
  clinical_readiness_score numeric(4,2),
  created_at               timestamptz default now(),
  unique (cycle_id, framework_id)
);

-- ── RLS ─────────────────────────────────────────────────────
alter table competency_cycles  enable row level security;
alter table cycle_frameworks   enable row level security;
alter table assessments        enable row level security;
alter table assessment_evidence enable row level security;
alter table checklist_responses enable row level security;
alter table competency_scores  enable row level security;
alter table domain_scores      enable row level security;
alter table framework_scores   enable row level security;

-- Nurses see their own cycles and scores
create policy "Nurse views own cycles"
  on competency_cycles for select
  using (nurse_id = auth.uid() or current_user_is_super_admin());

create policy "Nurse views own cycle frameworks"
  on cycle_frameworks for select
  using (
    exists (select 1 from competency_cycles c where c.id = cycle_id and c.nurse_id = auth.uid())
    or current_user_is_super_admin()
  );

create policy "Nurse views own competency scores"
  on competency_scores for select
  using (
    exists (select 1 from competency_cycles c where c.id = cycle_id and c.nurse_id = auth.uid())
    or current_user_is_super_admin()
  );

create policy "Nurse views own domain scores"
  on domain_scores for select
  using (
    exists (select 1 from competency_cycles c where c.id = cycle_id and c.nurse_id = auth.uid())
    or current_user_is_super_admin()
  );

create policy "Nurse views own framework scores"
  on framework_scores for select
  using (
    exists (select 1 from competency_cycles c where c.id = cycle_id and c.nurse_id = auth.uid())
    or current_user_is_super_admin()
  );

-- Assessors see assessments assigned to them + all in their hospital
create policy "Assessor views hospital assessments"
  on assessments for select
  using (
    assessor_id = auth.uid()
    or exists (
      select 1 from competency_cycles cy
      join profiles p on p.id = auth.uid()
      where cy.id = cycle_id and cy.hospital_id = p.hospital_id
        and p.role in ('assessor','educator','hospital_admin')
    )
    or current_user_is_super_admin()
  );

create policy "Assessor manages own assessments"
  on assessments for all
  using (
    assessor_id = auth.uid()
    or exists (
      select 1 from profiles p where p.id = auth.uid() and p.role in ('educator','hospital_admin','super_admin')
    )
  );

-- Evidence: assessor who owns the assessment can add
create policy "Assessor manages evidence"
  on assessment_evidence for all
  using (
    recorded_by = auth.uid()
    or exists (
      select 1 from assessments a join profiles p on p.id = auth.uid()
      where a.id = assessment_id and (a.assessor_id = auth.uid() or p.role in ('educator','hospital_admin','super_admin'))
    )
  );

create policy "View evidence on accessible assessments"
  on assessment_evidence for select
  using (
    exists (
      select 1 from assessments a
      join competency_cycles cy on cy.id = a.cycle_id
      join profiles p on p.id = auth.uid()
      where a.id = assessment_id
        and (cy.nurse_id = auth.uid() or a.assessor_id = auth.uid()
             or cy.hospital_id = p.hospital_id)
    )
  );

-- Checklist responses
create policy "Assessor manages checklist responses"
  on checklist_responses for all
  using (
    exists (
      select 1 from assessments a where a.id = assessment_id
        and (a.assessor_id = auth.uid()
             or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('educator','hospital_admin','super_admin')))
    )
  );

-- Hospital admin sees all cycles in their hospital
create policy "Hospital admin views all cycles"
  on competency_cycles for all
  using (current_user_is_hospital_admin_for(hospital_id) or current_user_is_super_admin());

create policy "Hospital admin manages cycle frameworks"
  on cycle_frameworks for all
  using (
    exists (select 1 from competency_cycles c where c.id = cycle_id and current_user_is_hospital_admin_for(c.hospital_id))
    or current_user_is_super_admin()
  );

-- Educator validates assessments
create policy "Educator validates assessments"
  on assessments for update
  using (
    exists (
      select 1 from profiles p
      join competency_cycles cy on cy.hospital_id = p.hospital_id
      where p.id = auth.uid() and p.role = 'educator' and cy.id = cycle_id
    )
  );

create policy "Educator views hospital scores"
  on competency_scores for all
  using (
    exists (
      select 1 from competency_cycles c join profiles p on p.hospital_id = c.hospital_id
      where c.id = cycle_id and p.id = auth.uid()
        and p.role in ('educator','hospital_admin','assessor')
    )
    or current_user_is_super_admin()
  );

create policy "Educator manages domain scores"
  on domain_scores for all
  using (
    exists (
      select 1 from competency_cycles c join profiles p on p.hospital_id = c.hospital_id
      where c.id = cycle_id and p.id = auth.uid()
    )
    or current_user_is_super_admin()
  );

create policy "Educator manages framework scores"
  on framework_scores for all
  using (
    exists (
      select 1 from competency_cycles c join profiles p on p.hospital_id = c.hospital_id
      where c.id = cycle_id and p.id = auth.uid()
    )
    or current_user_is_super_admin()
  );
