-- ====================================================================================================
-- ASMT CATALOGUE DB PROOFS (migration 894). STAGING ONLY. Run by scripts/assessment-core-harness.ts catalogue,
-- never by hand.
-- ====================================================================================================
-- One transaction. It registers its own instruments, terms, availability, relations, references and
-- collections, checks what the database refuses and allows, and ALWAYS ENDS BY RAISING its RESULT line so
-- everything rolls back and nothing is kept. It never touches a real row. The harness replaces the marker line
-- below with the statements of one planted violation to prove that each control can fail.
--
-- Expect: RESULT ASMT CATALOGUE PROOFS pass=<n> fail=0 failed:
create temp table proof (id text, ok boolean, detail text) on commit drop;

create function pg_temp.rec(p_id text, p_ok boolean, p_detail text default null) returns void
language sql as $$ insert into pg_temp.proof values (p_id, coalesce(p_ok, false), p_detail) $$;

create function pg_temp.try_sql(p_sql text) returns text
language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

create function pg_temp.refused(p_id text, p_sql text, p_pattern text default '%') returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is not null and e ilike p_pattern, coalesce(left(e, 160), 'NOT REFUSED'));
end $$;

create function pg_temp.allowed(p_id text, p_sql text) returns void
language plpgsql as $$
declare e text := pg_temp.try_sql(p_sql);
begin
  perform pg_temp.rec(p_id, e is null, coalesce(left(e, 160), 'ok'));
end $$;

create function pg_temp.term(p_dim text, p_code text) returns uuid
language sql as $$ select id from asmt_catalogue_term where dimension_code = p_dim and code = p_code $$;

-- count of rows a search returns for a query and filters
create function pg_temp.hits(p_q text, p_filters jsonb default '{}') returns int
language sql as $$ select count(*)::int from asmt_catalogue_search(p_q, p_filters, 'name_asc', 200, 0) $$;

do $$
declare
  pass int := 0;
  fail int := 0;
  failed text := '';
  e text;
  n int;
  n0 int;
  actor uuid;
  i1 uuid; i2 uuid; i3 uuid;
  c1 text; c2 text;
  coll uuid;
  ref uuid;
  fw uuid;
  reg0 int;
  tid uuid;
  tid2 uuid;
  r record;
