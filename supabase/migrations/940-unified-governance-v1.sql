-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 940: COMPETEN HOLDINGS UNIFIED GOVERNANCE V1 (HOLDINGS-UNIFIED-GOVERNANCE-V1)
--
-- Owner spec and GO, 3 Nov 2026 ("Unified Governance V1, Approved Design and Implementation GO"). Three
-- data-model gaps, nothing else: the rest of the spec is configuration and interface consolidation over
-- the existing HQ infrastructure (264, 500, 640, 641, 890). Staging first. Production is applied by the
-- owner by hand on a separate GO. Build record: docs/evidence/UNIFIED-GOVERNANCE-V1/940-build-record.md.
--
-- DEPENDS ON 264 (hq_position, hq_capability, hq_position_capability), 040 (audit_log), 500
-- (hq_actor_is_owner, hq_position_capability_guard), 640 (hq_sod_required_approvals, hq_capability_exclusions),
-- 641 (hq_position rules columns), 890 (the checklist definition tables and asmt_version_lifecycle_guard).
-- APPLY AFTER 930. Re-running it is a no-op. It appoints NOBODY, ends NO grant and changes NO existing
-- appointment, decision or event. Every existing governed record keeps its state.
--
-- ----------------------------------------------------------------------------------------------------
-- 1. THE TWO-PERSON RULE FOR CHECKLIST PUBLICATION (section 3 of the spec).
--    890 refused publication by anyone who authored, edited or submitted the version or an earlier one.
--    The owner approved the default controlled-content process in which Person A authors, submits and,
--    after an independent approval, PUBLISHES THE EXACT APPROVED VERSION, while Person B reviews and
--    approves. asmt_version_lifecycle_guard is replaced whole with ONE change in its publish branch:
--    publishing needs the publish capability and the required number of governance approvals, on the
--    current content hash, each recorded by a reviewer who is not among the people of the version, and no
--    rejection or request for changes on that hash. The review decision guard (890) still refuses a
--    decision by an author, editor or submitter of this or any earlier version, so no person ever
--    approves their own work. A change after approval is only possible by returning to draft, which
--    clears the hash the approvals name, so the approvals no longer count. Every decision, approval and
--    publication stays a distinct record with its person, action, version and time.
--
-- 2. REPORTING RELATIONSHIPS (sections 1 and 6). hq_position gains reports_to, a self reference, and
--    hq_position_admin_set_reports_to (owner only, audit_log row first, the 500 pattern). A cycle is refused.
--
-- 3. THE INITIAL ORGANISATION (section 1, acceptance 1 and 2). Five executive and eight management
--    positions as ordinary hq_position rows, with reporting lines, and the standard content-governance
--    profile as ordinary hq_position_capability grants: view, author, submit, review, approve, publish,
--    retire and manage controlled content, and view governance history. Clinical approval
--    (hq.quality.clinical.approve) is a specialist clinical authority and is granted only to the Chief
--    Clinical and Academic Officer and the two managers of that portfolio (spec: executive status is not
--    unrestricted clinical authority). A grant whose pair is blocked by hq_capability_exclusions() on the
--    target database is skipped with a notice rather than failing the file, and the build record says so.
--    Management positions require scoped appointments (641), so every management appointment names the
--    capabilities it carries. These rows are the initial configuration only: later changes are no-code
--    through the positions screen (500 and 641).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/UNIFIED-GOVERNANCE-V1/ROLLBACK-940.sql
-- ====================================================================================================


-- ---- 1. the two-person publication rule ---------------------------------------------------------------

create or replace function public.asmt_version_lifecycle_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_pcol text := public.asmt_version_parent_col(tg_table_name);
  v_life constant text[] := array['id', 'created_at', 'version_no', 'state', 'content_hash', 'authored_by', 'edited_by',
    'last_edited_by', 'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
    'duplicated_from_version_id', 'adopted_from_version_id'];
  v_fixed constant text[] := array['id', 'created_at', 'version_no', 'state', 'content_hash', 'authored_by',
    'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
    'duplicated_from_version_id', 'adopted_from_version_id'];
  v_publish constant text := 'hq.assessment.instrument.publish';
  v_new jsonb;
  v_old jsonb;
  v_allowed text[];
  v_no int;
  v_need int;
  v_n int;
  v_risk text;
