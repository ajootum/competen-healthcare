-- ====================================================================================================
-- ASMT CATALOGUE ACCEPTANCE (migration 894). STAGING ONLY. Run by scripts/assessment-core-harness.ts acceptance.
-- ====================================================================================================
-- One transaction that registers the three owner example instruments through the same write functions the HQ
-- API uses, classifies them as the owner described, references the nursing framework and its respiratory
-- competency by id, sets their product availability, searches, and ALWAYS ENDS BY RAISING its RESULT line, so
-- staging keeps no demo row. Every check prints one NOTICE line.
--
-- Expect: RESULT ASMT CATALOGUE ACCEPTANCE pass=<n> fail=0 failed:
create temp table proof (id text, ok boolean, detail text) on commit drop;

create function pg_temp.rec(p_id text, p_ok boolean, p_detail text default null) returns void
language plpgsql as $$
begin
  insert into pg_temp.proof values (p_id, coalesce(p_ok, false), p_detail);
  raise notice 'ACCEPT % % %', case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_id, p_detail;
end $$;

create function pg_temp.term(p_dim text, p_code text) returns uuid
language sql as $$ select id from asmt_catalogue_term where dimension_code = p_dim and code = p_code $$;

create function pg_temp.t(p_dim text, p_code text, p_primary boolean) returns jsonb
language sql as $$ select jsonb_build_object('term_id', pg_temp.term(p_dim, p_code), 'is_primary', p_primary) $$;

do $$
declare
  pass int; fail int; failed text;
  actor uuid;
  ca uuid; cpa uuid; da uuid;
  fw uuid; comp uuid;
  n int; m int;
  ids uuid[];
  r record;
  codes text;
