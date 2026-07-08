-- ============================================================
-- MIGRATION 019: ENTERPRISE QUALITY OPERATING SYSTEM (EQOS)
-- Implements EQOS Chapters 41-45:
--   Ch.41 Quality Objects (QO) + 12 canonical quality domains
--   Ch.42 Quality Standards Architecture — computable standards with
--         multi-framework mapping (JCI / SafeCare / MOH / internal)
--   Ch.43 Improvement Objects (IO) with recognized methodologies
--   Ch.44 Quality Indicators + measurements (intelligence substrate)
--   Ch.45 feeds the Accreditation readiness engine
-- Additive & idempotent.
-- ============================================================

-- ── QUALITY DOMAINS (Ch.41 universal taxonomy) ──────────────
create table if not exists quality_domains (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  purpose    text,
  sort_order int default 0
);

insert into quality_domains (code, name, purpose, sort_order) values
  ('QD-LG',  'Leadership & Governance',          'Strategic oversight and accountability', 1),
  ('QD-PS',  'Patient Safety',                   'Prevention of harm', 2),
  ('QD-CC',  'Clinical Care',                    'Reliability of care delivery', 3),
  ('QD-WC',  'Workforce Capability',             'Competency and staffing', 4),
  ('QD-PE',  'Patient Experience',               'Person-centered care', 5),
  ('QD-IPC', 'Infection Prevention & Control',   'Prevention of healthcare-associated infections', 6),
  ('QD-MS',  'Medication Safety',                'Safe medication management', 7),
  ('QD-SS',  'Surgical Safety',                  'Safe procedural care', 8),
  ('QD-DS',  'Diagnostic Services',              'Reliable laboratory and imaging services', 9),
  ('QD-FE',  'Facility & Environment',           'Safe physical environment', 10),
  ('QD-IM',  'Information Management',           'Reliable information and documentation', 11),
  ('QD-PI',  'Performance Improvement',          'Continuous quality improvement', 12)
on conflict (code) do nothing;

-- ── QUALITY FRAMEWORKS (Ch.42 framework adapters) ───────────
create table if not exists quality_frameworks (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  framework_type text not null default 'accreditation'
                   check (framework_type in ('accreditation','regulatory','professional','internal')),
  organization   text,
  is_active      boolean default true
);

insert into quality_frameworks (code, name, framework_type, organization) values
  ('JCI',      'Joint Commission International',       'accreditation', 'JCI'),
  ('SAFECARE', 'SafeCare',                              'accreditation', 'PharmAccess Foundation'),
  ('MOH',      'Ministry of Health Standards',          'regulatory',    'National Ministry of Health'),
  ('INTERNAL', 'Internal Hospital Standards',           'internal',      null)
on conflict (code) do nothing;

-- ── QUALITY OBJECTS (Ch.41 — the canonical unit of quality) ─
create table if not exists quality_objects (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  title       text not null,
  description text,
  purpose     text,
  domain_id   uuid references quality_domains(id),
  hospital_id uuid references hospitals(id) on delete cascade,  -- null = enterprise-wide
  owner_id    uuid references profiles(id),
  status      text not null default 'draft'
                check (status in ('draft','active','under_review','retired')),
  review_date date,
  created_by  uuid references profiles(id),
  created_at  timestamptz default now()
);
create index if not exists idx_qo_domain on quality_objects(domain_id);

-- ── QUALITY STANDARDS (Ch.42 — one QO satisfies many frameworks) ──
create table if not exists quality_standards (
  id                uuid primary key default gen_random_uuid(),
  quality_object_id uuid not null references quality_objects(id) on delete cascade,
  framework_id      uuid not null references quality_frameworks(id) on delete cascade,
  reference_code    text not null,          -- e.g. IPSG.1, MMU.4, IPC-01
  title             text,
  description       text,
  unique (quality_object_id, framework_id, reference_code)
);
create index if not exists idx_qs_qo on quality_standards(quality_object_id);