begin
  if v_pcol is null then
    raise exception 'asmt lifecycle: % is not a version table', tg_table_name;
  end if;

  if tg_op = 'DELETE' then
    if old.state = 'draft' then
      return old;
    end if;
    raise exception '%: a % version is kept as history. Only a draft can be deleted', tg_table_name, old.state;
  end if;

  if tg_op = 'INSERT' then
    if new.state is distinct from 'draft' then
      raise exception '%: a new version always starts as a draft. Use asmt_duplicate_version to change a published one', tg_table_name;
    end if;
    if new.published_by is not null or new.retired_by is not null or new.submitted_by is not null or new.content_hash is not null then
      raise exception '%: a new draft cannot carry submission, publication or retirement', tg_table_name;
    end if;
    if new.version_no is null then
      execute format('select coalesce(max(version_no), 0) + 1 from %I where %I = $1', tg_table_name, v_pcol)
        into v_no using (to_jsonb(new) ->> v_pcol)::uuid;
      new.version_no := v_no;
    end if;
    new.edited_by := '{}';
    return new;
  end if;

  -- UPDATE
  v_new := to_jsonb(new);
  v_old := to_jsonb(old);

  if old.state = 'retired' then
    raise exception '%: a retired version is final and cannot change', tg_table_name;
  end if;

  if old.state = 'published' then
    if new.state is distinct from 'retired' then
      raise exception '%: a published version is frozen. The only change is retirement. Make a new draft with asmt_duplicate_version', tg_table_name;
    end if;
    if new.retired_by is null then
      raise exception '%: a retirement must record who retired it', tg_table_name;
    end if;
    new.retired_at := coalesce(new.retired_at, now());
    v_new := to_jsonb(new);
    if (v_new - array['state', 'retired_by', 'retired_at']) is distinct from (v_old - array['state', 'retired_by', 'retired_at']) then
      raise exception '%: a published version is frozen. Retirement changes nothing else', tg_table_name;
    end if;
    if not public.individual_holds_capability(new.retired_by, v_publish) then
      raise exception '%: not authorised. Retiring a version needs the publish capability', tg_table_name;
    end if;
    return new;
  end if;

  if old.state = 'draft' then
    if new.state = 'draft' then
      if public.asmt_jsonb_pick(v_new, v_fixed) is distinct from public.asmt_jsonb_pick(v_old, v_fixed) then
        raise exception '%: lifecycle columns of a draft change only by a transition', tg_table_name;
      end if;
      if not (new.edited_by @> old.edited_by) then
        raise exception '%: the list of editors only grows', tg_table_name;
      end if;
      if (v_new - v_life) is distinct from (v_old - v_life) then
        if new.last_edited_by is null then
          raise exception '%: an edit must name who edited (last_edited_by)', tg_table_name;
        end if;
        if not (new.last_edited_by = any(new.authored_by) or new.last_edited_by = any(new.edited_by)) then
          new.edited_by := new.edited_by || new.last_edited_by;
        end if;
      end if;
      return new;
    elsif new.state = 'in_review' then
      if new.submitted_by is null
         or not (new.submitted_by = any(new.authored_by) or new.submitted_by = any(new.edited_by)) then
        raise exception '%: only an author or editor of the draft can put it forward for review', tg_table_name;
      end if;
      if (v_new - v_life - 'risk') is distinct from (v_old - v_life - 'risk') then
        raise exception '%: content cannot change in the same step as submission', tg_table_name;
      end if;
      if tg_table_name = 'asmt_instrument_version' then
        if not exists (select 1 from asmt_purpose p where p.code = new.purpose_code and p.publishable) then
          raise exception '%: purpose % cannot be published', tg_table_name, new.purpose_code;
        end if;
        if cardinality(new.delivery_modes) = 0 then
          raise exception '%: a definition cannot be put forward without at least one delivery mode', tg_table_name;
        end if;
        if exists (select 1 from asmt_item i where i.version_id = new.id and i.critical) then
          new.risk := 'high';
        end if;
        if exists (
            select 1 from (
              select scale_version_id as sid from asmt_item where version_id = new.id and scale_version_id is not null
              union select scale_version_id from asmt_item_field where version_id = new.id and scale_version_id is not null) s
              join asmt_response_scale_version sv on sv.id = s.sid
             where sv.state <> 'published') then
          raise exception '%: every scale an item uses must be a published scale version', tg_table_name;
        end if;
      end if;
      new.submitted_at := now();
      new.content_hash := public.asmt_version_content_hash(tg_table_name, new.id, to_jsonb(new));
      v_allowed := array['state', 'content_hash', 'submitted_by', 'submitted_at', 'risk'];
    else
      raise exception '%: a draft can only be put forward for review', tg_table_name;
    end if;

  elsif old.state = 'in_review' then
    if new.state = 'draft' then
      if new.last_edited_by is null then
        raise exception '%: a return to draft must name who returned it (last_edited_by)', tg_table_name;
      end if;
      new.content_hash := null;
      v_allowed := array['state', 'content_hash', 'last_edited_by'];
    elsif new.state = 'approved' then
      v_risk := coalesce(v_old ->> 'risk', 'standard');
      v_need := public.hq_sod_required_approvals(v_risk);
      select count(distinct d.reviewer_id) into v_n from asmt_review_decision d
       where d.version_table = tg_table_name and d.version_id = old.id and d.review_kind = 'governance'
         and d.decision = 'approved' and d.content_hash = old.content_hash;
      if v_n < v_need then
        raise exception '%: not approved. It needs % independent governance approval(s) of this exact content and has %', tg_table_name, v_need, v_n;
      end if;
      if exists (select 1 from asmt_review_decision d
                  where d.version_table = tg_table_name and d.version_id = old.id
                    and d.content_hash = old.content_hash and d.decision <> 'approved') then
        raise exception '%: not approved. A reviewer rejected it or asked for changes on this exact content', tg_table_name;
      end if;
      if coalesce((v_old ->> 'requires_domain_review')::boolean, false) then
        select count(distinct d.reviewer_id) into v_n from asmt_review_decision d
         where d.version_table = tg_table_name and d.version_id = old.id and d.review_kind = 'domain'
           and d.decision = 'approved' and d.content_hash = old.content_hash;
        if v_n < v_need then
          raise exception '%: not approved. It needs % independent domain approval(s) of this exact content and has %', tg_table_name, v_need, v_n;
        end if;
      end if;
      v_allowed := array['state'];
    else
      raise exception '%: a version in review is approved or returned to draft', tg_table_name;
    end if;

  elsif old.state = 'approved' then
    if new.state = 'draft' then
      if new.last_edited_by is null then
        raise exception '%: a return to draft must name who returned it (last_edited_by)', tg_table_name;
      end if;
      new.content_hash := null;
      v_allowed := array['state', 'content_hash', 'last_edited_by'];
    elsif new.state = 'published' then
      if new.published_by is null then
        raise exception '%: a publication must record its publisher', tg_table_name;
      end if;
      -- 940 (UNIFIED-GOVERNANCE-V1, owner two-person rule): the author may publish the EXACT independently approved
      -- version. Independence lives at the decision: every approval counted here was recorded by a reviewer who never
      -- authored, edited or submitted this or an earlier version (asmt_review_decision_sod_guard), on this content hash.
      if not public.individual_holds_capability(new.published_by, v_publish) then
        raise exception '%: not authorised. Publishing needs the publish capability', tg_table_name;
      end if;
      if old.content_hash is null then
        raise exception '%: not publishable. An approved version carries the content hash its approvals name', tg_table_name;
      end if;
      v_risk := coalesce(v_old ->> 'risk', 'standard');
      v_need := public.hq_sod_required_approvals(v_risk);
      select count(distinct d.reviewer_id) into v_n from asmt_review_decision d
       where d.version_table = tg_table_name and d.version_id = old.id and d.review_kind = 'governance'
         and d.decision = 'approved' and d.content_hash = old.content_hash
         and not (d.reviewer_id = any(public.asmt_version_people(tg_table_name, old.id)));
      if v_n < v_need then
        raise exception '%: not publishable. It needs % independent governance approval(s) of this exact content and has %', tg_table_name, v_need, v_n;
      end if;
      if exists (select 1 from asmt_review_decision d
                  where d.version_table = tg_table_name and d.version_id = old.id
                    and d.content_hash = old.content_hash and d.decision <> 'approved') then
        raise exception '%: not publishable. A reviewer rejected it or asked for changes on this exact content', tg_table_name;
      end if;
      if tg_table_name = 'asmt_instrument_version' then
        if cardinality(new.delivery_modes) = 0 then
          raise exception '%: a definition cannot be published without at least one delivery mode', tg_table_name;
        end if;
      end if;
      new.published_at := now();
      v_allowed := array['state', 'published_by', 'published_at'];
    else
      raise exception '%: an approved version is published or returned to draft', tg_table_name;
    end if;
  end if;

  v_new := to_jsonb(new);
  if (v_new - v_allowed) is distinct from (v_old - v_allowed) then
    raise exception '%: a % version is frozen. This step changes nothing but its lifecycle columns', tg_table_name, old.state;
  end if;
  return new;
