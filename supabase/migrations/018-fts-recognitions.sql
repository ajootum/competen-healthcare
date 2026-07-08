-- ============================================================
-- MIGRATION 018: FULL-TEXT SEARCH + PROFESSIONAL RECOGNITION
-- 1) search_ckcm() — Postgres FTS over all governed content
--    (Book IV retrieval upgrade for the AI agents; no embeddings key needed)
-- 2) professional_recognitions — Book II Ch.26 (Professional Recognition Object)
-- Additive & idempotent.
-- ============================================================

-- ── CKCM FULL-TEXT SEARCH ───────────────────────────────────
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
)
select * from hits order by rank desc limit max_results
$$;

grant execute on function search_ckcm(text, int) to authenticated;

-- ── PROFESSIONAL RECOGNITION (Book II Ch.26) ────────────────
create table if not exists professional_recognitions (
  id               uuid primary key default gen_random_uuid(),
  nurse_id         uuid not null references profiles(id) on delete cascade,
  hospital_id      uuid references hospitals(id) on delete cascade,
  recognition_type text not null default 'excellence_award'
                     check (recognition_type in (
                       'excellence_award','preceptor','mentor','employee_of_month',
                       'innovation','patient_safety_champion','long_service','custom')),
  title            text not null,
  description      text,
  awarded_by       uuid references profiles(id),
  awarded_by_name  text,
  awarded_at       date default current_date,
  created_at       timestamptz default now()
);
create index if not exists idx_recognitions_nurse on professional_recognitions(nurse_id);

alter table professional_recognitions enable row level security;
do $$ begin
  create policy "Nurse reads own recognitions" on professional_recognitions for select using (nurse_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Staff read recognitions" on professional_recognitions for select
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('super_admin','hospital_admin','educator','assessor')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Admins write recognitions" on professional_recognitions for all
    using (exists (select 1 from profiles p where p.id = auth.uid()
      and p.role in ('super_admin','hospital_admin','educator')));
exception when duplicate_object then null; end $$;
