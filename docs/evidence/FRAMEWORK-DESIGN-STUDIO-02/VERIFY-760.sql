-- ====================================================================================================
-- APPLY THIS FILE WHOLE. VERIFY-760: Areas and organisational moves exercised on STAGING inside ONE transaction
-- that ALWAYS ROLLS BACK (it ends by raising its results). Synthetic frameworks only. Profiles as in VERIFY-752.
-- STAGING ONLY.
-- ====================================================================================================

create function pg_temp.ord760(f uuid) returns text language sql as $o$
  select coalesce((select string_agg(a.name || '=' || a.sort_order, ',' order by a.name) from framework_areas a where a.framework_id = f), '')
    || '|' || coalesce((select string_agg(d.name || '=' || d.sort_order || '@' || coalesce(a.name, '-'), ',' order by d.name)
                          from framework_domains d left join framework_areas a on a.id = d.area_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(c.name || '=' || c.sort_order || '@' || d.name, ',' order by c.name)
                          from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(s.name || '=' || s.sort_order, ',' order by s.name) from competency_skills s
                          join framework_competencies c on c.id = s.competency_id join framework_domains d on d.id = c.domain_id where d.framework_id = f), '')
$o$;
create function pg_temp.hash760(f uuid) returns text language sql as $h$
  select coalesce(string_agg(c.id::text || ':' || public.competency_content_hash(c.id), ',' order by c.id), '')
    from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = f
$h$;

do $probe$
declare
  p_author uuid := '6a59fe42-a9aa-4723-8dfd-a16b74626ac7';
  p_publisher uuid := '667cf735-faf6-4010-93a0-589e8c753467';
  g uuid; gd1 uuid; gd2 uuid; gd3 uuid; gc1 uuid; gc2 uuid; gc3 uuid; gs1 uuid; gs2 uuid; ga1 uuid; ga2 uuid; ga3 uuid;
  h uuid; hd1 uuid; hc1 uuid; ha1 uuid;
  f uuid; fd1 uuid; fd2 uuid; fc1 uuid; fc2 uuid; fa1 uuid;
  o0 text; o1 text; h0 text; v0 int; s text;
  r text := '';
