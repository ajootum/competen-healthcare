-- ====================================================================================================
-- APPLY THIS FILE WHOLE. VERIFY-770: revision drafts exercised on STAGING inside ONE transaction that ALWAYS ROLLS
-- BACK (it ends by raising its results). A synthetic CFCA framework, plus the published CF-FOUND and NUR-RESP rows read
-- through revisions that are rolled back. Synthetic staging profiles and office as in VERIFY-750-751. STAGING ONLY.
-- ====================================================================================================

create function pg_temp.live770(f uuid) returns text language sql as $l$
  select md5(coalesce((select string_agg(c.id || ':' || c.name || ':' || coalesce(c.code, '') || ':' || c.learning_outcomes::text || ':' || c.learning_outcome_ids::text
                  || ':' || coalesce(c.risk_category, '') || ':' || c.domain_id || ':' || coalesce(c.sort_order, 0), ',' order by c.id)
                from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(s.id || ':' || s.competency_id || ':' || s.name || ':' || coalesce(s.component_code, '') || ':' || s.sort_order || ':' || s.is_active, ',' order by s.id)
                from competency_skills s join framework_competencies c on c.id = s.competency_id join framework_domains d on d.id = c.domain_id where d.framework_id = f), ''))
$l$;

do $probe$
declare
  p_author uuid := '6a59fe42-a9aa-4723-8dfd-a16b74626ac7';
  p_publisher uuid := '667cf735-faf6-4010-93a0-589e8c753467';
  p_reviewer uuid := '89572381-0509-4fd6-b7d7-9188e5b9df01';
  p_owner uuid := '804ee8e5-ad1f-4e89-a8f0-9d087fcda1dc';
  p_rev2 uuid := 'df8503a0-7886-4a3f-a865-71c4f330ec55';
  v_office uuid := '60f0fc0c-5288-4ae3-a1b2-a3a12291311e';
  f uuid; d1 uuid; d2 uuid; c1 uuid; c2 uuid; c3 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; snew uuid; nc uuid; ncs uuid;
  g uuid; gd uuid;
  ap uuid; ap2 uuid; ap3 uuid; rev uuid; rev2 uuid; v uuid; v1 uuid; v2 uuid; vn uuid; x uuid;
  live0 text; h1 text; h2 text; ids0 jsonb; n_skills int; n_versions int; n_fwv int; ev0 text; rq0 text;
  s text; n int;
  r text := '';
