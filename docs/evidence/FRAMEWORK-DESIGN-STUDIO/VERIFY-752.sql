-- ====================================================================================================
-- APPLY THIS FILE WHOLE. VERIFY-752: the apply-on-publish trigger exercised on STAGING inside ONE transaction that
-- ALWAYS ROLLS BACK (it ends by raising its results). Synthetic frameworks only. Profiles as in VERIFY-750-751.
-- STAGING ONLY.
-- ====================================================================================================

create function pg_temp.ord752(f uuid) returns text language sql as $o$
  select coalesce((select string_agg(d.name || '=' || d.sort_order, ',' order by d.name) from framework_domains d where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(c.name || '=' || c.sort_order, ',' order by c.name) from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(s.name || '=' || s.sort_order, ',' order by s.name) from competency_skills s join framework_competencies c on c.id = s.competency_id join framework_domains d on d.id = c.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select array_to_string(component_order, ',') from frameworks where id = f), 'null')
$o$;

do $probe$
declare
  p_author uuid := '6a59fe42-a9aa-4723-8dfd-a16b74626ac7';
  p_publisher uuid := '667cf735-faf6-4010-93a0-589e8c753467';
  g uuid; gd1 uuid; gd2 uuid; gd3 uuid; gc1 uuid; gc2 uuid; gc3 uuid; gc4 uuid; gs1 uuid; gs2 uuid; gs3 uuid;
  f uuid; fd1 uuid; fd2 uuid; fc1 uuid; fc2 uuid;
  o0 text; o1 text; v0 int; v1 int; s text;
  r text := '';