-- ── MEASURABLE CRITERIA (Ch.42) ─────────────────────────────
create table if not exists quality_criteria (
  id                    uuid primary key default gen_random_uuid(),
  quality_object_id     uuid not null references quality_objects(id) on delete cascade,
  description           text not null,
  evidence_required     text,
  measurement_frequency text default 'monthly'
                          check (measurement_frequency in ('continuous','daily','weekly','monthly','quarterly','annual')),
  responsible_role      text,
  sort_order            int default 0
);
create index if not exists idx_qc_qo on quality_criteria(quality_object_id);

-- ── QUALITY INDICATORS + MEASUREMENTS (Ch.44) ───────────────
create table if not exists quality_indicators (
  id                uuid primary key default gen_random_uuid(),
  quality_object_id uuid references quality_objects(id) on delete cascade,
  code              text unique,
  name              text not null,
  unit              text not null default 'percent'
                      check (unit in ('percent','count','rate_per_1000','days','minutes','score')),
  direction         text not null default 'higher_is_better'
                      check (direction in ('higher_is_better','lower_is_better')),
  target_value      numeric,
  escalation_value  numeric,
  frequency         text default 'monthly'
                      check (frequency in ('daily','weekly','monthly','quarterly','annual')),
  is_active         boolean default true,
  created_at        timestamptz default now()
);
create index if not exists idx_qi_qo on quality_indicators(quality_object_id);

create table if not exists indicator_measurements (
  id           uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references quality_indicators(id) on delete cascade,
  hospital_id  uuid references hospitals(id) on delete cascade,
  period       date not null default current_date,   -- period the value covers
  value        numeric not null,
  numerator    numeric,
  denominator  numeric,
  notes        text,
  recorded_by  uuid references profiles(id),
  created_at   timestamptz default now()
);
create index if not exists idx_im_indicator on indicator_measurements(indicator_id, period desc);

-- ── IMPROVEMENT OBJECTS (Ch.43) ─────────────────────────────
create table if not exists improvement_objects (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,
  title               text not null,
  quality_object_id   uuid references quality_objects(id) on delete set null,
  hospital_id         uuid references hospitals(id) on delete cascade,
  problem_statement   text,
  aim_statement       text,
  baseline_summary    text,
  methodology         text not null default 'pdsa'
                        check (methodology in ('pdsa','clinical_audit','rca','fmea','lean',
                                               'six_sigma','kaizen','human_factors','implementation_science')),
  status              text not null default 'proposed'
                        check (status in ('proposed','planning','active','measuring','sustained','closed','abandoned')),
  owner_id            uuid references profiles(id),
  start_date          date,
  target_date         date,
  completed_date      date,
  outcome_summary     text,
  lessons_learned     text,
  sustainability_plan text,
  created_by          uuid references profiles(id),
  created_at          timestamptz default now()
);
create index if not exists idx_io_qo on improvement_objects(quality_object_id);

create table if not exists improvement_actions (
  id             uuid primary key default gen_random_uuid(),
  improvement_id uuid not null references improvement_objects(id) on delete cascade,
  description    text not null,
  owner_name     text,
  due_date       date,
  status         text not null default 'open' check (status in ('open','in_progress','done','blocked')),
  created_at     timestamptz default now()
);
create index if not exists idx_ia_io on improvement_actions(improvement_id);

-- ── QO ↔ CKCM LINKS (Ch.42 relationship to competency) ──────
create table if not exists quality_object_links (
  id                uuid primary key default gen_random_uuid(),
  quality_object_id uuid not null references quality_objects(id) on delete cascade,
  target_type       text not null check (target_type in ('cpu','competency','policy','learning_resource')),
  target_id         uuid not null,
  link_type         text not null default 'supports'
                      check (link_type in ('requires','supports','measures')),
  unique (quality_object_id, target_type, target_id, link_type)
);

