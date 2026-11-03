-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql and SQL function bodies between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 930: ASSESSMENT AND CHECKLIST CATALOGUE, FLEXIBLE REGISTRATION, INSTRUMENT IMPORT AND
-- DOMAIN CLASSIFICATION (ASMT-CATALOGUE-IMPORT-01)
--
-- Owner specification of 3 Nov 2026 (Competen Holdings, Assessment and Checklist Catalogue: flexible
-- registration, instrument import and domain classification), sections 1 to 14. Staging first. Production
-- needs its own owner GO and is applied by the owner by hand.
--
-- PRINCIPLE. Nothing here is a second instrument model or a second editor. An imported instrument is an
-- ordinary asmt_instrument (890) with an ordinary draft asmt_instrument_version, edited in Checklist Studio
-- and governed by the 890 lifecycle guard like any other. What this file adds is the RECORD of an import
-- (the original workbook kept as the source record, with its digest and what was extracted from it), the
-- provenance link from an instrument to that record, and the classification axes the catalogue needed to
-- file an instrument hierarchically. Every axis and term is data, never a code constant: another profession
-- builds its own taxonomy through the terms screen without a deployment.
--
-- DEPENDS ON 894 (asmt_catalogue_dimension, asmt_catalogue_term, asmt_catalogue_register,
-- asmt_catalogue_search, asmt_catalogue_event, asmt_catalogue_actor_check, asmt_assign_catalogue_code),
-- 890 (asmt_instrument, asmt_purpose), 336 (the storage.buckets convention) and profiles. Additive. Re-running
-- it is a no-op. It appoints NOBODY and grants no capability: the two 894 catalogue capabilities govern the
-- import screens, and the Studio author capability (890) governs the content an import writes, because the
-- version it creates is a Studio draft.
--
-- WHAT IT ADDS.
--   1. asmt_import: one row per uploaded workbook (file name, sha256, size, storage object, status, the
--      extracted draft as reviewed by the person, who and when). Status extracted, registered or discarded.
--   2. asmt_instrument.import_id and import_sheet: the provenance of an imported instrument. Permanent once
--      set (the 894 definition guard already freezes every column it does not list as free).
--   3. The private storage bucket asmt-imports for the original workbook.
--   4. asmt_catalogue_register gains p_import and p_sheet (both optional) so registration and provenance are
--      one transaction. The old six-argument signature is dropped so the call stays unambiguous.
--   5. Two more classification dimensions, profession and purpose, as rows. The setting dimension is relabelled
--      Clinical context / setting only where it still carries the 894 label. Purpose terms are seeded from the
--      890 purpose registry so the catalogue names the same words the Studio does.
--   6. The Clinical Nursing Skills domain with example subdomains, seeded as ordinary configurable terms
--      (hierarchy through parent_id), and nothing in application code names them.
--   7. asmt_catalogue_search accepts profession, specialty and purpose filters, and the domain filter matches
--      a term, its parent or its grandparent, so a search on a domain finds instruments filed under a subdomain.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique index.
-- notify pgrst last. RLS on every table, no policy here (service role only).
--
-- ROLLBACK (staging): RELEASE-2026-10-25/PENDING-41/ROLLBACK-930.sql
-- ====================================================================================================


-- ---- 1. the import record -----------------------------------------------------------------------------------

create table if not exists asmt_import (
  id              uuid primary key default gen_random_uuid(),
  file_name       text not null,
  file_sha256     text not null,
  byte_size       int not null,
  storage_bucket  text not null default 'asmt-imports',
  storage_path    text not null,
  status          text not null default 'extracted',
  draft           jsonb not null default '{}'::jsonb,
  extracted_at    timestamptz not null default now(),
  registered_at   timestamptz,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  constraint asmt_import_file_name_check check (btrim(file_name) <> ''),
  constraint asmt_import_sha_check check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint asmt_import_size_check check (byte_size > 0),
  constraint asmt_import_path_check check (btrim(storage_path) <> ''),
  constraint asmt_import_status_check check (status in ('extracted', 'registered', 'discarded')),
  constraint asmt_import_draft_check check (jsonb_typeof(draft) = 'object'),
  constraint asmt_import_registered_check check ((status = 'registered') = (registered_at is not null))
);
create index if not exists idx_asmt_import_created on asmt_import (created_at desc);
create index if not exists idx_asmt_import_creator on asmt_import (created_by);
alter table asmt_import enable row level security;