begin
  -- T1 trigger kinds: 752 is AFTER ROW, the 466 and 640 guards are BEFORE ROW.
  r := r || 'T1 order=' || case when
        (select (tgtype & 3) from pg_trigger where tgname = 'frameworks_layout_apply_on_publish' and tgrelid = 'frameworks'::regclass) = 1
    and (select (tgtype & 3) from pg_trigger where tgname = 'trg_cfca_framework_publication_guard' and tgrelid = 'frameworks'::regclass) = 3
    and (select (tgtype & 3) from pg_trigger where tgname = 'trg_frameworks_sod_publication_guard' and tgrelid = 'frameworks'::regclass) = 3
    then 'ok' else 'FAIL' end || '; ';

  -- G: a shared framework with no CFCA layer (466 and 640 let it through), never published.
  insert into frameworks (name, library, pub_status) values ('PROBE 752 G', 'core', 'draft') returning id into g;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD1', 1) returning id into gd1;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD2', 2) returning id into gd2;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD3', 3) returning id into gd3;
  insert into framework_competencies (domain_id, name, sort_order) values (gd1, 'GC1', 1) returning id into gc1;
  insert into framework_competencies (domain_id, name, sort_order) values (gd1, 'GC2', 2) returning id into gc2;
  insert into framework_competencies (domain_id, name, sort_order) values (gd1, 'GC3', 3) returning id into gc3;
  insert into framework_competencies (domain_id, name, sort_order) values (gd2, 'GC4', 1) returning id into gc4;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (gc1, 'GS1', 1, 'clinical_skills') returning id into gs1;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (gc1, 'GS2', 2, 'knowledge') returning id into gs2;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (gc1, 'GS3', 3, 'knowledge') returning id into gs3;
  o0 := pg_temp.ord752(g);

  -- A partial layout: unnamed rows follow in their current order.
  update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1,
    'domains', jsonb_build_array(gd3, gd1),
    'competencies', jsonb_build_object(gd1::text, jsonb_build_array(gc3, gc1)),
    'criteria', jsonb_build_object(gc1::text, jsonb_build_array(gs3, gs1)),
    'componentOrder', '["knowledge"]'::jsonb) where id = g;
  r := r || 'K1 check_fine=' || case when framework_layout_check(g) is null then 'ok' else 'FAIL ' || framework_layout_check(g) end || '; ';

  -- N1 and N2 non-publication updates never apply the layout.
  update frameworks set name = 'PROBE 752 G renamed' where id = g;
  r := r || 'N1 rename=' || case when pg_temp.ord752(g) = o0 and (select layout_draft is not null from frameworks where id = g) then 'ok' else 'FAIL' end || '; ';
  update frameworks set pub_status = 'in_review' where id = g;
  r := r || 'N2 in_review=' || case when pg_temp.ord752(g) = o0 and (select layout_draft is not null from frameworks where id = g) then 'ok' else 'FAIL' end || '; ';

  -- P1 first publication, the app statement shape (pub_status, version, published_by): applied and cleared at once.
  update frameworks set pub_status = 'published', version_major = 1, version_minor = 0, version_revision = 0, published_by = p_author where id = g;
  o1 := pg_temp.ord752(g);
  r := r || 'P1 first_publication=' || case when o1 = 'GD1=2,GD2=3,GD3=1|GC1=2,GC2=3,GC3=1,GC4=1|GS1=2,GS2=3,GS3=1|knowledge,clinical_skills,knowledge_application'
        and (select layout_draft is null and layout_draft_by is null and layout_draft_at is null and pub_status = 'published' from frameworks where id = g)
        then 'ok' else 'FAIL ' || o1 end || '; ';

  -- N3 and N4 on the published framework: a status write without a new version, and the version_num stamp, do not apply.
  update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(gd1, gd2, gd3)) where id = g;
  r := r || 'N5 saving_draft=' || case when pg_temp.ord752(g) = o1 then 'ok' else 'FAIL' end || '; ';
  update frameworks set pub_status = 'published' where id = g;
  r := r || 'N3 same_version=' || case when pg_temp.ord752(g) = o1 and (select layout_draft is not null from frameworks where id = g) then 'ok' else 'FAIL' end || '; ';
  update frameworks set version_num = coalesce(version_num, 0) + 1 where id = g;
  r := r || 'N4 version_num=' || case when pg_temp.ord752(g) = o1 and (select layout_draft is not null from frameworks where id = g) then 'ok' else 'FAIL' end || '; ';

  -- P2 republication (a new revision while published): applied, the section order (not named) is kept.
  update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = g;
  o1 := pg_temp.ord752(g);
  r := r || 'P2 republication=' || case when o1 = 'GD1=1,GD2=2,GD3=3|GC1=2,GC2=3,GC3=1,GC4=1|GS1=2,GS2=3,GS3=1|knowledge,clinical_skills,knowledge_application'
        and (select layout_draft is null from frameworks where id = g) then 'ok' else 'FAIL ' || o1 end || '; ';

  -- S1 a stale layout (a competency it names moved to another domain) refuses the publication whole.
  update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(gd3, gd2, gd1),
    'competencies', jsonb_build_object(gd1::text, jsonb_build_array(gc2, gc1, gc3))) where id = g;
  update framework_competencies set domain_id = gd2 where id = gc2;
  o1 := pg_temp.ord752(g);
  select version_revision into v0 from frameworks where id = g;
  r := r || 'K2 check_stale=' || case when framework_layout_check(g) like '%no longer in that domain%' then 'ok' else 'FAIL ' || coalesce(framework_layout_check(g), 'null') end || '; ';
  begin
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = g;
    r := r || 'S1=FAIL(accepted); ';
  exception when others then
    select version_revision into v1 from frameworks where id = g;
    r := r || case when sqlerrm like 'framework layout at publication: the pending layout is out of date, a competency it names is no longer in that domain%'
                    and pg_temp.ord752(g) = o1 and v1 = v0 and (select layout_draft is not null from frameworks where id = g)
               then 'S1 stale_moved=ok; ' else 'S1=FAIL(' || sqlerrm || '); ' end;
  end;
  update framework_competencies set domain_id = gd1 where id = gc2;

  -- S2 a stale layout (a criterion it names was deleted): refused, nothing applied in part (its domain list is valid).
  update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(gd3, gd2, gd1),
    'criteria', jsonb_build_object(gc1::text, jsonb_build_array(gs2, gs1))) where id = g;
  delete from competency_skills where id = gs2;
  o1 := pg_temp.ord752(g);
  begin
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = g;
    r := r || 'S2=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like '%out of date, a criterion it names is no longer of that competency%' and pg_temp.ord752(g) = o1
                    and (select layout_draft is not null and version_revision = v0 from frameworks where id = g)
               then 'S2 stale_deleted=ok; ' else 'S2=FAIL(' || sqlerrm || '); ' end;
  end;

  -- SR the app role (service_role): the check is callable and the publication applies the layout.
  update frameworks set layout_draft_by = p_author, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(gd2, gd1, gd3)) where id = g;
  begin
    set local role service_role;
    s := coalesce(framework_layout_check(g), 'null');
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = g;
    reset role;
    r := r || 'SR service_role=' || case when s = 'null' and pg_temp.ord752(g) like 'GD1=2,GD2=1,GD3=3|%' and (select layout_draft is null from frameworks where id = g)
               then 'ok' else 'FAIL ' || s || ' ' || pg_temp.ord752(g) end || '; ';
  exception when others then reset role; r := r || 'SR=FAIL(' || sqlerrm || '); ';
  end;

  -- F: a shared CFCA framework, published (inserted published while it owned nothing, so 466 let it in).
  insert into frameworks (name, library, competency_layer, pub_status, version_major, version_minor, version_revision)
  values ('PROBE 752 F', 'core', 'foundational', 'published', 1, 0, 0) returning id into f;
  insert into framework_domains (framework_id, name, sort_order) values (f, 'FD1', 1) returning id into fd1;
  insert into framework_domains (framework_id, name, sort_order) values (f, 'FD2', 2) returning id into fd2;
  insert into framework_competencies (domain_id, name, sort_order) values (fd1, 'FC1', 1) returning id into fc1;
  insert into framework_competencies (domain_id, name, sort_order) values (fd1, 'FC2', 2) returning id into fc2;
  update frameworks set layout_draft_by = p_publisher, layout_draft = jsonb_build_object('v', 1, 'domains', jsonb_build_array(fd2, fd1),
    'competencies', jsonb_build_object(fd1::text, jsonb_build_array(fc2, fc1))) where id = f;
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name)
  values (p_publisher, 'PROBE publisher', 'reorder_layout', 'framework', f, 'PROBE 752 F');
  o0 := pg_temp.ord752(f);

  -- R640 the reorderer publishing a revision: 640 refuses, the order, the version and the draft are unchanged.
  begin
    update frameworks set version_revision = version_revision + 1, published_by = p_publisher where id = f;
    r := r || 'R640=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like '%not independent. The publisher authored or curated%' and pg_temp.ord752(f) = o0
                    and (select layout_draft is not null and version_revision = 0 from frameworks where id = f)
               then 'R640 refused_kept=ok; ' else 'R640=FAIL(' || sqlerrm || '); ' end;
  end;

  -- R466 an app-shaped republication with unapproved competencies: 466 refuses, nothing applied.
  begin
    update frameworks set pub_status = 'published', version_revision = version_revision + 1, published_by = p_author where id = f;
    r := r || 'R466=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'cfca publication:%' and pg_temp.ord752(f) = o0
                    and (select layout_draft is not null and version_revision = 0 from frameworks where id = f)
               then 'R466 refused_kept=ok; ' else 'R466=FAIL(' || sqlerrm || '); ' end;
  end;

  -- A640 control: an independent publisher's revision passes 640, then the layout is applied and cleared.
  begin
    update frameworks set version_revision = version_revision + 1, published_by = p_author where id = f;
    r := r || 'A640 independent_applied=' || case when pg_temp.ord752(f) = 'FD1=2,FD2=1|FC1=2,FC2=1||null'
               and (select layout_draft is null and version_revision = 1 from frameworks where id = f) then 'ok' else 'FAIL ' || pg_temp.ord752(f) end || '; ';
  exception when others then r := r || 'A640=FAIL(' || sqlerrm || '); ';
  end;

  raise exception 'VERIFY %', r;
end
$probe$;