-- ── RLS ─────────────────────────────────────────────────────
alter table quality_domains        enable row level security;
alter table quality_frameworks     enable row level security;
alter table quality_objects        enable row level security;
alter table quality_standards      enable row level security;
alter table quality_criteria       enable row level security;
alter table quality_indicators     enable row level security;
alter table indicator_measurements enable row level security;
alter table improvement_objects    enable row level security;
alter table improvement_actions    enable row level security;
alter table quality_object_links   enable row level security;

do $$ declare t text; begin
  foreach t in array array['quality_domains','quality_frameworks','quality_objects','quality_standards',
                           'quality_criteria','quality_indicators','indicator_measurements',
                           'improvement_objects','improvement_actions','quality_object_links'] loop
    begin
      execute format('create policy "Authenticated read" on %I for select using (auth.uid() is not null)', t);
    exception when duplicate_object then null; end;
    begin
      execute format('create policy "Admins write" on %I for all using (exists (
        select 1 from profiles p where p.id = auth.uid()
        and p.role in (''super_admin'',''hospital_admin'')))', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ── FTS: add quality objects to search_ckcm (AI grounding) ──
create or replace function search_ckcm(q text, max_results int default 20)
returns table(object_type text, object_id uuid, title text, snippet text, rank real)
language sql stable
as $$
with tsq as (select websearch_to_tsquery('english', q) as query),
hits as (
  select 'framework'::text as object_type, f.id as object_id, f.name as title,
         coalesce(f.description, '') as snippet,
         ts_rank(to_tsvector('english', f.name || ' ' || coalesce(f.description, '')), tsq.query) as rank
  from frameworks f, tsq
  where f.is_active
    and to_tsvector('english', f.name || ' ' || coalesce(f.description, '')) @@ tsq.query

  union all
  select 'cpu', u.id, u.name, coalesce(u.description, ''),
         ts_rank(to_tsvector('english', u.name || ' ' || coalesce(u.description, '')), tsq.query)
  from clinical_practice_units u, tsq
  where to_tsvector('english', u.name || ' ' || coalesce(u.description, '')) @@ tsq.query

  union all
  select 'competency', c.id, c.name, coalesce(c.description, ''),
         ts_rank(to_tsvector('english', c.name || ' ' || coalesce(c.description, '')), tsq.query)
  from framework_competencies c, tsq
  where to_tsvector('english', c.name || ' ' || coalesce(c.description, '')) @@ tsq.query

  union all
  select 'skill', s.id, s.name, '',
         ts_rank(to_tsvector('english', s.name), tsq.query)
  from competency_skills s, tsq
  where to_tsvector('english', s.name) @@ tsq.query

  union all
  select 'resource', r.id, r.title, coalesce(r.description, ''),
         ts_rank(to_tsvector('english', r.title || ' ' || coalesce(r.description, '')), tsq.query)
  from learning_resources r, tsq
  where r.is_active
    and to_tsvector('english', r.title || ' ' || coalesce(r.description, '')) @@ tsq.query

  union all
  select 'policy', p.id, p.title, left(coalesce(p.content, ''), 300),
         ts_rank(to_tsvector('english', p.title || ' ' || coalesce(p.content, '')), tsq.query)
  from policies p, tsq
  where to_tsvector('english', p.title || ' ' || coalesce(p.content, '')) @@ tsq.query

  union all
  select 'quality_object', qo.id, qo.title,
         coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, ''),
         ts_rank(to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')), tsq.query)
  from quality_objects qo, tsq
  where qo.status <> 'retired'
    and to_tsvector('english', qo.title || ' ' || coalesce(qo.description, '') || ' ' || coalesce(qo.purpose, '')) @@ tsq.query
)
select * from hits order by rank desc limit max_results
$$;

grant execute on function search_ckcm(text, int) to authenticated;

notify pgrst, 'reload schema';
