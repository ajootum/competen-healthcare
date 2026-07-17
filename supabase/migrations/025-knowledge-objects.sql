-- ============================================================
-- MIGRATION 025: CLINICAL KNOWLEDGE OBJECTS (CKO)
-- The Canonical Object Model's first-class knowledge object — the
-- home for the anatomy / physiology / classification content authored
-- in CPU documents, which until now had nowhere to land.
--
--  1) knowledge_objects  — governed, versionable prose knowledge
--  2) knowledge_links    — reuse one CKO across many CPUs/competencies
--  3) knowledge_requirements — the "Knowledge Outcomes" statements
--  4) search_ckcm() extended so the AI assistant can cite knowledge
-- Additive & idempotent.
-- ============================================================

create table if not exists knowledge_objects (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  title          text not null,
  summary        text,
  content        text,                       -- the authored prose
  knowledge_type text not null default 'other'
                   check (knowledge_type in ('anatomy','physiology','pathophysiology','pharmacology',
                                             'classification','assessment_tool','clinical_reasoning',
                                             'procedure','evidence','other')),
  cpu_id         uuid references clinical_practice_units(id) on delete set null,
  source_ref     text,                       -- e.g. "CPU-DIS-010 §10.4"
  evidence_level text,
  status         text not null default 'draft' check (status in ('draft','active','retired')),
  review_date    date,
  created_by     uuid references profiles(id),
  created_at     timestamptz default now()
);
create index if not exists idx_ko_cpu on knowledge_objects(cpu_id);
create index if not exists idx_ko_type on knowledge_objects(knowledge_type);

-- Reuse: one knowledge object may support many competencies, skills or CPUs
create table if not exists knowledge_links (
  id                  uuid primary key default gen_random_uuid(),
  knowledge_object_id uuid not null references knowledge_objects(id) on delete cascade,
  target_type         text not null check (target_type in ('cpu','competency','skill','quality_object')),
  target_id           uuid not null,
  created_at          timestamptz default now(),
  unique (knowledge_object_id, target_type, target_id)
);
create index if not exists idx_klink_target on knowledge_links(target_type, target_id);

-- "Knowledge Outcomes" statements ("Explain the neuroanatomy of normal gait")
create table if not exists knowledge_requirements (
  id            uuid primary key default gen_random_uuid(),
  cpu_id        uuid references clinical_practice_units(id) on delete cascade,
  competency_id uuid references framework_competencies(id) on delete cascade,
  statement     text not null,
  sort_order    int default 0,
  created_at    timestamptz default now()
);
create index if not exists idx_kreq_cpu on knowledge_requirements(cpu_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table knowledge_objects      enable row level security;
alter table knowledge_links        enable row level security;
alter table knowledge_requirements enable row level security;

do $$ declare t text; begin
  foreach t in array array['knowledge_objects','knowledge_links','knowledge_requirements'] loop
    begin
      execute format('create policy "Authenticated read" on %I for select using (auth.uid() is not null)', t);
    exception when duplicate_object then null; end;
    begin
      execute format('create policy "Admins write" on %I for all using (exists (
        select 1 from profiles p where p.id = auth.uid()
        and p.role in (''super_admin'',''hospital_admin'',''educator'')))', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- ── FTS: knowledge objects become citable by the AI assistant ──
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
)
select * from hits order by rank desc limit max_results
$$;

grant execute on function search_ckcm(text, int) to authenticated;

notify pgrst, 'reload schema';