end;
$$;

-- ---- 2. reporting relationships -------------------------------------------------------------------------

alter table hq_position add column if not exists reports_to text references hq_position(code) on delete set null;
create index if not exists idx_hq_position_reports_to on hq_position (reports_to);

-- A reporting line never loops. Checked for every writer.
create or replace function hq_position_reports_to_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cur text := new.reports_to;
  v_hops int := 0;
begin
  if new.reports_to is null then
    return new;
  end if;
  if new.reports_to = new.code then
    raise exception 'hq_position reports_to: a position cannot report to itself';
  end if;
  while v_cur is not null and v_hops < 64 loop
    if v_cur = new.code then
      raise exception 'hq_position reports_to: % would create a reporting loop', new.code;
    end if;
    select p.reports_to into v_cur from hq_position p where p.code = v_cur;
    v_hops := v_hops + 1;
  end loop;
  return new;
end;
$$;

drop trigger if exists hq_position_reports_to_guard on hq_position;
create trigger hq_position_reports_to_guard before insert or update of reports_to on hq_position
  for each row execute function hq_position_reports_to_guard();

-- The no-code write: owner only, audit first, one transaction (the 500 pattern).
create or replace function hq_position_admin_set_reports_to(
  p_actor uuid, p_actor_name text, p_trace text,
  p_code text, p_reports_to text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old hq_position%rowtype;
  v_to text := nullif(btrim(coalesce(p_reports_to, '')), '');
begin
  if not hq_actor_is_owner(p_actor) then
    raise exception 'hq_position_admin: platform ownership is required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'hq_position_admin: a reason of at least 5 characters is required';
  end if;
  select * into v_old from hq_position where code = p_code;
  if not found then
    raise exception 'hq_position_admin: no such position %', p_code;
  end if;
  if v_to is not null and not exists (select 1 from hq_position where code = v_to) then
    raise exception 'hq_position_admin: no such position to report to %', v_to;
  end if;
  insert into audit_log (actor_id, actor_name, action, entity_type, entity_name, old_value, new_value, trace_id)
  values (p_actor, p_actor_name, 'hq_position_reports_to_set', 'hq_position', p_code,
          jsonb_build_object('reports_to', v_old.reports_to), jsonb_build_object('reports_to', v_to, 'reason', btrim(p_reason)), p_trace);
  update hq_position set reports_to = v_to where code = p_code;
  return jsonb_build_object('code', p_code, 'reports_to', v_to);
end;
$$;


-- ---- 3. the initial organisation (nobody appointed) -----------------------------------------------------

insert into hq_position (code, space, name, description) values
  ('chief_executive_officer', 'executive', 'Chief Executive Officer, CEO',
   'Leads Competen Holdings. Holds the standard content-governance profile across every product'),
  ('chief_technology_product_officer', 'executive', 'Chief Technology and Product Officer, CTPO',
   'Leads platform engineering and product. Holds the standard content-governance profile'),
  ('chief_clinical_academic_officer', 'executive', 'Chief Clinical and Academic Officer, CCAO',
   'Leads clinical standards, competency and academic assessment. Holds the standard profile with clinical approval'),
  ('chief_operations_finance_officer', 'executive', 'Chief Operations and Finance Officer, COFO',
   'Leads finance, administration, commercial and partnerships. Holds the standard content-governance profile'),
  ('chief_quality_governance_officer', 'executive', 'Chief Quality and Governance Officer, CQGO',
   'Leads quality, risk, governance and compliance. Holds the standard content-governance profile'),
  ('platform_engineering_manager', 'platform', 'Platform Engineering Manager',
   'Reports to the CTPO. Standard profile within the delegated scope of each appointment'),
  ('product_experience_manager', 'platform', 'Product and Experience Manager',
   'Reports to the CTPO. Standard profile within the delegated scope of each appointment'),
  ('clinical_standards_competency_manager', 'quality', 'Clinical Standards and Competency Manager',
   'Reports to the CCAO. Standard profile with clinical approval within the delegated scope of each appointment'),
  ('academic_assessment_manager', 'learning', 'Academic and Assessment Manager',
   'Reports to the CCAO. Standard profile with clinical approval within the delegated scope of each appointment'),
  ('finance_administration_manager', 'executive', 'Finance and Administration Manager',
   'Reports to the COFO. Standard profile within the delegated scope of each appointment'),
  ('commercial_partnerships_manager', 'executive', 'Commercial and Partnerships Manager',
   'Reports to the COFO. Standard profile within the delegated scope of each appointment'),
  ('quality_risk_manager', 'quality', 'Quality and Risk Manager',
   'Reports to the CQGO. Standard profile within the delegated scope of each appointment'),
  ('governance_compliance_manager', 'quality', 'Governance and Compliance Manager',
   'Reports to the CQGO. Standard profile within the delegated scope of each appointment')
on conflict (code) do nothing;

update hq_position set reports_to = 'chief_executive_officer'
 where code in ('chief_technology_product_officer', 'chief_clinical_academic_officer', 'chief_operations_finance_officer', 'chief_quality_governance_officer')
   and reports_to is null;
update hq_position set reports_to = 'chief_technology_product_officer'
 where code in ('platform_engineering_manager', 'product_experience_manager') and reports_to is null;
update hq_position set reports_to = 'chief_clinical_academic_officer'
 where code in ('clinical_standards_competency_manager', 'academic_assessment_manager') and reports_to is null;
update hq_position set reports_to = 'chief_operations_finance_officer'
 where code in ('finance_administration_manager', 'commercial_partnerships_manager') and reports_to is null;
update hq_position set reports_to = 'chief_quality_governance_officer'
 where code in ('quality_risk_manager', 'governance_compliance_manager') and reports_to is null;

-- Management appointments name the capabilities they carry (641): the delegated scope of the spec.
update hq_position set scoped_appointments = true
 where code in ('platform_engineering_manager', 'product_experience_manager', 'clinical_standards_competency_manager', 'academic_assessment_manager',
                'finance_administration_manager', 'commercial_partnerships_manager', 'quality_risk_manager', 'governance_compliance_manager')
   and scoped_appointments = false
   and not exists (select 1 from ogs_office_appointments a where a.role = hq_position.code and a.status = 'active');

-- Every position reaches the HQ landing page (the same plain seed shape as 264 and 890, which the HQ guard harness D6 reads).
insert into hq_position_capability (position_code, capability_code, source, grant_reason)
select p.code, c.code, 'position_default', 'UNIFIED-GOVERNANCE-V1 HQ landing page 940'
from (values
  ('chief_executive_officer', 'hq.platform.home.view'),
  ('chief_technology_product_officer', 'hq.platform.home.view'),
  ('chief_clinical_academic_officer', 'hq.platform.home.view'),
  ('chief_operations_finance_officer', 'hq.platform.home.view'),
  ('chief_quality_governance_officer', 'hq.platform.home.view'),
  ('platform_engineering_manager', 'hq.platform.home.view'),
  ('product_experience_manager', 'hq.platform.home.view'),
  ('clinical_standards_competency_manager', 'hq.platform.home.view'),
  ('academic_assessment_manager', 'hq.platform.home.view'),
  ('finance_administration_manager', 'hq.platform.home.view'),
  ('commercial_partnerships_manager', 'hq.platform.home.view'),
  ('quality_risk_manager', 'hq.platform.home.view'),
  ('governance_compliance_manager', 'hq.platform.home.view')
) as c(position_code, code)
join (select code from hq_position) p on p.code = c.position_code
where exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code
  );

