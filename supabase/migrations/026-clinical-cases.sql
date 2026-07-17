-- ============================================================
-- MIGRATION 026: CLINICAL CASE STUDIES
-- The last content gap from the authored CPU documents: worked
-- clinical scenarios (scenario → findings → questions → discussion
-- → learning points) used for case-based learning and simulation.
-- Additive & idempotent.
-- ============================================================

create table if not exists clinical_cases (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,
  title           text not null,
  cpu_id          uuid references clinical_practice_units(id) on delete set null,
  scenario        text,                    -- the presenting situation
  findings        text,                    -- assessment findings
  questions       text[] default '{}',     -- learner questions
  discussion      text,                    -- worked reasoning / answers
  learning_points text[] default '{}',
  difficulty      text not null default 'intermediate'
                    check (difficulty in ('foundation','intermediate','advanced')),
  status          text not null default 'draft' check (status in ('draft','active','retired')),
  source_ref      text,                    -- e.g. "CPU-DIS-010 §10.25"
  created_by      uuid references profiles(id),
  created_at      timestamptz default now()
);
create index if not exists idx_cases_cpu on clinical_cases(cpu_id);
create index if not exists idx_cases_status on clinical_cases(status);

alter table clinical_cases enable row level security;
do $$ begin
  create policy "Authenticated read" on clinical_cases for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Authors write" on clinical_cases for all using (exists (
    select 1 from profiles p where p.id = auth.uid()
    and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;

-- ── FTS: cases become searchable and AI-citable ──
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

  union all
  select 'knowledge', k.id, k.title,
         left(coalesce(k.summary, k.content, ''), 300),
         ts_rank(to_tsvector('english', k.title || ' ' || coalesce(k.summary, '') || ' ' || coalesce(k.content, '')), tsq.query)
  from knowledge_objects k, tsq
  where k.status <> 'retired'
    and to_tsvector('english', k.title || ' ' || coalesce(k.summary, '') || ' ' || coalesce(k.content, '')) @@ tsq.query

  union all
  select 'case', cc.id, cc.title,
         left(coalesce(cc.scenario, ''), 300),
         ts_rank(to_tsvector('english', cc.title || ' ' || coalesce(cc.scenario, '') || ' ' || coalesce(cc.discussion, '')), tsq.query)
  from clinical_cases cc, tsq
  where cc.status <> 'retired'
    and to_tsvector('english', cc.title || ' ' || coalesce(cc.scenario, '') || ' ' || coalesce(cc.discussion, '')) @@ tsq.query
)
select * from hits order by rank desc limit max_results
$$;

grant execute on function search_ckcm(text, int) to authenticated;

notify pgrst, 'reload schema';