begin
  select md5(coalesce(string_agg(e.id::text || ':' || e.outcome_ids::text, ',' order by e.id), '')) into ev0 from competency_verification_evidence e;
  select md5(coalesce(string_agg(q.id::text || ':' || q.outcome_ids::text, ',' order by q.id), '')) into rq0 from competency_verification_request q;
  select count(*) into n_fwv from framework_versions;

  -- ===== fixture: F, a shared CFCA framework, two domains, three competencies, approved and published 1.0.0 =====
  insert into frameworks (name, library, pub_status, competency_layer) values ('PROBE 770 F', 'core', 'draft', 'foundational') returning id into f;
  insert into framework_domains (framework_id, name, sort_order) values (f, 'D1', 1) returning id into d1;
  insert into framework_domains (framework_id, name, sort_order) values (f, 'D2', 2) returning id into d2;
  insert into framework_competencies (domain_id, name, code, sort_order, learning_outcomes, risk_category)
    values (d1, 'C1 name', 'PRB-770-C1', 1, '["O1 text", "O2 text"]'::jsonb, 'standard') returning id into c1;
  insert into framework_competencies (domain_id, name, code, sort_order, learning_outcomes, risk_category)
    values (d1, 'C2 name', 'PRB-770-C2', 2, '["P1 text"]'::jsonb, 'standard') returning id into c2;
  insert into framework_competencies (domain_id, name, code, sort_order, learning_outcomes, risk_category)
    values (d2, 'C3 name', 'PRB-770-C3', 1, '[]'::jsonb, 'standard') returning id into c3;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (c1, 'S1 knows', 1, 'knowledge') returning id into s1;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (c1, 'S2 does', 2, 'clinical_skills') returning id into s2;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (c2, 'S3 applies', 1, 'knowledge_application') returning id into s3;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (c3, 'S4 other', 1, 'knowledge') returning id into s4;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
    values (v_office, p_reviewer, 'PROBE reviewer', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap, 'framework', f, p_owner);
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name) values (p_author, 'PROBE author', 'cfca_competency_created', 'framework_competency', c1, 'PROBE');
  for x in select unnest(array[c1, c2, c3]) loop
    insert into clinical_content_version (competency_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
      values (x, 'competency', array[p_author], p_author, 'computed-by-trigger', '{}'::jsonb) returning id into v;
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v, p_reviewer, ap, 'approved');
  end loop;
  update frameworks set pub_status = 'published', version_major = 1, version_minor = 0, version_revision = 0, published_by = p_publisher where id = f;
  live0 := pg_temp.live770(f);
  select learning_outcome_ids into ids0 from framework_competencies where id = c1;
  select count(*) into n_skills from competency_skills;

  -- O1 a revision opens once per framework, only on a published CFCA framework.
  rev := framework_revision_open(f, p_author);
  s := '';
  if framework_revision_open(f, p_author) is distinct from rev then s := s || 'second_open '; end if;
  begin insert into framework_revision (framework_id, created_by) values (f, p_author); s := s || 'two_open_accepted '; exception when unique_violation then null; end;
  insert into frameworks (name, library, pub_status, competency_layer) values ('PROBE 770 G', 'core', 'draft', 'foundational') returning id into g;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD', 1) returning id into gd;
  begin perform framework_revision_open(g, p_author); s := s || 'draft_accepted '; exception when others then if sqlerrm not like '%only on a shared, centrally governed, published framework%' then s := s || 'draft(' || sqlerrm || ') '; end if; end;
  r := r || 'O1 one_open_published_only=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- H1 a copy hashes exactly as its live competency: the fixture, and every competency of the published CF-FOUND and
  -- NUR-RESP, with its snapshot equal to the 761 snapshot.
  perform framework_revision_add_competency(rev, c1, p_author);
  perform framework_revision_add_competency(rev, c2, p_author);
  if framework_revision_add_competency(rev, c1, p_author) is null then r := r || 'H1 readd=FAIL; '; end if;
  n := 0;
  for x in select c.id from framework_competencies c join framework_domains d on d.id = c.domain_id join frameworks fw on fw.id = d.framework_id
            where fw.code in ('CF-FOUND', 'NUR-RESP') and fw.hospital_id is null and fw.pub_status = 'published' loop
    rev2 := framework_revision_open((select d.framework_id from framework_competencies c join framework_domains d on d.id = c.domain_id where c.id = x), p_author);
    perform framework_revision_add_competency(rev2, x, p_author);
    if framework_revision_competency_hash(rev2, x) is distinct from competency_content_hash(x)
       or framework_revision_competency_snapshot(rev2, x) is distinct from (select jsonb_build_object('name', c.name, 'description', c.description, 'learning_outcomes', c.learning_outcomes,
            'expected_level_id', c.expected_level_id, 'practice_id', c.practice_id, 'cpu_id', c.cpu_id, 'risk_category', c.risk_category,
            'skills', coalesce((select jsonb_agg(k.name order by k.name, k.id) from competency_skills k where k.competency_id = c.id and k.is_active is not false), '[]'::jsonb))
            from framework_competencies c where c.id = x) then
      n := n - 1000;
    end if;
    n := n + 1;
  end loop;
  r := r || 'H1 copy_hash_equal=' || case when n >= 13 and framework_revision_competency_hash(rev, c1) = competency_content_hash(c1)
        and framework_revision_competency_hash(rev, c2) = competency_content_hash(c2) then 'ok (' || n || ' published + 2)' else 'FAIL ' || n end || '; ';

  -- E1 edits in the revision: C1 name and outcome order, a criterion reworded, one retired, one new, S3 moved from C2 to C1,
  -- and a NEW competency NC with a new criterion in D2. Authorship rows as the server writes them, on the stable ids.
  update framework_revision_competency set name = 'C1 name revised', learning_outcomes = '["O2 text", "O1 text"]'::jsonb, updated_by = p_author
   where revision_id = rev and competency_id = c1;
  update framework_revision_criterion set name = 'S1 knows well' where revision_id = rev and skill_id = s1;
  h1 := framework_revision_competency_hash(rev, c1);
  update framework_revision_criterion set is_active = false where revision_id = rev and skill_id = s2;
  r := r || 'E1 retire_changes_hash=' || case when framework_revision_competency_hash(rev, c1) <> h1 then 'ok' else 'FAIL' end || '; ';
  update framework_revision_criterion set is_active = true where revision_id = rev and skill_id = s2;
  r := r || 'E1b restore_returns_hash=' || case when framework_revision_competency_hash(rev, c1) = h1 then 'ok' else 'FAIL' end || '; ';
  update framework_revision_criterion set is_active = false where revision_id = rev and skill_id = s2;
  snew := gen_random_uuid();
  insert into framework_revision_criterion (revision_id, skill_id, competency_id, name, component_code, sort_order, created_by)
    values (rev, snew, c1, 'S new criterion', 'knowledge', 3, p_author);
  update framework_revision_criterion set competency_id = c1, sort_order = 4 where revision_id = rev and skill_id = s3;
  nc := gen_random_uuid(); ncs := gen_random_uuid();
  insert into framework_revision_competency (revision_id, competency_id, domain_id, sort_order, code, name, learning_outcomes, risk_category, created_by)
    values (rev, nc, d2, 2, 'PRB-770-NC', 'NC new competency', '["N1 text"]'::jsonb, 'standard', p_author);
  insert into framework_revision_criterion (revision_id, skill_id, competency_id, name, component_code, sort_order, created_by)
    values (rev, ncs, nc, 'NC criterion', 'clinical_skills', 1, p_author);
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name) values
    (p_author, 'PROBE author', 'cfca_revision_competency_updated', 'framework_competency', c1, 'PROBE'),
    (p_author, 'PROBE author', 'cfca_revision_criterion_moved', 'framework_competency', c2, 'PROBE'),
    (p_author, 'PROBE author', 'cfca_revision_competency_created', 'framework_competency', nc, 'PROBE');

  -- I1 invisible: every live row of F unchanged, the live approvals still current, and signed-in reads see no revision.
  s := '';
  if pg_temp.live770(f) <> live0 then s := s || 'live_changed '; end if;
  if not (competency_clinically_approved(c1) and competency_clinically_approved(c2)) then s := s || 'approval_lost '; end if;
  if exists (select 1 from framework_competencies where id = nc) or exists (select 1 from competency_skills where id in (snew, ncs)) then s := s || 'new_visible '; end if;
  begin
    set local role authenticated;
    select count(*) into n from framework_revision_competency;
    if n > 0 then s := s || 'rls_open '; end if;
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  r := r || 'I1 revision_invisible=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- G1 the schema refuses: a new competency with a live id, a new one in another framework domain, a live criterion of a
  -- competency not in the revision, a published competency or criterion deleted from the revision, an id rewritten.
  s := '';
  begin insert into framework_revision_competency (revision_id, competency_id, domain_id, sort_order, name, created_by) values (rev, c3, d2, 3, 'reuse', p_author);
        s := s || 'live_id_accepted '; exception when others then if sqlerrm not like '%a new competency takes a new id%' then s := s || 'live_id(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_competency (revision_id, competency_id, domain_id, sort_order, name, created_by) values (rev, gen_random_uuid(), gd, 1, 'foreign', p_author);
        s := s || 'foreign_domain_accepted '; exception when others then if sqlerrm not like '%in a domain of the framework of this revision%' then s := s || 'foreign_domain(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_criterion (revision_id, skill_id, origin_skill_id, competency_id, name, created_by) values (rev, s4, s4, c1, 'steal', p_author);
        s := s || 'orphan_criterion_accepted '; exception when others then if sqlerrm not like '%only with its own competency%' then s := s || 'orphan(' || sqlerrm || ') '; end if; end;
  begin delete from framework_revision_competency where revision_id = rev and competency_id = c2;
        s := s || 'delete_published_accepted '; exception when others then if sqlerrm not like '%stays in its revision%' then s := s || 'del_comp(' || sqlerrm || ') '; end if; end;
  begin delete from framework_revision_criterion where revision_id = rev and skill_id = s2;
        s := s || 'delete_criterion_accepted '; exception when others then if sqlerrm not like '%never removed. Retire it%' then s := s || 'del_crit(' || sqlerrm || ') '; end if; end;
  begin update framework_revision_criterion set skill_id = gen_random_uuid() where revision_id = rev and skill_id = s1;
        s := s || 'id_rewrite_accepted '; exception when others then if sqlerrm not like '%never changes%' then s := s || 'rewrite(' || sqlerrm || ') '; end if; end;
  begin update framework_revision set status = 'applying' where id = rev;
        s := s || 'applying_accepted '; exception when others then if sqlerrm not like '%published only by publishing its framework%' then s := s || 'applying(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_criterion (revision_id, skill_id, competency_id, name, created_by) values (rev, gen_random_uuid(), c3, 'not in revision', p_author);
        s := s || 'fk_accepted '; exception when foreign_key_violation then null; end;
  r := r || 'G1 schema_refusals=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- V1 review of the PROPOSED content against the stable ids: the database computes the proposed hash and snapshot.
  insert into clinical_content_version (competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
    values (c1, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb) returning id into v1;
  insert into clinical_content_version (competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
    values (c2, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb) returning id into v2;
  insert into clinical_content_version (proposed_competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
    values (nc, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb) returning id into vn;
  r := r || 'V1 proposed_versions=' || case when
        (select content_hash = framework_revision_competency_hash(rev, c1) and content_hash <> competency_content_hash(c1) and competency_id = c1
                and content_snapshot ->> 'name' = 'C1 name revised' and jsonb_array_length(content_snapshot -> 'skills') = 3 from clinical_content_version where id = v1)
        and (select competency_id is null and proposed_competency_id = nc and content_hash = framework_revision_competency_hash(rev, nc) from clinical_content_version where id = vn)
        then 'ok' else 'FAIL' end || '; ';

  -- V2 independence: the revision author cannot approve (authored_by), nor can a reviewer who only made a revision change
  -- (audit trail, by the stable id, new competency included).
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
    values (v_office, p_rev2, 'PROBE reviewer 2', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap2;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap2, 'framework', f, p_owner);
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name) values
    (p_rev2, 'PROBE reviewer 2', 'cfca_revision_criterion_updated', 'framework_competency', c1, 'PROBE'),
    (p_rev2, 'PROBE reviewer 2', 'cfca_revision_criterion_created', 'framework_competency', nc, 'PROBE');
  s := '';
  begin insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v1, p_author, ap, 'approved');
        s := s || 'author_accepted '; exception when others then if sqlerrm not like '%not independent%' then s := s || 'author(' || sqlerrm || ') '; end if; end;
  begin insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v1, p_rev2, ap2, 'approved');
        s := s || 'revision_editor_accepted '; exception when others then if sqlerrm not like '%not independent. The reviewer authored%' then s := s || 'editor(' || sqlerrm || ') '; end if; end;
  begin insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn, p_rev2, ap2, 'approved');
        s := s || 'new_editor_accepted '; exception when others then if sqlerrm not like '%not independent. The reviewer authored%' then s := s || 'new_editor(' || sqlerrm || ') '; end if; end;
  r := r || 'V2 revision_author_cannot_approve=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- V3 scope of a new competency is its proposed domain: an appointment scoped to D1 only cannot decide NC (in D2).
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
    values (v_office, p_reviewer, 'PROBE reviewer D1', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap3;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap3, 'domain', d1, p_owner);
  begin
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn, p_reviewer, ap3, 'approved');
    r := r || 'V3=FAIL(accepted); ';
  exception when others then r := r || case when sqlerrm like '%out of scope%' then 'V3 new_competency_scope=ok; ' else 'V3=FAIL(' || sqlerrm || '); ' end;
  end;

  -- V4 approval of the exact proposal: accepted while current. After a further edit the version is stale and refused.
  insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v1, p_reviewer, ap, 'approved');
  update framework_revision_competency set description = 'later edit' where revision_id = rev and competency_id = c2;
  begin
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v2, p_reviewer, ap, 'approved');
    r := r || 'V4=FAIL(stale accepted); ';
  exception when others then r := r || case when sqlerrm like '%stale%' then 'V4 stale_proposal_refused=ok; ' else 'V4=FAIL(' || sqlerrm || '); ' end;
  end;

  -- P1 refused publication applies nothing: C2 and NC are not yet approved at their proposed content, so 466 refuses the
  -- statement (it judges the applied content) and every revision write is undone with it.
  begin
    update frameworks set pub_status = 'published', version_revision = 1, published_by = p_publisher where id = f;
    r := r || 'P1=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'cfca publication: 2 of 4 competencies%' and pg_temp.live770(f) = live0
                    and (select status from framework_revision where id = rev) = 'open'
                    and (select competency_id is null from clinical_content_version where id = vn)
                    and (select version_revision from frameworks where id = f) = 0
               then 'P1 refused_applies_nothing=ok; ' else 'P1=FAIL(' || sqlerrm || '); ' end;
  end;

  -- Approve C2 (a new version of its current proposal) and NC.
  insert into clinical_content_version (competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
    values (c2, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb) returning id into v2;
  insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v2, p_reviewer, ap, 'approved');
  insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn, p_reviewer, ap, 'approved');
  h1 := framework_revision_competency_hash(rev, c1);
  h2 := framework_revision_competency_hash(rev, nc);

  -- P2 publisher independence covers the revision: its author cannot publish, nor can a publisher who only authored the
  -- NEW competency (640, unchanged, sees it because the apply runs first). Nothing applied either time.
  s := '';
  begin update frameworks set pub_status = 'published', version_revision = 1, published_by = p_author where id = f;
        s := s || 'author_published '; exception when others then if sqlerrm not like '%authored or curated%' then s := s || 'author(' || sqlerrm || ') '; end if; end;
  begin
    insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name) values (p_publisher, 'PROBE publisher', 'cfca_revision_criterion_created', 'framework_competency', nc, 'PROBE');
    update frameworks set pub_status = 'published', version_revision = 1, published_by = p_publisher where id = f;
    s := s || 'new_author_published ';
  exception when others then if sqlerrm not like '%authored or curated%' then s := s || 'new_author(' || sqlerrm || ') '; end if; end;
  r := r || 'P2 publisher_independent=' || case when s = '' and pg_temp.live770(f) = live0 and (select status from framework_revision where id = rev) = 'open' then 'ok' else 'FAIL ' || s end || '; ';

  -- P3 the publication as the app role: applied in the statement, live hashes are the approved proposed hashes (466
  -- passed on them), ids stable, nothing deleted, the new competency bound, the revision published at 1.0.1.
  begin
    set local role service_role;
    update frameworks set pub_status = 'published', version_revision = 1, published_by = p_publisher where id = f;
    reset role;
    s := '';
    if competency_content_hash(c1) is distinct from h1 or competency_content_hash(nc) is distinct from h2 then s := s || 'hash '; end if;
    if not (competency_clinically_approved(c1) and competency_clinically_approved(c2) and competency_clinically_approved(nc) and competency_clinically_approved(c3)) then s := s || 'approval '; end if;
    if (select name from framework_competencies where id = c1) <> 'C1 name revised' then s := s || 'c1 '; end if;
    if (select competency_id from competency_skills where id = s3) <> c1 then s := s || 'move '; end if;
    if (select is_active from competency_skills where id = s2) is not false then s := s || 'retire '; end if;
    if (select domain_id from framework_competencies where id = nc) <> d2 or not exists (select 1 from competency_skills where id = ncs and competency_id = nc)
       or not exists (select 1 from competency_skills where id = snew and competency_id = c1) then s := s || 'new_ids '; end if;
    if (select count(*) from competency_skills) <> n_skills + 2 then s := s || 'count '; end if;
    if (select competency_id from clinical_content_version where id = vn) is distinct from nc then s := s || 'bind '; end if;
    if (select learning_outcome_ids from framework_competencies where id = c1) <> jsonb_build_array(ids0 -> 1, ids0 -> 0) then s := s || 'outcome_ids '; end if;
    if (select status || ' ' || released_version || ' ' || closed_by from framework_revision where id = rev) <> 'published 1.0.1 ' || p_publisher then s := s || 'released '; end if;
    if (select version_revision from frameworks where id = f) <> 1 then s := s || 'version '; end if;
    r := r || 'P3 applied_atomically=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';
  exception when others then reset role; r := r || 'P3=FAIL(' || sqlerrm || '); ';
  end;

  -- K1 history kept: evidence and request outcome ids, framework_versions untouched, closed revision immutable.
  s := '';
  if (select md5(coalesce(string_agg(e.id::text || ':' || e.outcome_ids::text, ',' order by e.id), '')) from competency_verification_evidence e) <> ev0 then s := s || 'evidence '; end if;
  if (select md5(coalesce(string_agg(q.id::text || ':' || q.outcome_ids::text, ',' order by q.id), '')) from competency_verification_request q) <> rq0 then s := s || 'requests '; end if;
  if (select count(*) from framework_versions) <> n_fwv then s := s || 'fw_versions '; end if;
  begin update framework_revision_competency set name = 'after' where revision_id = rev and competency_id = c1;
        s := s || 'closed_edit_accepted '; exception when others then if sqlerrm not like '%not open%' then s := s || 'closed(' || sqlerrm || ') '; end if; end;
  begin update clinical_content_version set competency_id = c1 where id = vn;
        s := s || 'version_update_accepted '; exception when others then if sqlerrm not like '%append-only%' then s := s || 'ccv(' || sqlerrm || ') '; end if; end;
  r := r || 'K1 history_kept=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- D1 discard leaves live untouched, and nothing can be put forward or edited on it after.
  live0 := pg_temp.live770(f);
  rev := framework_revision_open(f, p_author);
  perform framework_revision_add_competency(rev, c3, p_author);
  update framework_revision_competency set name = 'C3 discarded' where revision_id = rev and competency_id = c3;
  update framework_revision set status = 'discarded', closed_by = p_author where id = rev;
  s := '';
  if pg_temp.live770(f) <> live0 then s := s || 'live_changed '; end if;
  begin insert into clinical_content_version (competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
          values (c3, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb);
        s := s || 'version_on_discarded '; exception when others then if sqlerrm not like '%only while it is open%' then s := s || 'v(' || sqlerrm || ') '; end if; end;
  begin update framework_revision_competency set name = 'again' where revision_id = rev and competency_id = c3;
        s := s || 'edit_discarded '; exception when others then if sqlerrm not like '%not open%' then s := s || 'e(' || sqlerrm || ') '; end if; end;
  begin update framework_revision set status = 'open' where id = rev;
        s := s || 'reopened '; exception when others then if sqlerrm not like '%closed%' then s := s || 'o(' || sqlerrm || ') '; end if; end;
  r := r || 'D1 discard_live_untouched=' || case when s = '' and (select closed_at is not null from framework_revision where id = rev) then 'ok' else 'FAIL ' || s end || '; ';

  -- S1 a revision whose published content changed live after it started refuses the publication, nothing applied.
  rev := framework_revision_open(f, p_author);
  perform framework_revision_add_competency(rev, c3, p_author);
  update framework_revision_competency set name = 'C3 revised' where revision_id = rev and competency_id = c3;
  update framework_competencies set description = 'live edit' where id = c3;
  live0 := pg_temp.live770(f);
  begin
    update frameworks set pub_status = 'published', version_revision = 2, published_by = p_publisher where id = f;
    r := r || 'S1=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'framework revision at publication: the revision can no longer be applied, the published content of PRB-770-C3 changed%'
                    and pg_temp.live770(f) = live0 and (select status from framework_revision where id = rev) = 'open'
               then 'S1 stale_revision_refused=ok; ' else 'S1=FAIL(' || sqlerrm || '); ' end;
  end;

  -- T1 a revision is never committed applying: a BEFORE trigger that skips the row leaves it applying, and the deferred
  -- check refuses it.
  update framework_competencies set description = null where id = c3;
  create function public.probe770_skip() returns trigger language plpgsql as $sk$ begin return null; end $sk$;
  create trigger zz_probe770_skip before update of version_revision on frameworks for each row execute function public.probe770_skip();
  begin
    update framework_revision_competency set description = null where revision_id = rev and competency_id = c3;
    insert into clinical_content_version (competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
      values (c3, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb) returning id into v;
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v, p_reviewer, ap, 'approved');
    update frameworks set pub_status = 'published', version_revision = 2, published_by = p_publisher where id = f;
    s := (select status from framework_revision where id = rev);
    set constraints framework_revision_settled immediate;
    r := r || 'T1=FAIL(committed ' || s || '); ';
  exception when others then
    r := r || case when sqlerrm like 'framework revision: it was applied but its framework was not published%' then 'T1 never_left_applying=ok; ' else 'T1=FAIL(' || sqlerrm || '); ' end;
  end;
  drop trigger zz_probe770_skip on frameworks;
  drop function public.probe770_skip();

  raise exception 'VERIFY-770 RESULT: %', r;
end
$probe$;
