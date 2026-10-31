-- ====================================================================================================
-- APPLY THIS FILE WHOLE. VERIFY-771: the structure of a published framework in its revision draft, exercised on STAGING
-- inside ONE transaction that ALWAYS ROLLS BACK (it ends by raising its results). A synthetic CFCA framework F, published,
-- with synthetic staging profiles and office as in VERIFY-770. STAGING ONLY.
-- ====================================================================================================

create function pg_temp.live771(f uuid) returns text language sql as $l$
  select md5((select fw.name || ':' || coalesce(fw.description, '') from frameworks fw where fw.id = f)
    || '|' || coalesce((select string_agg(d.id || ':' || d.name || ':' || coalesce(d.code, '') || ':' || coalesce(d.sort_order, 0) || ':' || coalesce(d.area_id::text, '-'), ',' order by d.id)
                from framework_domains d where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(p.id || ':' || p.domain_id || ':' || p.name || ':' || coalesce(p.code, '') || ':' || coalesce(p.description, ''), ',' order by p.id)
                from practices p join framework_domains d on d.id = p.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(u.id || ':' || u.practice_id || ':' || u.name || ':' || coalesce(u.code, '') || ':' || coalesce(u.risk_category, ''), ',' order by u.id)
                from clinical_practice_units u join practices p on p.id = u.practice_id join framework_domains d on d.id = p.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(c.id || ':' || c.name || ':' || c.domain_id || ':' || coalesce(c.practice_id::text, '-') || ':' || coalesce(c.cpu_id::text, '-'), ',' order by c.id)
                from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = f), '')
    || '|' || coalesce((select string_agg(s.id || ':' || s.competency_id || ':' || s.name || ':' || s.is_active, ',' order by s.id)
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
  f uuid; d1 uuid; d2 uuid; a1 uuid; c1 uuid; c2 uuid; s1 uuid; p1 uuid; u1 uuid; ut uuid;
  g uuid; gd uuid; ga uuid; gp uuid;
  nd uuid; np uuid; nu uuid; nc uuid; nc2 uuid; ncs uuid; nd2 uuid;
  ap uuid; ap2 uuid; ap3 uuid; rev uuid; v uuid; vn uuid; vn2 uuid; x uuid;
  live0 text; h1 text; h2 text; n_dom int; n_pr int; n_cpu int; n_comp int;
  s text; n int;
  r text := '';
begin
  -- ===== fixture: F, a shared CFCA framework, Area A1, domains D1 and D2, practice P1 with CPU U1, two competencies, =====
  -- ===== approved and published 1.0.0. G, another framework, with a domain, an Area and a practice of its own.       =====
  insert into frameworks (name, description, library, pub_status, competency_layer) values ('PROBE 771 F', 'F description', 'core', 'draft', 'foundational') returning id into f;
  insert into framework_areas (framework_id, name, sort_order) values (f, 'A1', 1) returning id into a1;
  insert into framework_domains (framework_id, name, code, sort_order, area_id) values (f, 'D1', 'PRB-D1', 1, a1) returning id into d1;
  insert into framework_domains (framework_id, name, code, sort_order) values (f, 'D2', 'PRB-D2', 2) returning id into d2;
  insert into practices (domain_id, name, code, sort_order) values (d1, 'P1', 'PRA-PRB-1', 1) returning id into p1;
  insert into clinical_practice_units (practice_id, name, code, risk_category) values (p1, 'U1 unit', 'CPU-PRB-1', 'standard') returning id into u1;
  insert into clinical_practice_units (practice_id, name, code, risk_category) values (p1, 'UT unit', 'CPU-PRB-T', 'standard') returning id into ut;
  insert into framework_competencies (domain_id, name, code, sort_order, learning_outcomes, risk_category)
    values (d1, 'C1 name', 'PRB-771-C1', 1, '["O1 text"]'::jsonb, 'standard') returning id into c1;
  insert into framework_competencies (domain_id, name, code, sort_order, learning_outcomes, risk_category)
    values (d2, 'C2 name', 'PRB-771-C2', 1, '[]'::jsonb, 'standard') returning id into c2;
  insert into competency_skills (competency_id, name, sort_order, component_code) values (c1, 'S1 knows', 1, 'knowledge') returning id into s1;
  insert into frameworks (name, library, pub_status, competency_layer) values ('PROBE 771 G', 'core', 'draft', 'foundational') returning id into g;
  insert into framework_areas (framework_id, name, sort_order) values (g, 'GA', 1) returning id into ga;
  insert into framework_domains (framework_id, name, sort_order) values (g, 'GD', 1) returning id into gd;
  insert into practices (domain_id, name, code, sort_order) values (gd, 'GP', 'PRA-PRB-G', 1) returning id into gp;
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
    values (v_office, p_reviewer, 'PROBE reviewer', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap, 'framework', f, p_owner);
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
    values (v_office, p_rev2, 'PROBE reviewer 2', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap2;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap2, 'framework', f, p_owner);
  for x in select unnest(array[c1, c2]) loop
    insert into clinical_content_version (competency_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot)
      values (x, 'competency', array[p_author], p_author, 'computed-by-trigger', '{}'::jsonb) returning id into v;
    insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (v, p_reviewer, ap, 'approved');
  end loop;
  update frameworks set pub_status = 'published', version_major = 1, version_minor = 0, version_revision = 0, published_by = p_publisher where id = f;
  live0 := pg_temp.live771(f);
  select count(*) into n_dom from framework_domains;
  select count(*) into n_pr from practices;
  select count(*) into n_cpu from clinical_practice_units;
  select count(*) into n_comp from framework_competencies;

  -- E1 the structure proposed in a revision: the framework label, a NEW domain ND in A1, a rename of D2, a NEW practice
  -- NP in ND, a NEW high risk CPU NU in NP, renames of P1 and U1, a NEW competency NC in ND naming NP and NU, and a NEW
  -- competency NC2 proposed in D1 then moved to ND within the revision. Audit rows as the server writes them.
  rev := framework_revision_open(f, p_author);
  nd := gen_random_uuid(); np := gen_random_uuid(); nu := gen_random_uuid(); nc := gen_random_uuid(); nc2 := gen_random_uuid(); ncs := gen_random_uuid();
  s := '';
  begin
    update framework_revision set framework_proposed = true, proposed_name = 'PROBE 771 F renamed', proposed_description = 'F new description' where id = rev;
    insert into framework_revision_domain (revision_id, domain_id, name, code, area_id, sort_order, created_by) values (rev, nd, 'ND new domain', 'PRB-ND', a1, 3, p_author);
    insert into framework_revision_domain (revision_id, domain_id, origin_domain_id, name, code, created_by) values (rev, d2, d2, 'D2 renamed', 'PRB-D2X', p_author);
    insert into framework_revision_practice (revision_id, practice_id, domain_id, name, description, code, created_by) values (rev, np, nd, 'NP new practice', 'np', 'PRA-PRB-N', p_author);
    insert into framework_revision_practice (revision_id, practice_id, origin_practice_id, name, description, code, created_by) values (rev, p1, p1, 'P1 renamed', 'p1 d', 'PRA-PRB-1', p_author);
    insert into framework_revision_cpu (revision_id, cpu_id, practice_id, name, code, risk_category, complexity, reassessment_months, created_by)
      values (rev, nu, np, 'NU new unit', 'CPU-PRB-N', 'high', 3, 6, p_author);
    insert into framework_revision_cpu (revision_id, cpu_id, origin_cpu_id, name, code, created_by) values (rev, u1, u1, 'U1 renamed', 'CPU-PRB-1', p_author);
    insert into framework_revision_competency (revision_id, competency_id, domain_id, sort_order, code, name, learning_outcomes, risk_category, practice_id, cpu_id, created_by)
      values (rev, nc, nd, 1, 'PRB-771-NC', 'NC new competency', '["N1 text"]'::jsonb, 'standard', np, nu, p_author);
    insert into framework_revision_criterion (revision_id, skill_id, competency_id, name, component_code, sort_order, created_by) values (rev, ncs, nc, 'NC criterion', 'clinical_skills', 1, p_author);
    insert into framework_revision_competency (revision_id, competency_id, domain_id, sort_order, code, name, learning_outcomes, risk_category, created_by)
      values (rev, nc2, d1, 2, 'PRB-771-NC2', 'NC2 new competency', '[]'::jsonb, 'standard', p_author);
    update framework_revision_competency set domain_id = nd, sort_order = 2 where revision_id = rev and competency_id = nc2;
  exception when others then s := 'FAIL(' || sqlerrm || ')';
  end;
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_id, entity_name) values
    (p_author, 'PROBE author', 'cfca_revision_framework_updated', 'framework', f, 'PROBE'),
    (p_author, 'PROBE author', 'cfca_revision_competency_created', 'framework_competency', nc, 'PROBE'),
    (p_author, 'PROBE author', 'cfca_revision_competency_created', 'framework_competency', nc2, 'PROBE'),
    (p_rev2, 'PROBE reviewer 2', 'cfca_revision_domain_created', 'framework', f, 'PROBE'),
    (p_rev2, 'PROBE reviewer 2', 'cfca_revision_cpu_renamed', 'framework', f, 'PROBE');
  r := r || 'E1 structure_proposed=' || case when s = '' and (select domain_id from framework_revision_competency where revision_id = rev and competency_id = nc2) = nd
             then 'ok' else s end || '; ';

  -- I1 invisible: every live row of F unchanged, the new ids absent, signed-in reads see none of the new tables.
  s := '';
  if pg_temp.live771(f) <> live0 then s := s || 'live_changed '; end if;
  if exists (select 1 from framework_domains where id = nd) or exists (select 1 from practices where id = np) or exists (select 1 from clinical_practice_units where id = nu)
     or exists (select 1 from framework_competencies where id in (nc, nc2)) then s := s || 'new_visible '; end if;
  begin
    set local role authenticated;
    select (select count(*) from framework_revision_domain) + (select count(*) from framework_revision_practice) + (select count(*) from framework_revision_cpu) into n;
    if n > 0 then s := s || 'rls_open '; end if;
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  r := r || 'I1 invisible_until_publish=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- G1 the schema refuses: a new domain with a live id, a rename of another framework domain, a foreign Area, a new
  -- practice in a foreign domain, a new CPU in a foreign practice, a competency naming a CPU that does not exist, a new
  -- domain withdrawn while competencies sit in it, an id rewritten, a label too short, a new competency moved to a
  -- foreign domain.
  s := '';
  begin insert into framework_revision_domain (revision_id, domain_id, name, sort_order, created_by) values (rev, d1, 'reuse', 9, p_author);
        s := s || 'live_id '; exception when others then if sqlerrm not like '%a new one takes a new id%' then s := s || 'live_id(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_domain (revision_id, domain_id, origin_domain_id, name, created_by) values (rev, gd, gd, 'foreign', p_author);
        s := s || 'foreign_rename '; exception when others then if sqlerrm not like '%not of the framework of this revision%' then s := s || 'foreign_rename(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_domain (revision_id, domain_id, name, area_id, sort_order, created_by) values (rev, gen_random_uuid(), 'foreign area', ga, 9, p_author);
        s := s || 'foreign_area '; exception when others then if sqlerrm not like '%Area must belong%' then s := s || 'foreign_area(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_practice (revision_id, practice_id, domain_id, name, code, created_by) values (rev, gen_random_uuid(), gd, 'foreign', 'PRA-X', p_author);
        s := s || 'foreign_practice '; exception when others then if sqlerrm not like '%placed in a domain of the framework%' then s := s || 'foreign_practice(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_cpu (revision_id, cpu_id, practice_id, name, code, risk_category, complexity, reassessment_months, created_by)
          values (rev, gen_random_uuid(), gp, 'foreign unit', 'CPU-X', 'low', 1, 12, p_author);
        s := s || 'foreign_cpu '; exception when others then if sqlerrm not like '%placed in a practice of the framework%' then s := s || 'foreign_cpu(' || sqlerrm || ') '; end if; end;
  begin insert into framework_revision_competency (revision_id, competency_id, domain_id, sort_order, name, cpu_id, created_by) values (rev, gen_random_uuid(), d1, 9, 'ghost cpu', gen_random_uuid(), p_author);
        s := s || 'ghost_cpu '; exception when others then if sqlerrm not like '%the CPU it names does not exist%' then s := s || 'ghost_cpu(' || sqlerrm || ') '; end if; end;
  begin delete from framework_revision_domain where revision_id = rev and domain_id = nd;
        s := s || 'withdraw_used '; exception when others then if sqlerrm not like '%placed under it%' then s := s || 'withdraw(' || sqlerrm || ') '; end if; end;
  begin update framework_revision_domain set domain_id = gen_random_uuid() where revision_id = rev and domain_id = nd;
        s := s || 'rewrite '; exception when others then if sqlerrm not like '%never changes%' then s := s || 'rewrite(' || sqlerrm || ') '; end if; end;
  begin update framework_revision set proposed_name = 'x' where id = rev;
        s := s || 'short_label '; exception when check_violation then null; end;
  begin update framework_revision_competency set domain_id = gd where revision_id = rev and competency_id = nc2;
        s := s || 'foreign_move '; exception when others then if sqlerrm not like '%in a domain of the framework of this revision%' then s := s || 'foreign_move(' || sqlerrm || ') '; end if; end;
  r := r || 'G1 schema_refusals=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- R1 the 640 floor reads the risk of a NEW CPU from the revision. Planted inside this rolled-back transaction: high
  -- risk needs 2 approvals. NC names the new high risk CPU NU, so its version needs 2. NC2 (no CPU) needs 1.
  create or replace function public.hq_sod_required_approvals(p_risk text) returns int language sql stable set search_path = public as $pl$ select case when p_risk = 'high' then 2 else 1 end $pl$;
  insert into clinical_content_version (proposed_competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot, required_approvals)
    values (nc, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb, 1) returning id into vn;
  insert into clinical_content_version (proposed_competency_id, revision_id, content_kind, authored_by, submitted_by, content_hash, content_snapshot, required_approvals)
    values (nc2, rev, 'competency', array[p_author], p_author, 'x', '{}'::jsonb, 1) returning id into vn2;
  r := r || 'R1 new_cpu_risk_floor=' || case when (select required_approvals from clinical_content_version where id = vn) = 2
             and (select required_approvals from clinical_content_version where id = vn2) = 1 then 'ok' else 'FAIL' end || '; ';

  -- R2 a new competency in a NEW domain is in scope for a framework scope, and out of scope for a scope of D1 only.
  insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, authorised_by, authorised_at)
    values (v_office, p_reviewer, 'PROBE reviewer D1', 'clinical_content_reviewer', 'active', current_date, p_owner, now()) returning id into ap3;
  insert into clinical_reviewer_scope (appointment_id, scope_kind, scope_ref, granted_by) values (ap3, 'domain', d1, p_owner);
  s := '';
  begin insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn, p_reviewer, ap3, 'approved');
        s := s || 'domain_scope_accepted '; exception when others then if sqlerrm not like '%out of scope%' then s := s || 'd1(' || sqlerrm || ') '; end if; end;
  begin insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn, p_reviewer, ap, 'approved');
  exception when others then s := s || 'framework_scope(' || sqlerrm || ') '; end;
  r := r || 'R2 new_domain_scope=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- R3 organisational, not authorship: reviewer 2 created a domain and renamed a CPU in the revision (audit on F), and may
  -- still approve the new competencies.
  s := '';
  begin insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn, p_rev2, ap2, 'approved');
  exception when others then s := s || 'nc(' || sqlerrm || ') '; end;
  r := r || 'R3 organisational_not_authorship=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- P1 refused publication applies nothing: NC2 is not approved yet, so the 466 predicate refuses the statement, and the
  -- label, the new domain, practice and CPU and the renames are all undone with it.
  begin
    update frameworks set pub_status = 'published', version_revision = 1, published_by = p_publisher where id = f;
    r := r || 'P1=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'cfca publication: 1 of 4 competencies%' and pg_temp.live771(f) = live0
                    and (select status from framework_revision where id = rev) = 'open'
                    and not exists (select 1 from framework_domains where id = nd) and (select version_revision from frameworks where id = f) = 0
               then 'P1 refused_applies_nothing=ok; ' else 'P1=FAIL(' || sqlerrm || '); ' end;
  end;
  insert into clinical_review_decision (version_id, reviewer_id, appointment_id, decision) values (vn2, p_reviewer, ap, 'approved');
  h1 := framework_revision_competency_hash(rev, nc);
  h2 := framework_revision_competency_hash(rev, nc2);

  -- P2 contribution: whoever made an organisational revision change cannot publish it (640 unchanged). Nothing applied.
  begin
    update frameworks set pub_status = 'published', version_revision = 1, published_by = p_rev2 where id = f;
    r := r || 'P2=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like '%authored or curated%' and pg_temp.live771(f) = live0 and (select status from framework_revision where id = rev) = 'open'
               then 'P2 organisational_is_contribution=ok; ' else 'P2=FAIL(' || sqlerrm || '); ' end;
  end;

  -- P3 the publication as the app role: everything applied in the one statement, with the pre-allocated ids, parents
  -- before children, renames by id, nothing deleted, the reviewed hashes, the revision published at 1.0.1.
  begin
    set local role service_role;
    update frameworks set pub_status = 'published', version_revision = 1, published_by = p_publisher where id = f;
    reset role;
    s := '';
    if (select name || '|' || coalesce(description, '') from frameworks where id = f) <> 'PROBE 771 F renamed|F new description' then s := s || 'label '; end if;
    if (select name || '|' || code || '|' || area_id || '|' || sort_order from framework_domains where id = nd and framework_id = f) is distinct from 'ND new domain|PRB-ND|' || a1 || '|3' then s := s || 'new_domain '; end if;
    if (select name || '|' || code from framework_domains where id = d2) <> 'D2 renamed|PRB-D2X' then s := s || 'rename_domain '; end if;
    if (select domain_id from practices where id = np) is distinct from nd or (select name || '|' || description from practices where id = p1) <> 'P1 renamed|p1 d' then s := s || 'practices '; end if;
    if (select practice_id || '|' || risk_category || '|' || complexity || '|' || reassessment_months || '|' || pub_status from clinical_practice_units where id = nu) is distinct from np || '|high|3|6|draft'
       or (select name from clinical_practice_units where id = u1) <> 'U1 renamed' then s := s || 'cpus '; end if;
    if (select domain_id || '|' || practice_id || '|' || cpu_id from framework_competencies where id = nc) is distinct from nd || '|' || np || '|' || nu
       or (select domain_id from framework_competencies where id = nc2) is distinct from nd then s := s || 'competencies '; end if;
    if competency_content_hash(nc) is distinct from h1 or competency_content_hash(nc2) is distinct from h2 then s := s || 'hash '; end if;
    if not (competency_clinically_approved(nc) and competency_clinically_approved(nc2) and competency_clinically_approved(c1) and competency_clinically_approved(c2)) then s := s || 'approval '; end if;
    if (select count(*) from framework_domains) <> n_dom + 1 or (select count(*) from practices) <> n_pr + 1 or (select count(*) from clinical_practice_units) <> n_cpu + 1
       or (select count(*) from framework_competencies) <> n_comp + 2 then s := s || 'counts '; end if;
    if (select domain_id from framework_competencies where id = c1) <> d1 or (select practice_id from clinical_practice_units where id = u1) <> p1 then s := s || 'ids '; end if;
    if (select status || ' ' || released_version from framework_revision where id = rev) <> 'published 1.0.1' then s := s || 'released '; end if;
    r := r || 'P3 applied_at_publication=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';
  exception when others then reset role; r := r || 'P3=FAIL(' || sqlerrm || '); ';
  end;

  -- K1 a closed revision keeps its structure rows: no edit, no label change.
  s := '';
  begin update framework_revision_domain set name = 'after' where revision_id = rev and domain_id = nd;
        s := s || 'closed_domain_edit '; exception when others then if sqlerrm not like '%not open%' then s := s || 'cd(' || sqlerrm || ') '; end if; end;
  begin update framework_revision set proposed_name = 'After publication' where id = rev;
        s := s || 'closed_label_edit '; exception when others then if sqlerrm not like '%closed%' and sqlerrm not like '%only while the revision is open%' then s := s || 'cl(' || sqlerrm || ') '; end if; end;
  r := r || 'K1 closed_revision_immutable=' || case when s = '' then 'ok' else 'FAIL ' || s end || '; ';

  -- S1 a new domain whose id was taken live after the revision started refuses the publication, nothing applied.
  rev := framework_revision_open(f, p_author);
  nd2 := gen_random_uuid();
  insert into framework_revision_domain (revision_id, domain_id, name, sort_order, created_by) values (rev, nd2, 'ND2', 9, p_author);
  update framework_revision set framework_proposed = true, proposed_name = 'PROBE 771 F second', proposed_description = null where id = rev;
  insert into framework_domains (id, framework_id, name, sort_order) values (nd2, f, 'ND2 taken live', 8);
  live0 := pg_temp.live771(f);
  begin
    update frameworks set pub_status = 'published', version_revision = 2, published_by = p_publisher where id = f;
    r := r || 'S1=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'framework revision at publication: the revision can no longer be applied, a new domain has lost its id%'
                    and pg_temp.live771(f) = live0 and (select status from framework_revision where id = rev) = 'open'
               then 'S1 lost_id_refused=ok; ' else 'S1=FAIL(' || sqlerrm || '); ' end;
  end;

  -- S2 a competency of the revision naming a live CPU deleted after the revision started refuses the publication.
  delete from framework_domains where id = nd2;
  delete from framework_revision_domain where revision_id = rev and domain_id = nd2;
  perform framework_revision_add_competency(rev, c2, p_author);
  update framework_revision_competency set cpu_id = ut, practice_id = p1 where revision_id = rev and competency_id = c2;
  delete from clinical_practice_units where id = ut;
  live0 := pg_temp.live771(f);
  begin
    update frameworks set pub_status = 'published', version_revision = 2, published_by = p_publisher where id = f;
    r := r || 'S2=FAIL(accepted); ';
  exception when others then
    r := r || case when sqlerrm like 'framework revision at publication: the revision can no longer be applied, the practice or CPU that PRB-771-C2 names no longer exists%'
                    and pg_temp.live771(f) = live0 and (select status from framework_revision where id = rev) = 'open'
               then 'S2 lost_cpu_refused=ok; ' else 'S2=FAIL(' || sqlerrm || '); ' end;
  end;

  -- D1 discard: the label and the structure rows are dropped with the revision, live untouched.
  update framework_revision set status = 'discarded', closed_by = p_author where id = rev;
  r := r || 'D1 discard_live_untouched=' || case when pg_temp.live771(f) = live0 and (select name from frameworks where id = f) = 'PROBE 771 F renamed' then 'ok' else 'FAIL' end || '; ';

  raise exception 'VERIFY-771 RESULT: %', r;
end
$probe$;