begin
  -- @@PLANT@@
  select id into actor from profiles order by id limit 1;
  select count(*) into n from asmt_instrument;

  -- 1. register the three instruments, classified
  ca := public.asmt_catalogue_register('CA', 'Nursing Competency Assessment',
        'Direct observation of the nursing assessment of a patient, scored against the competency framework', 'assessment', actor,
        jsonb_build_array(pg_temp.t('method', 'direct_observation', true), pg_temp.t('domain', 'respiratory', true), pg_temp.t('domain', 'nursing_documentation', false),
                          pg_temp.t('population', 'nursing', true), pg_temp.t('setting', 'diploma', true), pg_temp.t('setting', 'bachelors', false)));
  cpa := public.asmt_catalogue_register('CPA', 'Concurrent Nursing Assessment Audit',
        'An independent observer and the nurse assess the same patient and the two records are compared', 'assessment', actor,
        jsonb_build_array(pg_temp.t('method', 'concurrent_comparison', true), pg_temp.t('method', 'direct_observation', false), pg_temp.t('domain', 'respiratory', true),
                          pg_temp.t('domain', 'nursing_documentation', false), pg_temp.t('population', 'nursing', true), pg_temp.t('setting', 'critical_care', true)));
  da := public.asmt_catalogue_register('DA', 'Retrospective Nursing Chart Audit',
        'Chart review of the completeness of nursing assessment documentation after discharge', 'assessment', actor,
        jsonb_build_array(pg_temp.t('method', 'chart_review', true), pg_temp.t('domain', 'nursing_documentation', true), pg_temp.t('domain', 'respiratory', false),
                          pg_temp.t('population', 'nursing', true), pg_temp.t('setting', 'hospital_wide', true)));
  ids := array[ca, cpa, da];
  select string_agg(code, ', ' order by code) into codes from asmt_instrument where id = any (ids);
  perform pg_temp.rec('1', (select count(distinct family_code) from asmt_instrument where id = any (ids)) = 3
    and (select count(*) from asmt_instrument_version where instrument_id = any (ids)) = 0, 'three identities in three families, no version: ' || codes);

  -- 2. same domain, different family and method
  select count(*) into m from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
   where it.instrument_id = any (ids) and t.dimension_code = 'domain' and t.code = 'respiratory';
  perform pg_temp.rec('2a', m = 3, 'all three carry the respiratory domain: ' || m);
  select count(*) into m from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
   where it.instrument_id = any (ids) and t.dimension_code = 'domain' and t.code = 'nursing_documentation';
  perform pg_temp.rec('2b', m = 3, 'all three carry the nursing documentation domain: ' || m);
  select count(distinct t.code) into m from asmt_instrument_term it join asmt_catalogue_term t on t.id = it.term_id
   where it.instrument_id = any (ids) and t.dimension_code = 'method' and it.is_primary;
  perform pg_temp.rec('2c', m = 3, 'the primary methods differ: ' || m);

  -- 3. search
  select count(*) into m from asmt_catalogue_search('nursing assessment', '{}', 'name_asc', 200, 0) where id = any (ids);
  select count(*) into n from asmt_catalogue_search('nursing assessment', '{}', 'name_asc', 200, 0);
  perform pg_temp.rec('3', m = 3, 'search "nursing assessment" returns the three (total ' || n || ' on this database)');
  select count(*) into m from asmt_catalogue_search('', '{"family":"CA"}', 'name_asc', 200, 0) where id = any (ids);
  select count(*) into n from asmt_catalogue_search('', '{"family":"CA"}', 'name_asc', 200, 0);
  perform pg_temp.rec('3b', m = 1, 'family CA returns one of the three (total ' || n || ' on this database)');
  select count(*) into m from asmt_catalogue_search('nursing', '{"family":"DA","method":"chart_review"}', 'name_asc', 200, 0) where id = any (ids);
  perform pg_temp.rec('3c', m = 1, 'family DA with method chart review returns the chart audit');
  select count(*) into m from asmt_catalogue_search('respiratory', '{}', 'name_asc', 200, 0) where id = any (ids);
  perform pg_temp.rec('3d', m = 3, 'a domain word finds the three through their classification: ' || m);

  -- 4. the CA instrument references the framework and its competency by id, copying nothing
  select id into fw from frameworks where code = 'NUR-CCF' limit 1;
  select fc.id into comp from framework_competencies fc where fc.code = 'NUR-CCF-001' and fc.name = 'Respiratory Assessment' limit 1;
  perform pg_temp.rec('4a', fw is not null and comp is not null, 'the framework and competency exist on this database');
  perform public.asmt_catalogue_reference_add(ca, 'framework', 'frameworks', fw, 'NUR-CCF', 'Competen Nursing Competency Framework', null, actor);
  perform public.asmt_catalogue_reference_add(ca, 'framework_competency', 'framework_competencies', comp, 'NUR-CCF-001', 'Respiratory Assessment', null, actor);
  select count(*) into m from asmt_instrument_reference ir
    join frameworks f on ir.ref_table = 'frameworks' and ir.ref_id = f.id
   where ir.instrument_id = ca and f.code = 'NUR-CCF';
  select count(*) into n from asmt_instrument_reference ir
    join framework_competencies c on ir.ref_table = 'framework_competencies' and ir.ref_id = c.id
   where ir.instrument_id = ca and c.name = 'Respiratory Assessment';
  perform pg_temp.rec('4b', m = 1 and n = 1, 'both references resolve by ref_id to the live rows (no copied rows)');
  perform pg_temp.rec('4c', (select count(*) from asmt_catalogue_search('NUR-CCF', '{}', 'name_asc', 50, 0) where id = ca) = 1, 'the instrument is found by the framework code');

  -- 5. availability per product
  perform public.asmt_catalogue_set_availability(ca, 'individual', 'available', 'Scholar self-assessment (offered only under the Individual policy key)', actor);
  perform public.asmt_catalogue_set_availability(ca, 'enterprise', 'available', null, actor);
  perform public.asmt_catalogue_set_availability(ca, 'practice', 'unavailable', null, actor);
  perform public.asmt_catalogue_set_availability(cpa, 'enterprise', 'available', null, actor);
  perform public.asmt_catalogue_set_availability(cpa, 'practice', 'optional', null, actor);
  perform public.asmt_catalogue_set_availability(cpa, 'individual', 'unavailable', null, actor);
  perform public.asmt_catalogue_set_availability(da, 'enterprise', 'available', null, actor);
  perform public.asmt_catalogue_set_availability(da, 'practice', 'available', null, actor);
  perform public.asmt_catalogue_set_availability(da, 'individual', 'unavailable', null, actor);
  select count(*) into m from asmt_catalogue_search('', '{"product":"individual"}', 'name_asc', 200, 0) where id = any (ids);
  select count(*) into n from asmt_catalogue_search('', '{"product":"enterprise"}', 'name_asc', 200, 0) where id = any (ids);
  perform pg_temp.rec('5a', m = 1 and n = 3, 'Individual offers one of the three, Enterprise offers all three');
  select count(*) into m from asmt_catalogue_search('', '{"product":"practice"}', 'name_asc', 200, 0) where id = any (ids);
  perform pg_temp.rec('5b', m = 2, 'Practice: optional and available count, unavailable does not');
  select count(*) into m from asmt_instrument_availability where instrument_id = any (ids);
  perform pg_temp.rec('5c', m = 9, 'nine availability rows: ' || m);

  -- discovery needs a published version: none of the three has one yet
  perform pg_temp.rec('5d', (select count(*) from asmt_catalogue_search('', '{"status":"published"}', 'name_asc', 200, 0) where id = any (ids)) = 0
    and (select count(*) from asmt_catalogue_search('', '{"status":"none"}', 'name_asc', 200, 0) where id = any (ids)) = 3, 'status is no version yet for all three');

  -- the compact row
  select * into r from asmt_catalogue_search('Concurrent Nursing', '{}', 'name_asc', 5, 0) where id = cpa;
  perform pg_temp.rec('6', r.family_label = 'Clinical Practice Audit' and r.primary_domain_label = 'Respiratory'
    and array_to_string(r.method_labels, ',') like '%Concurrent comparison%', 'compact row: ' || r.code || ' / ' || r.family_label || ' / ' || r.primary_domain_label || ' / ' || array_to_string(r.method_labels, ','));

  select count(*) filter (where ok), count(*) filter (where not ok), coalesce(string_agg(id, ' ' order by id) filter (where not ok), '')
    into pass, fail, failed from pg_temp.proof;
  raise exception 'RESULT ASMT CATALOGUE ACCEPTANCE pass=% fail=% failed: %', pass, fail, failed;
end;
$$;