-- The rest of the standard content-governance profile, granted one by one so a pair blocked on the target database
-- skips that one grant with a notice instead of failing the file.
do $$
declare
  v_profile text[] := array[
    'hq.quality.governance.view',
    'hq.assessment.catalogue.view', 'hq.assessment.catalogue.manage',
    'hq.assessment.studio.view', 'hq.assessment.instrument.author', 'hq.assessment.instrument.review', 'hq.assessment.instrument.publish',
    'hq.quality.competency.author', 'hq.quality.competency.publish'];
  v_clinical text[] := array['hq.quality.clinical.approve'];
  v_exec text[] := array['chief_executive_officer', 'chief_technology_product_officer', 'chief_clinical_academic_officer', 'chief_operations_finance_officer', 'chief_quality_governance_officer'];
  v_mgmt text[] := array['platform_engineering_manager', 'product_experience_manager', 'clinical_standards_competency_manager', 'academic_assessment_manager',
                         'finance_administration_manager', 'commercial_partnerships_manager', 'quality_risk_manager', 'governance_compliance_manager'];
  v_clinical_positions text[] := array['chief_clinical_academic_officer', 'clinical_standards_competency_manager', 'academic_assessment_manager'];
  v_pos text;
  v_cap text;
begin
  foreach v_pos in array v_exec || v_mgmt loop
    foreach v_cap in array v_profile loop
      if exists (select 1 from hq_capability c where c.code = v_cap)
         and not exists (select 1 from hq_position_capability x where x.position_code = v_pos and x.capability_code = v_cap) then
        begin
          insert into hq_position_capability (position_code, capability_code, source, grant_reason)
          values (v_pos, v_cap, 'position_default', 'UNIFIED-GOVERNANCE-V1 standard content-governance profile, 940');
        exception when others then
          raise notice '940: grant % on % skipped: %', v_cap, v_pos, sqlerrm;
        end;
      end if;
    end loop;
  end loop;
  foreach v_pos in array v_clinical_positions loop
    foreach v_cap in array v_clinical loop
      if exists (select 1 from hq_capability c where c.code = v_cap)
         and not exists (select 1 from hq_position_capability x where x.position_code = v_pos and x.capability_code = v_cap) then
        begin
          insert into hq_position_capability (position_code, capability_code, source, grant_reason)
          values (v_pos, v_cap, 'position_default', 'UNIFIED-GOVERNANCE-V1 clinical approval for the clinical and academic portfolio, 940');
        exception when others then
          raise notice '940: grant % on % skipped: %', v_cap, v_pos, sqlerrm;
        end;
      end if;
    end loop;
  end loop;
end
$$;

notify pgrst, 'reload schema';