begin
  -- G: a shared framework with no CFCA layer (466 and 640 let it through). H: another framework.
  insert into frameworks (name, library, pub_status) values ('PROBE 760 G', 'core', 'draft') returning id into g;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD1', 1) returning id into gd1;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD2', 2) returning id into gd2;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD3', 3) returning id into gd3;
  insert into framework_competencies (domain_id, name, sort_order) values (gd1, 'GC1', 1) returning id into gc1;
  insert into framework_competencies (domain_id, name, sort_order) values (gd1, 'GC2', 2) returning id into gc2;
  insert into framework_competencies (domain_id, name, sort_order) values (gd2, 'GC3', 1) returning id into gc3;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (gc1, 'GS1', 1, 'knowledge') returning id into gs1;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (gc2, 'GS2', 1, 'knowledge') returning id into gs2;
  insert into frameworks (name, library, pub_status) values ('PROBE 760 H', 'core', 'draft') returning id into h;
  insert into framework_domains (framework_id, name, sort_order) values (h, 'HD1', 1) returning id into hd1;
  insert into framework_competencies (domain_id, name, sort_order) values (hd1, 'HC1', 1) returning id into hc1;
  insert into framework_areas (framework_id, name, sort_order, created_by) values (h, 'H Area', 1, p_author) returning id into ha1;

  -- A1 Areas CRUD: create, rename, a too-short and a duplicate name refused, delete.
  insert into framework_areas (framework_id, name, sort_order, created_by) values (g, 'Clinical Practice', 1, p_author) returning id into ga1;
  insert into framework_areas (framework_id, name, sort_order, created_by) values (g, 'Professional Practice', 2, p_author) returning id into ga2;
  insert into framework_areas (framework_id, name, sort_order, created_by) values (g, 'Temp', 3, p_author) returning id into ga3;
  update framework_areas set name = 'Temporary' where id = ga3;
  s := '';
  begin insert into framework_areas (framework_id, name) values (g, 'X'); s := s || 'short_accepted '; exception when check_violation then null; end;
  begin insert into framework_areas (framework_id, name) values (g, 'Clinical Practice'); s := s || 'dup_accepted '; exception when unique_violation then null; end;
  begin insert into framework_areas (framework_id, name) values (g, ' Padded '); s := s || 'padded_accepted '; exception when check_violation then null; end;
  delete from framework_areas where id = ga3;
  r := r || 'A1 areas_crud=' || case when s = '' and (select string_agg(name, ',' order by sort_order) from framework_areas where framework_id = g) = 'Clinical Practice,Professional Practice'
        then 'ok' else 'FAIL ' || s end || '; ';

  -- A2 a domain set to an Area of its framework, and back to none.
  update framework_domains set area_id = ga1 where id = gd1;
  update framework_domains set area_id = ga2 where id = gd3;
  r := r || 'A2 domain_area=' || case when (select area_id from framework_domains where id = gd1) = ga1 then 'ok' else 'FAIL' end || '; ';

  -- A3 cross-framework Area refused (domain of G into an Area of H), and an Area may not change framework.
  begin
    update framework_domains set area_id = ha1 where id = gd2;
    r := r || 'A3=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'framework_domains.area_id: the Area must belong to the same framework%' then 'A3 cross_framework_area=ok; ' else 'A3=FAIL(' || sqlerrm || '); ' end;
  end;
  begin
    update framework_areas set framework_id = h where id = ga2;
    r := r || 'A3b=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'framework_areas: an Area stays%' then 'A3b area_stays=ok; ' else 'A3b=FAIL(' || sqlerrm || '); ' end;
  end;

  -- A4 deleting an Area leaves its domains with no Area (on delete set null).
  insert into framework_areas (framework_id, name, sort_order) values (g, 'Gone', 9) returning id into ga3;
  update framework_domains set area_id = ga3 where id = gd2;
  delete from framework_areas where id = ga3;
  r := r || 'A4 delete_sets_null=' || case when (select area_id from framework_domains where id = gd2) is null then 'ok' else 'FAIL' end || '; ';

  -- Publish G once with no layout (version 1.0.0).
  update frameworks set pub_status = 'published', version_major = 1, version_minor = 0, version_revision = 0, published_by = p_author where id = g;
  o0 := pg_temp.ord760(g);
  h0 := pg_temp.hash760(g);

  -- L1 a published layout draft with a competency move, domain Areas, an Area order and an Area name swap: saved,
  -- nothing live changes.
  update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1,
    'competencies', jsonb_build_object(gd2::text, jsonb_build_array(gc2, gc3)),
    'domainAreas', jsonb_build_object(gd2::text, ga2, gd3::text, null),
    'areas', jsonb_build_array(ga2, ga1),
    'areaNames', jsonb_build_object(ga1::text, 'Professional Practice', ga2::text, 'Clinical Practice')) where id = g;
  r := r || 'L1 draft_saved_live_kept=' || case when pg_temp.ord760(g) = o0 and framework_layout_check(g) is null then 'ok' else 'FAIL ' || coalesce(framework_layout_check(g), pg_temp.ord760(g)) end || '; ';

  -- L2 a criterion under another competency is still refused (substantive, S5 revision drafts).
  begin
    update frameworks set layout_draft = layout_draft || jsonb_build_object('criteria', jsonb_build_object(gc1::text, jsonb_build_array(gs2, gs1))) where id = g;
    r := r || 'L2=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like '%a criterion is repeated or is not of that competency%' then 'L2 criterion_cross_competency=ok; ' else 'L2=FAIL(' || sqlerrm || '); ' end;
  end;

  -- L3 refused: a competency of another framework, an Area of another framework, a competency listed under two domains,
  -- two Areas ending with the same name, an unknown key.
  s := '';
  begin update frameworks set layout_draft = jsonb_build_object('v', 1, 'competencies', jsonb_build_object(gd1::text, jsonb_build_array(hc1))) where id = g;
        s := s || 'foreign_comp_accepted '; exception when others then if sqlerrm not like '%not of this framework%' then s := s || 'foreign_comp(' || sqlerrm || ') '; end if; end;
  begin update frameworks set layout_draft = jsonb_build_object('v', 1, 'domainAreas', jsonb_build_object(gd1::text, ha1)) where id = g;
        s := s || 'foreign_area_accepted '; exception when others then if sqlerrm not like '%Area it places a domain in is no longer in this framework%' then s := s || 'foreign_area(' || sqlerrm || ') '; end if; end;
  begin update frameworks set layout_draft = jsonb_build_object('v', 1, 'areas', jsonb_build_array(ha1)) where id = g;
        s := s || 'foreign_area_order_accepted '; exception when others then if sqlerrm not like '%Area it names is no longer in this framework%' then s := s || 'foreign_area_order(' || sqlerrm || ') '; end if; end;
  begin update frameworks set layout_draft = jsonb_build_object('v', 1, 'competencies', jsonb_build_object(gd1::text, jsonb_build_array(gc1), gd2::text, jsonb_build_array(gc1))) where id = g;
        s := s || 'twice_accepted '; exception when others then if sqlerrm not like '%a competency is named twice%' then s := s || 'twice(' || sqlerrm || ') '; end if; end;
  begin update frameworks set layout_draft = jsonb_build_object('v', 1, 'areaNames', jsonb_build_object(ga1::text, 'Professional Practice')) where id = g;
        s := s || 'same_name_accepted '; exception when others then if sqlerrm not like '%two Areas would have the same name%' then s := s || 'same_name(' || sqlerrm || ') '; end if; end;
  begin update frameworks set layout_draft = jsonb_build_object('v', 1, 'moves', '{}'::jsonb) where id = g;
        s := s || 'unknown_key_accepted '; exception when others then if sqlerrm not like '%not a version 1 layout%' then s := s || 'unknown_key(' || sqlerrm || ') '; end if; end;
  r := r || 'L3 refusals=' || case when s = '' and pg_temp.ord760(g) = o0 then 'ok' else 'FAIL ' || s end || '; ';

  -- S1 a stale draft (an Area it names was deleted) refuses the publication whole: the valid move is not applied.
  insert into framework_areas (framework_id, name, sort_order) values (g, 'Short lived', 5) returning id into ga3;
  update frameworks set layout_draft = layout_draft || jsonb_build_object('areas', jsonb_build_array(ga2, ga3, ga1)) where id = g;
  delete from framework_areas where id = ga3;
  o0 := pg_temp.ord760(g);
  select version_revision into v0 from frameworks where id = g;
  begin
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = g;
    r := r || 'S1=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'framework layout at publication: the pending layout is out of date, an Area it names is no longer in this framework%'
                    and pg_temp.ord760(g) = o0 and (select layout_draft is not null and version_revision = v0 from frameworks where id = g)
               then 'S1 stale_refused_nothing_applied=ok; ' else 'S1=FAIL(' || sqlerrm || '); ' end;
  end;
  update frameworks set layout_draft = layout_draft || jsonb_build_object('areas', jsonb_build_array(ga2, ga1)) where id = g;

  -- P1 republication as the app role: the move, the domain Areas, the Area order and the swapped names are applied in
  -- the statement, the domain the competency left is renumbered, the draft is cleared, and no content hash changes.
  begin
    set local role service_role;
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = g;
    reset role;
    o1 := pg_temp.ord760(g);
    r := r || 'P1 applied_atomically=' || case when o1 = 'Clinical Practice=1,Professional Practice=2|GD1=1@Professional Practice,GD2=2@Clinical Practice,GD3=3@-|GC1=1@GD1,GC2=1@GD2,GC3=2@GD2|GS1=1,GS2=1'
          and (select layout_draft is null and version_revision = v0 + 1 from frameworks where id = g) then 'ok' else 'FAIL ' || o1 end || '; ';
    r := r || 'H1 hashes_unchanged=' || case when pg_temp.hash760(g) = h0 then 'ok' else 'FAIL' end || '; ';
  exception when others then reset role; r := r || 'P1=FAIL(' || sqlerrm || '); ';
  end;

  -- F: a shared CFCA framework, published (inserted published while it owned nothing, so 466 let it in).
  insert into frameworks (name, library, competency_layer, pub_status, version_major, version_minor, version_revision)
  values ('PROBE 760 F', 'core', 'foundational', 'published', 1, 0, 0) returning id into f;
  insert into framework_domains (framework_id, name, sort_order) values (f, 'FD1', 1) returning id into fd1;
  insert into framework_domains (framework_id, name, sort_order) values (f, 'FD2', 2) returning id into fd2;
  insert into framework_competencies (domain_id, name, sort_order) values (fd1, 'FC1', 1) returning id into fc1;
  insert into framework_competencies (domain_id, name, sort_order) values (fd1, 'FC2', 2) returning id into fc2;
  insert into framework_areas (framework_id, name, sort_order) values (f, 'F Area', 1) returning id into fa1;
  update frameworks set layout_draft_by = p_publisher, layout_draft = jsonb_build_object('v', 1,
    'competencies', jsonb_build_object(fd2::text, jsonb_build_array(fc1)), 'domainAreas', jsonb_build_object(fd1::text, fa1, fd2::text, fa1)) where id = f;
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name)
  values (p_publisher, 'PROBE publisher', 'move_competency_domain', 'framework', f, 'PROBE 760 F');
  o0 := pg_temp.ord760(f);
  h0 := pg_temp.hash760(f);

  -- R640 the person who moved it publishing: 640 refuses (the move is contribution), nothing is applied.
  begin
    update frameworks set version_revision = version_revision + 1, published_by = p_publisher where id = f;
    r := r || 'R640=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like '%not independent. The publisher authored or curated%' and pg_temp.ord760(f) = o0
                    and (select layout_draft is not null and version_revision = 0 from frameworks where id = f)
               then 'R640 refused_kept=ok; ' else 'R640=FAIL(' || sqlerrm || '); ' end;
  end;

  -- R466 an app-shaped republication with unapproved competencies: 466 refuses, nothing applied.
  begin
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = f;
    r := r || 'R466=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'cfca publication:%' and pg_temp.ord760(f) = o0
                    and (select layout_draft is not null and version_revision = 0 from frameworks where id = f)
               then 'R466 refused_kept=ok; ' else 'R466=FAIL(' || sqlerrm || '); ' end;
  end;

  -- A640 an independent publisher: applied and cleared, hashes unchanged.
  begin
    update frameworks set version_revision = version_revision + 1, published_by = p_author where id = f;
    r := r || 'A640 independent_applied=' || case when pg_temp.ord760(f) = 'F Area=1|FD1=1@F Area,FD2=2@F Area|FC1=1@FD2,FC2=1@FD1|'
               and pg_temp.hash760(f) = h0 and (select layout_draft is null and version_revision = 1 from frameworks where id = f) then 'ok' else 'FAIL ' || pg_temp.ord760(f) end || '; ';
  exception when others then r := r || 'A640=FAIL(' || sqlerrm || '); ';
  end;

  -- F4 the clinical review SoD guard leaves the six organisational actions out of authorship, reorder_layout kept.
  select prosrc into s from pg_proc where proname = 'clinical_review_decision_sod_guard';
  r := r || 'F4 not_authorship=' || case when s like '%''reorder_layout'', ''create_area'', ''rename_area'', ''delete_area'', ''reorder_areas'', ''set_domain_area'', ''move_competency_domain''%'
        and (select prosrc not like '%create_area%' from pg_proc where proname = 'frameworks_sod_publication_guard') then 'ok' else 'FAIL' end || '; ';

  -- T1 trigger kinds unchanged: 752 apply AFTER ROW, 466 and 640 BEFORE ROW.
  r := r || 'T1 order=' || case when
        (select (tgtype & 3) from pg_trigger where tgname = 'frameworks_layout_apply_on_publish' and tgrelid = 'frameworks'::regclass) = 1
    and (select (tgtype & 3) from pg_trigger where tgname = 'trg_cfca_framework_publication_guard' and tgrelid = 'frameworks'::regclass) = 3
    and (select (tgtype & 3) from pg_trigger where tgname = 'trg_frameworks_sod_publication_guard' and tgrelid = 'frameworks'::regclass) = 3
    then 'ok' else 'FAIL' end || '; ';

  raise exception 'VERIFY %', r;
end
$probe$;