-- ---- 2. provenance on the master record ----------------------------------------------------------------------

alter table asmt_instrument add column if not exists import_id uuid references asmt_import(id);
alter table asmt_instrument add column if not exists import_sheet text;
alter table asmt_instrument drop constraint if exists asmt_instrument_import_sheet_check;
alter table asmt_instrument add constraint asmt_instrument_import_sheet_check check (import_sheet is null or import_id is not null);
create index if not exists idx_asmt_instrument_import on asmt_instrument (import_id);


-- ---- 3. the storage bucket for the original workbook ----------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('asmt-imports', 'asmt-imports', false, 26214400,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/octet-stream'])
on conflict (id) do nothing;


-- ---- 4. registration with provenance ---------------------------------------------------------------------------

drop function if exists public.asmt_catalogue_register(text, text, text, text, uuid, jsonb);

create or replace function public.asmt_catalogue_register(
  p_family text, p_name text, p_description text, p_kind text, p_actor uuid, p_terms jsonb default '[]'::jsonb,
  p_import uuid default null, p_sheet text default null)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_code text;
begin
  perform public.asmt_catalogue_actor_check(p_actor);
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'asmt_catalogue_register: a title is required';
  end if;
  if p_import is not null and not exists (select 1 from asmt_import where id = p_import) then
    raise exception 'asmt_catalogue_register: the import record does not exist';
  end if;
  v_code := public.asmt_assign_catalogue_code(p_family);
  insert into asmt_instrument (code, name, kind, family_code, description, created_by, import_id, import_sheet)
  values (v_code, btrim(p_name), coalesce(nullif(btrim(coalesce(p_kind, '')), ''), 'assessment'), p_family,
          nullif(btrim(coalesce(p_description, '')), ''), p_actor, p_import,
          case when p_import is null then null else nullif(btrim(coalesce(p_sheet, '')), '') end)
  returning id into v_id;
  perform public.asmt_catalogue_event(v_id, 'catalogue_registered', p_actor,
    jsonb_build_object('code', v_code, 'family', p_family, 'import_id', p_import, 'import_sheet', p_sheet));
  if p_terms is not null and jsonb_typeof(p_terms) = 'array' and jsonb_array_length(p_terms) > 0 then
    perform public.asmt_catalogue_classify(v_id, p_terms, p_actor);
  end if;
  return v_id;
end;
$$;


-- ---- 5. classification dimensions as rows ------------------------------------------------------------------------

insert into asmt_catalogue_dimension (code, label, allows_hierarchy, position) values
  ('profession', 'Profession', false, 25),
  ('purpose',    'Purpose', false, 65)
on conflict (code) do nothing;

update asmt_catalogue_dimension set label = 'Clinical context / setting' where code = 'setting' and label = 'Context / setting';

insert into asmt_catalogue_term (dimension_code, code, label, position)
select v.dimension_code, v.code, v.label, v.position
from (values
  ('profession', 'nursing', 'Nursing', 10),
  ('profession', 'midwifery', 'Midwifery', 20),
  ('profession', 'medicine', 'Medicine', 30),
  ('profession', 'emergency_medical_services', 'Emergency medical services', 40),
  ('profession', 'pharmacy', 'Pharmacy', 50),
  ('profession', 'allied_health', 'Allied health', 60)
) as v(dimension_code, code, label, position)
on conflict (dimension_code, code) do nothing;

insert into asmt_catalogue_term (dimension_code, code, label, position)
select 'purpose', p.code, p.label, (row_number() over (order by p.code)) * 10
from asmt_purpose p
on conflict (dimension_code, code) do nothing;


-- ---- 6. the Clinical Nursing Skills domain and its example subdomains (data, not constants) -------------------------

insert into asmt_catalogue_term (dimension_code, code, label, position) values
  ('domain', 'clinical_nursing_skills', 'Clinical Nursing Skills', 5)
on conflict (dimension_code, code) do nothing;

insert into asmt_catalogue_term (dimension_code, code, label, parent_id, position)
select 'domain', v.code, v.label, (select id from asmt_catalogue_term where dimension_code = 'domain' and code = 'clinical_nursing_skills'), v.position
from (values
  ('patient_assessment', 'Patient assessment', 10),
  ('vital_signs_monitoring', 'Vital signs monitoring', 20),
  ('medication_administration', 'Medication administration', 30),
  ('wound_care', 'Wound care', 40),
  ('infection_prevention_control', 'Infection prevention and control', 50),
  ('documentation_handover', 'Documentation and handover', 60),
  ('emergency_response', 'Emergency response', 70)
) as v(code, label, position)
on conflict (dimension_code, code) do nothing;


-- ---- 7. search with the new axes and a deeper domain match ------------------------------------------------------------

create or replace function public.asmt_catalogue_search(
  p_q text default null,
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'updated_desc',
  p_limit int default 50,
  p_offset int default 0)
returns table (
  id uuid, code text, name text, description text, family_code text, family_label text,
  primary_domain_label text, method_labels text[], population_labels text[], setting_labels text[],
  latest_version_no int, latest_state text, published_version_no int,
  owner text, updated_at timestamptz, published_at timestamptz, total bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  with f as (
    select nullif(btrim(p_filters ->> 'family'), '') as family,
           nullif(btrim(p_filters ->> 'method'), '') as method,
           nullif(btrim(p_filters ->> 'domain'), '') as domain,
           nullif(btrim(p_filters ->> 'population'), '') as population,
           nullif(btrim(p_filters ->> 'setting'), '') as setting,
           nullif(btrim(p_filters ->> 'level'), '') as level,
           nullif(btrim(p_filters ->> 'profession'), '') as profession,
           nullif(btrim(p_filters ->> 'specialty'), '') as specialty,
           nullif(btrim(p_filters ->> 'purpose'), '') as purpose,
           nullif(btrim(p_filters ->> 'product'), '') as product,
           nullif(btrim(p_filters ->> 'status'), '') as status,
           nullif(btrim(p_filters ->> 'owner'), '') as owner,
           nullif(btrim(p_filters ->> 'collection'), '') as collection
  ),
  tk as (
    select array(
      select w from regexp_split_to_table(lower(btrim(coalesce(p_q, ''))), '\s+') w where w <> '' limit 8
    ) as toks
  ),
  base as (
    select i.id, i.code, i.name, i.description, i.family_code, fam.label as family_label, i.owning_entity as owner,
           lv.version_no as latest_version_no, lv.state as latest_state,
           pv.version_no as published_version_no, pv.published_at,
           tm.primary_domain_label, tm.method_labels, tm.population_labels, tm.setting_labels, tm.term_doc,
           rf.ref_doc,
           greatest(i.created_at, coalesce(ev.last_at, i.created_at), coalesce(vv.last_at, i.created_at)) as updated_at
    from asmt_instrument i
    left join asmt_instrument_family fam on fam.code = i.family_code
    left join lateral (
      select v.version_no, v.state from asmt_instrument_version v
      where v.instrument_id = i.id order by v.version_no desc limit 1) lv on true
    left join lateral (
      select v.version_no, v.published_at from asmt_instrument_version v
      where v.instrument_id = i.id and v.state = 'published' order by v.version_no desc limit 1) pv on true
    left join lateral (
      select max(greatest(v.created_at, coalesce(v.submitted_at, v.created_at), coalesce(v.published_at, v.created_at), coalesce(v.retired_at, v.created_at))) as last_at
      from asmt_instrument_version v where v.instrument_id = i.id) vv on true
    left join lateral (
      select max(e.created_at) as last_at from asmt_definition_event e
      where e.subject_table = 'asmt_instrument' and e.subject_id = i.id) ev on true
    left join lateral (
      select
        coalesce((array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'domain' and it.is_primary))[1],
                 (array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'domain'))[1]) as primary_domain_label,
        coalesce(array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'method'), '{}') as method_labels,
        coalesce(array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'population'), '{}') as population_labels,
        coalesce(array_agg(t.label order by t.position, t.label) filter (where t.dimension_code = 'setting'), '{}') as setting_labels,
        coalesce(string_agg(lower(t.label || ' ' || t.code), ' '), '') as term_doc
      from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
      where it.instrument_id = i.id) tm on true
    left join lateral (
      select coalesce(string_agg(lower(r.ref_label || ' ' || coalesce(r.ref_code, '')), ' '), '') as ref_doc
      from asmt_instrument_reference r where r.instrument_id = i.id) rf on true
  ),
  hit as (
    select b.*
    from base b cross join f cross join tk
    where (f.family is null or b.family_code = f.family)
      and (f.owner is null or b.owner ilike '%' || f.owner || '%')
      and (f.status is null or coalesce(b.latest_state, 'none') = f.status)
      and (f.method is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'method' and t.code = f.method))
      and (f.population is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'population' and t.code = f.population))
      and (f.setting is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'setting' and t.code = f.setting))
      and (f.level is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'level' and t.code = f.level))
      and (f.profession is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'profession' and t.code = f.profession))
      and (f.purpose is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            where it.instrument_id = b.id and t.dimension_code = 'purpose' and t.code = f.purpose))
      and (f.specialty is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            left join asmt_catalogue_term pt on pt.id = t.parent_id
            left join asmt_catalogue_term gt on gt.id = pt.parent_id
            where it.instrument_id = b.id and t.dimension_code = 'specialty' and (t.code = f.specialty or pt.code = f.specialty or gt.code = f.specialty)))
      and (f.domain is null or exists (
            select 1 from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
            left join asmt_catalogue_term pt on pt.id = t.parent_id
            left join asmt_catalogue_term gt on gt.id = pt.parent_id
            where it.instrument_id = b.id and t.dimension_code = 'domain' and (t.code = f.domain or pt.code = f.domain or gt.code = f.domain)))
      and (f.product is null or exists (
            select 1 from asmt_instrument_availability a
            where a.instrument_id = b.id and a.product_line = f.product and a.mode in ('available', 'optional')))
      and (f.collection is null or exists (
            select 1 from asmt_collection_member m join asmt_collection c on c.id = m.collection_id
            where m.instrument_id = b.id and c.code = f.collection))
      and not exists (
            select 1 from unnest(tk.toks) w
            where regexp_replace(w, '[^a-z0-9]+', '', 'g') <> ''
              and not (
                public.asmt_catalogue_tsv(b.name, b.description, b.code) @@ to_tsquery('simple'::regconfig, regexp_replace(w, '[^a-z0-9]+', '', 'g') || ':*')
                or lower(b.code) like '%' || w || '%'
                or b.term_doc like '%' || w || '%'
                or b.ref_doc like '%' || w || '%'))
  )
  select h.id, h.code, h.name, h.description, h.family_code, h.family_label,
         h.primary_domain_label, h.method_labels, h.population_labels, h.setting_labels,
         h.latest_version_no, h.latest_state, h.published_version_no,
         h.owner, h.updated_at, h.published_at,
         count(*) over () as total
  from hit h
  order by
    case when p_sort = 'name_asc' then lower(h.name) end asc,
    case when p_sort = 'name_desc' then lower(h.name) end desc,
    case when p_sort = 'updated_asc' then h.updated_at end asc,
    case when p_sort = 'published_asc' then h.published_at end asc nulls last,
    case when p_sort = 'published_desc' then h.published_at end desc nulls last,
    case when p_sort = 'code_asc' then h.code end asc,
    case when p_sort is null or p_sort not in ('name_asc', 'name_desc', 'updated_asc', 'published_asc', 'published_desc', 'code_asc') then h.updated_at end desc,
    h.code asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;


-- ---- 8. privileges --------------------------------------------------------------------------------------------------------

revoke all on function public.asmt_catalogue_register(text, text, text, text, uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.asmt_catalogue_search(text, jsonb, text, int, int) from public, anon, authenticated;
grant execute on function public.asmt_catalogue_register(text, text, text, text, uuid, jsonb, uuid, text) to service_role;
grant execute on function public.asmt_catalogue_search(text, jsonb, text, int, int) to service_role;


-- Verification: the import table, the provenance columns, the bucket, the dimensions and the seeded terms.
select count(*) as import_table from information_schema.tables where table_name = 'asmt_import';
select count(*) as provenance_columns from information_schema.columns where table_name = 'asmt_instrument' and column_name in ('import_id', 'import_sheet');
select count(*) as import_bucket from storage.buckets where id = 'asmt-imports';
select count(*) as register_overloads from pg_proc where proname = 'asmt_catalogue_register';
select code, label, allows_hierarchy from asmt_catalogue_dimension order by position;
select dimension_code, count(*) as terms, count(parent_id) as child_terms from asmt_catalogue_term group by dimension_code order by dimension_code;

notify pgrst, 'reload schema';