begin
  -- @@PLANT@@

  select id into actor from profiles order by id limit 1;
  if actor is null then
    raise exception 'RESULT ASMT CATALOGUE PROOFS needs one profile';
  end if;
  select coalesce((select next_no from asmt_instrument_family_counter where family_code = 'CA'), 1) into n0;
  reg0 := (public.asmt_catalogue_stats() ->> 'registered')::int;

  -- ---- registration and the permanent code ------------------------------------------------------------------------
  i1 := public.asmt_catalogue_register('CA', 'Zzcatprobe Alpha Respiratory Assessment', 'Direct observation of a zzcatdesc respiratory assessment', 'assessment', actor,
        jsonb_build_array(jsonb_build_object('term_id', pg_temp.term('method', 'direct_observation'), 'is_primary', true),
                          jsonb_build_object('term_id', pg_temp.term('domain', 'respiratory'), 'is_primary', true),
                          jsonb_build_object('term_id', pg_temp.term('population', 'nursing'), 'is_primary', false)));
  select code into c1 from asmt_instrument where id = i1;
  perform pg_temp.rec('K1', c1 = 'CA-' || lpad(n0::text, 6, '0'), 'the first code is ' || coalesce(c1, 'null') || ' expected CA-' || lpad(n0::text, 6, '0'));
  begin
    i2 := public.asmt_catalogue_register('CA', 'Zzcatprobe Beta Cardiac Check', null, null, actor);
    select code into c2 from asmt_instrument where id = i2;
  exception when others then c2 := 'error: ' || sqlerrm;
  end;
  perform pg_temp.rec('K2', c2 = 'CA-' || lpad((n0 + 1)::text, 6, '0'), 'the second code is ' || coalesce(c2, 'null'));
  i3 := public.asmt_catalogue_register('DA', 'Zzcatprobe Gamma Chart Audit', 'Retrospective zzcatdesc review', 'assessment', actor);
  perform pg_temp.rec('K2b', (select code from asmt_instrument where id = i3) = 'DA-' || lpad(coalesce((select next_no - 1 from asmt_instrument_family_counter where family_code = 'DA'), 0)::text, 6, '0'),
    'the DA counter is separate');
  select count(*) into n from asmt_instrument_version where instrument_id in (i1, i2, i3);
  perform pg_temp.rec('K3', n = 0, 'registering creates the master record and NO version');
  perform pg_temp.refused('K4', format($q$update asmt_instrument set code = 'CA-999999' where id = %L$q$, i1), '%permanent%');
  perform pg_temp.refused('K4b', format($q$update asmt_instrument set family_code = 'DA' where id = %L$q$, i1), '%permanent%');
  perform pg_temp.allowed('K5', format($q$update asmt_instrument set responsible_authority = 'Quality Council', governance_note = 'note', owning_entity = 'Competen Holdings' where id = %L$q$, i1));
  perform pg_temp.refused('K5b', format($q$update asmt_instrument set kind = 'other' where id = %L$q$, i1), '%permanent%');
  perform pg_temp.allowed('K5c', format($q$select public.asmt_catalogue_update_identity(%L, 'Zzcatprobe Alpha Respiratory Assessment v', 'd', 'Council', 'n', %L)$q$, i1, actor));
  perform pg_temp.refused('K5d', format($q$select public.asmt_catalogue_register('ZZNOPE', 'x', null, null, %L)$q$, actor), '%family%');
  perform pg_temp.refused('K5e', $q$select public.asmt_catalogue_register('CA', 'x', null, null, null)$q$, '%actor%');
  perform pg_temp.refused('K5f', format($q$select public.asmt_catalogue_register('CA', '   ', null, null, %L)$q$, actor), '%title%');

  -- ---- classification: one primary per dimension ------------------------------------------------------------------
  select count(*) into n from asmt_instrument_term where instrument_id = i1;
  perform pg_temp.rec('L1', n = 3, 'three terms stored at registration: ' || n);
  perform pg_temp.refused('L2', format($q$select public.asmt_catalogue_classify(%L, %L::jsonb, %L)$q$, i1,
    jsonb_build_array(jsonb_build_object('term_id', pg_temp.term('method', 'osce'), 'is_primary', true),
                      jsonb_build_object('term_id', pg_temp.term('method', 'chart_review'), 'is_primary', true))::text, actor), '%at most one primary%');
  perform pg_temp.allowed('L3', format($q$select public.asmt_catalogue_classify(%L, %L::jsonb, %L)$q$, i1,
    jsonb_build_array(jsonb_build_object('term_id', pg_temp.term('method', 'direct_observation'), 'is_primary', true),
                      jsonb_build_object('term_id', pg_temp.term('method', 'osce'), 'is_primary', false),
                      jsonb_build_object('term_id', pg_temp.term('domain', 'respiratory'), 'is_primary', true),
                      jsonb_build_object('term_id', pg_temp.term('population', 'nursing'), 'is_primary', true))::text, actor));
  select count(*) into n from asmt_instrument_term where instrument_id = i1;
  perform pg_temp.rec('L3b', n = 4, 'a method can have several terms with one primary: ' || n);
  perform pg_temp.refused('L4', format($q$insert into asmt_instrument_term (instrument_id, term_id, is_primary) values (%L, %L, true)$q$, i1, pg_temp.term('method', 'chart_review')),
    '%at most one primary%');
  perform pg_temp.allowed('L4b', format($q$insert into asmt_instrument_term (instrument_id, term_id, is_primary) values (%L, %L, false)$q$, i1, pg_temp.term('method', 'chart_review')));
  update asmt_catalogue_term set is_active = false where id = pg_temp.term('setting', 'diploma');
  perform pg_temp.refused('L5', format($q$insert into asmt_instrument_term (instrument_id, term_id) values (%L, %L)$q$, i1, pg_temp.term('setting', 'diploma')), '%not active%');
  perform pg_temp.refused('L6', format($q$select public.asmt_catalogue_classify(%L, '[]'::jsonb, null)$q$, i1), '%actor%');
  perform pg_temp.refused('L6b', format($q$select public.asmt_catalogue_classify(%L, '[]'::jsonb, %L)$q$, gen_random_uuid(), actor), '%does not exist%');

  -- ---- terms: hierarchy rules -------------------------------------------------------------------------------------------
  perform pg_temp.refused('M1', format($q$insert into asmt_catalogue_term (dimension_code, code, label, parent_id) values ('method', 'zzcat_child', 'Child', %L)$q$, pg_temp.term('method', 'osce')),
    '%does not allow a hierarchy%');
  insert into asmt_catalogue_term (dimension_code, code, label, parent_id) values ('domain', 'zzcat_resp_child', 'Zzcat respiratory child', pg_temp.term('domain', 'respiratory')) returning id into tid;
  perform pg_temp.rec('M2', tid is not null, 'a child term is allowed in a hierarchical dimension');
  perform pg_temp.refused('M3', format($q$update asmt_catalogue_term set parent_id = %L where id = %L$q$, tid, pg_temp.term('domain', 'respiratory')), '%ancestor%');
  perform pg_temp.refused('M4', format($q$insert into asmt_catalogue_term (dimension_code, code, label, parent_id) values ('population', 'zzcat_x', 'X', %L)$q$, pg_temp.term('domain', 'respiratory')), '%same dimension%');
  perform pg_temp.refused('M5', $q$insert into asmt_catalogue_term (dimension_code, code, label, source_kind) values ('level', 'zzcat_lv', 'Level', 'frameworks')$q$, '%source_check%');
  select count(*) into n from asmt_catalogue_term where dimension_code = 'level' and code not like 'zzcat%';
  perform pg_temp.rec('M6', n = 0, 'level terms are not seeded: ' || n);

  -- ---- availability per product ------------------------------------------------------------------------------------------
  perform public.asmt_catalogue_set_availability(i1, 'enterprise', 'available', null, actor);
  perform public.asmt_catalogue_set_availability(i1, 'individual', 'optional', 'scholar offer needs the policy key', actor);
  perform public.asmt_catalogue_set_availability(i1, 'practice', 'unavailable', null, actor);
  select count(*) into n from asmt_instrument_availability where instrument_id = i1;
  perform pg_temp.rec('N1', n = 3, 'availability is per product line: ' || n);
  select count(*) into n from asmt_instrument_availability where instrument_id = i1 and ((product_line = 'enterprise' and mode = 'available') or (product_line = 'individual' and mode = 'optional') or (product_line = 'practice' and mode = 'unavailable'));
  perform pg_temp.rec('N1b', n = 3, 'each product keeps its own mode: ' || n);
  perform pg_temp.refused('N2', format($q$select public.asmt_catalogue_set_availability(%L, 'enterprise', 'everywhere', null, %L)$q$, i1, actor), '%mode_check%');
  perform pg_temp.refused('N3', format($q$select public.asmt_catalogue_set_availability(%L, 'no_such_product', 'available', null, %L)$q$, i1, actor), '%foreign key%');
  perform public.asmt_catalogue_set_availability(i1, 'practice', null, null, actor);
  select count(*) into n from asmt_instrument_availability where instrument_id = i1 and product_line = 'practice';
  perform pg_temp.rec('N4', n = 0, 'a null mode clears the row');
  perform pg_temp.rec('N5', pg_temp.hits('zzcatprobe', '{"product":"enterprise"}') = 1 and pg_temp.hits('zzcatprobe', '{"product":"individual"}') = 1
                      and pg_temp.hits('zzcatprobe', '{"product":"platform"}') = 0, 'the product filter finds only instruments available or optional there');

  -- ---- relations and references ---------------------------------------------------------------------------------------------
  perform pg_temp.allowed('O1', format($q$select public.asmt_catalogue_set_relation(%L, %L, 'companion', 'pair', false, %L)$q$, i1, i2, actor));
  perform pg_temp.refused('O2', format($q$select public.asmt_catalogue_set_relation(%L, %L, 'related', null, false, %L)$q$, i1, i1, actor), '%itself%');
  perform pg_temp.refused('O2b', format($q$insert into asmt_instrument_relation (instrument_id, related_instrument_id, relation) values (%L, %L, 'related')$q$, i1, i1), '%self_check%');
  perform pg_temp.refused('O3', format($q$select public.asmt_catalogue_set_relation(%L, %L, 'sibling', null, false, %L)$q$, i1, i2, actor), '%kind_check%');
  perform pg_temp.allowed('O4', format($q$select public.asmt_catalogue_set_relation(%L, %L, 'companion', null, true, %L)$q$, i1, i2, actor));
  select count(*) into n from asmt_instrument_relation where instrument_id = i1;
  perform pg_temp.rec('O4b', n = 0, 'a relation can be removed');
  select id into fw from frameworks where code = 'NUR-CCF' limit 1;
  ref := public.asmt_catalogue_reference_add(i1, 'framework', 'frameworks', coalesce(fw, gen_random_uuid()), 'NUR-CCF', 'Competen Nursing Competency Framework', null, actor);
  perform public.asmt_catalogue_reference_add(i1, 'framework', 'frameworks', coalesce(fw, gen_random_uuid()), 'NUR-CCF', 'Competen Nursing Competency Framework', 'v1', actor);
  select count(*) into n from asmt_instrument_reference where instrument_id = i1;
  perform pg_temp.rec('P1', n = 1 and ref is not null, 'a repeated reference is one row (and holds the id, not a copy): ' || n);
  perform pg_temp.refused('P2', format($q$select public.asmt_catalogue_reference_add(%L, 'no_such_kind', null, null, 'X', 'X', null, %L)$q$, i1, actor), '%foreign key%');
  perform pg_temp.refused('P3', format($q$insert into asmt_instrument_reference (instrument_id, kind, ref_id, ref_label) values (%L, 'framework', gen_random_uuid(), 'x')$q$, i1), '%table_check%');
  perform pg_temp.rec('P4', pg_temp.hits('NUR-CCF', '{}') >= 1, 'a search by the referenced framework code finds the instrument');
  perform public.asmt_catalogue_reference_remove(ref, actor);
  select count(*) into n from asmt_instrument_reference where instrument_id = i1;
  perform pg_temp.rec('P5', n = 0, 'a reference can be removed');

  -- ---- collections ----------------------------------------------------------------------------------------------------------
  insert into asmt_collection (code, name, description) values ('ZZCAT-COLL', 'Zzcat collection', 'd') returning id into coll;
  perform public.asmt_catalogue_collection_member(coll, i1, true, actor);
  perform public.asmt_catalogue_collection_member(coll, i3, true, actor);
  perform public.asmt_catalogue_collection_member(coll, i3, true, actor);
  select count(*) into n from asmt_collection_member where collection_id = coll;
  perform pg_temp.rec('Q1', n = 2, 'two members, a repeat is ignored: ' || n);
  perform pg_temp.rec('Q2', pg_temp.hits('', '{"collection":"ZZCAT-COLL"}') = 2, 'the collection filter lists its members');
  perform pg_temp.refused('Q3', $q$insert into asmt_collection (code, name) values ('bad code', 'x')$q$, '%code_check%');
  perform public.asmt_catalogue_collection_member(coll, i3, false, actor);
  select count(*) into n from asmt_collection_member where collection_id = coll;
  perform pg_temp.rec('Q4', n = 1, 'a member can be removed');

  -- ---- search ----------------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('R1', pg_temp.hits('zzcatprobe') = 3, 'a title word finds the three instruments: ' || pg_temp.hits('zzcatprobe'));
  perform pg_temp.rec('R1b', pg_temp.hits('alpha respiratory') = 1, 'two title words must both match');
  perform pg_temp.rec('R2', pg_temp.hits(c1) = 1, 'the exact code finds one instrument: ' || c1);
  perform pg_temp.rec('R2b', pg_temp.hits(lower(substr(c1, 1, 5))) >= 1, 'a partial code finds it');
  perform pg_temp.rec('R3', pg_temp.hits('zzcatdesc') = 1, 'the description is searched: ' || pg_temp.hits('zzcatdesc'));
  perform pg_temp.rec('R4', pg_temp.hits('zzcatprobe', '{"family":"CA"}') = 2 and pg_temp.hits('zzcatprobe', '{"family":"DA"}') = 1 and pg_temp.hits('zzcatprobe', '{"family":"KA"}') = 0,
    'the family filter narrows');
  perform pg_temp.rec('R5', pg_temp.hits('zzcatprobe', '{"method":"direct_observation"}') = 1 and pg_temp.hits('zzcatprobe', '{"method":"osce"}') = 1
    and pg_temp.hits('zzcatprobe', '{"method":"interview"}') = 0, 'the method filter uses the classification');
  perform pg_temp.rec('R5b', pg_temp.hits('zzcatprobe', '{"domain":"respiratory"}') = 1 and pg_temp.hits('zzcatprobe', '{"population":"nursing"}') = 1
    and pg_temp.hits('zzcatprobe', '{"domain":"cardiovascular"}') = 0, 'domain and population filters');
  insert into asmt_catalogue_term (dimension_code, code, label) values ('keyword', 'zzcat_kw', 'Zzcatkeyword') returning id into tid2;
  perform public.asmt_catalogue_classify(i2, jsonb_build_array(jsonb_build_object('term_id', tid2, 'is_primary', false)), actor);
  perform pg_temp.rec('R6', pg_temp.hits('zzcatkeyword') = 1, 'a keyword term is searched');
  perform pg_temp.rec('R7', pg_temp.hits('zzcatprobe', '{"status":"none"}') = 3, 'status none means no version yet');
  perform pg_temp.rec('R7b', pg_temp.hits('zzcatprobe', '{"status":"published"}') = 0, 'no instrument is published');
  select count(*) into n from asmt_catalogue_search('zzcatprobe', '{}', 'name_asc', 1, 0) where total = 3;
  perform pg_temp.rec('R8', n = 1, 'paging returns one row and the filtered total');
  select name into e from asmt_catalogue_search('zzcatprobe', '{}', 'name_desc', 1, 0);
  perform pg_temp.rec('R9', e like 'Zzcatprobe Gamma%', 'sort by name descending: ' || coalesce(e, 'null'));
  perform pg_temp.rec('R10', pg_temp.hits('zzcatprobe nothing') = 0, 'every word must match');
  select * into r from asmt_catalogue_search(c1, '{}', 'name_asc', 5, 0);
  perform pg_temp.rec('R11', r.family_label = 'Competency Assessment' and r.primary_domain_label = 'Respiratory' and 'Direct observation' = any (r.method_labels)
    and r.latest_state is null and r.owner = 'Competen Holdings', 'the compact row carries family, primary domain, methods, no version, owner');
  perform pg_temp.rec('R12', (public.asmt_catalogue_stats() ->> 'registered')::int = reg0 + 3, 'the registered tile is a real count');

  -- ---- duplicate warning -------------------------------------------------------------------------------------------------------
  select count(*) into n from asmt_catalogue_similar('Zzcatprobe Alpha Respiratory Assessment', 'CA') where id = i1 and same_family;
  perform pg_temp.rec('S1', n = 1, 'the same title is flagged, same family first');
  select count(*) into n from asmt_catalogue_similar('Zzcatprobe Alpha Respiratory', 'CA') where id = i1;
  perform pg_temp.rec('S2', n = 1, 'a near title is flagged');
  select count(*) into n from asmt_catalogue_similar('Unrelated Wound Dressing Procedure', 'CA');
  perform pg_temp.rec('S3', n = 0, 'an unrelated title is not flagged');
  perform pg_temp.rec('S4', (select count(*) from asmt_catalogue_similar('Zzcatprobe', null)) <= 5, 'at most five candidates');

  -- ---- audit ----------------------------------------------------------------------------------------------------------------------
  select count(*) into n from asmt_definition_event where subject_table = 'asmt_instrument' and subject_id = i1 and event = 'catalogue_classified';
  perform pg_temp.rec('T1', n >= 2, 'classification is audited: ' || n);
  select count(*) into n from asmt_definition_event where subject_table = 'asmt_instrument' and subject_id = i1 and event = 'catalogue_availability';
  perform pg_temp.rec('T2', n = 4, 'each availability change is audited: ' || n);
  select count(*) into n from asmt_definition_event where subject_table = 'asmt_instrument' and subject_id = i1 and event = 'catalogue_relation';
  perform pg_temp.rec('T3', n >= 4, 'relations and references are audited: ' || n);
  select count(*) into n from asmt_definition_event where subject_table = 'asmt_instrument' and subject_id = i3 and event = 'catalogue_collection';
  perform pg_temp.rec('T4', n = 3, 'collection membership is audited: ' || n);
  select count(*) into n from asmt_definition_event where subject_table = 'asmt_instrument' and subject_id = i1 and event = 'catalogue_registered';
  perform pg_temp.rec('T5', n = 1, 'registration is audited');

  -- ---- privileges and posture -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('U1', not has_function_privilege('anon', 'public.asmt_catalogue_register(text,text,text,text,uuid,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.asmt_catalogue_register(text,text,text,text,uuid,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.asmt_catalogue_search(text,jsonb,text,integer,integer)', 'execute')
    and has_function_privilege('service_role', 'public.asmt_catalogue_register(text,text,text,text,uuid,jsonb)', 'execute'), 'the catalogue functions are service role only');
  select count(*) into n from pg_class where relname in ('asmt_catalogue_dimension', 'asmt_catalogue_term', 'asmt_instrument_term', 'asmt_instrument_relation',
    'asmt_instrument_reference', 'asmt_instrument_availability', 'asmt_instrument_org_scope', 'asmt_collection', 'asmt_collection_member')
    and relnamespace = 'public'::regnamespace and relrowsecurity;
  perform pg_temp.rec('U2', n = 9, 'row level security is on for all nine tables: ' || n);
  -- cascade: an instrument with no version can be removed and takes its classification with it
  delete from asmt_instrument where id = i2;
  select count(*) into n from asmt_instrument_term where instrument_id = i2;
  perform pg_temp.rec('U3', n = 0, 'removing an instrument without versions removes its catalogue rows');

  -- ---- result -----------------------------------------------------------------------------------------------------------------------
  select count(*) filter (where ok), count(*) filter (where not ok), coalesce(string_agg(id, ' ' order by id) filter (where not ok), '')
    into pass, fail, failed from pg_temp.proof;
  raise exception 'RESULT ASMT CATALOGUE PROOFS pass=% fail=% failed: %', pass, fail, failed;
end;
$$;
