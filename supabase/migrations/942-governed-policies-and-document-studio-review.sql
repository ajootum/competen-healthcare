-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains plpgsql function bodies between dollar quotes. A runner that splits
-- on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 942: GOVERNED POLICIES ON THE EXISTING DEFINITION ENGINE, AND THE DOCUMENT TEMPLATE STUDIO
-- ON THE TWO-PERSON RULE (UNIFIED-GOVERNANCE-V1 follow-up, item 5)
--
-- Owner follow-up, 3 Nov 2026: extend the unified governance lifecycle to Document Studio and governed
-- policies, reusing the existing engine, versioning, review and approval controls and audit history. No
-- separate approval system. Staging first. Production is applied by the owner on a separate GO.
-- Build record: docs/evidence/UNIFIED-GOVERNANCE-V1/942-build-record.md.
--
-- DEPENDS ON 890 (the definition engine: lifecycle guard, after guard, review decision guard, trails,
-- asmt_duplicate_version), 940 (the two-person publication rule in the lifecycle guard), 264 and 500
-- (capabilities, positions, grants), 376 (hq.individual.config.manage), 451 (individual_holds_capability),
-- 076 and 640 (workspace_config_overrides with published_by). APPLY AFTER 941. Re-running it is a no-op.
-- It appoints nobody and changes no existing definition, decision or event.
--
-- ----------------------------------------------------------------------------------------------------
-- 1. GOVERNED POLICIES ARE A SIXTH DEFINITION KIND OF THE 890 ENGINE.
--    hq_policy (the identity, code POL-nnnnnn) and hq_policy_version (the 890 lifecycle columns plus title,
--    summary, content, effective_from, review_due) are guarded by the SAME functions as checklists: the
--    lifecycle guard (draft, in review, approved, published, retired, with the 940 two-person publication rule),
--    the after guard (events, retirement of the previous published version), the review decision guard
--    (nobody decides on their own work, across every version), the append-only trails, and
--    asmt_duplicate_version. The engine learns the table through asmt_version_parent_col, and which
--    capabilities apply through the new asmt_lifecycle_capability(table, step): policies need
--    hq.quality.policy.author, .review and .publish (new, quality space), domain review stays
--    hq.quality.clinical.approve. The two trail tables accept the new table name.
-- 2. THE STANDARD PROFILE GAINS THE POLICY CAPABILITIES. The 13 positions of 940 (and the Quality Council
--    Member, which already views policies) receive policy view, author, review and publish as ordinary grants.
-- 3. DOCUMENT TEMPLATE STUDIO. Its content is the documents configuration (workspace_config_overrides,
--    individual.professional_documents), published with the Individual policy. hq_config_review records a
--    submission of the current draft (by its hash) and ONE independent decision by a different holder of
--    hq.individual.config.manage. hq_config_publish_guard refuses publishing a CHANGED documents draft
--    without an approval on exactly that hash, and records nothing else: unchanged paths, and every other
--    path of the policy, publish as before. The submitter may publish the approved draft (two-person rule).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/UNIFIED-GOVERNANCE-V1/ROLLBACK-942.sql
-- ====================================================================================================


-- ---- 1a. capabilities and grants (nobody appointed) --------------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.quality.policy.author', 'quality', 'Policy authoring',
   'Create, edit, duplicate and submit draft governed policies. Never approves what the holder authored, edited or submitted'),
  ('hq.quality.policy.review', 'quality', 'Policy review',
   'Record an independent review decision on a governed policy version put forward for approval'),
  ('hq.quality.policy.publish', 'quality', 'Policy publication',
   'Publish or retire an approved governed policy version. The author may publish the exact independently approved version')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source, grant_reason)
select p.code, c.code, 'position_default', 'UNIFIED-GOVERNANCE-V1 governed policies 942'
from (values
  ('chief_executive_officer', 'hq.quality.policy.view'), ('chief_executive_officer', 'hq.quality.policy.author'), ('chief_executive_officer', 'hq.quality.policy.review'), ('chief_executive_officer', 'hq.quality.policy.publish'),
  ('chief_technology_product_officer', 'hq.quality.policy.view'), ('chief_technology_product_officer', 'hq.quality.policy.author'), ('chief_technology_product_officer', 'hq.quality.policy.review'), ('chief_technology_product_officer', 'hq.quality.policy.publish'),
  ('chief_clinical_academic_officer', 'hq.quality.policy.view'), ('chief_clinical_academic_officer', 'hq.quality.policy.author'), ('chief_clinical_academic_officer', 'hq.quality.policy.review'), ('chief_clinical_academic_officer', 'hq.quality.policy.publish'),
  ('chief_operations_finance_officer', 'hq.quality.policy.view'), ('chief_operations_finance_officer', 'hq.quality.policy.author'), ('chief_operations_finance_officer', 'hq.quality.policy.review'), ('chief_operations_finance_officer', 'hq.quality.policy.publish'),
  ('chief_quality_governance_officer', 'hq.quality.policy.view'), ('chief_quality_governance_officer', 'hq.quality.policy.author'), ('chief_quality_governance_officer', 'hq.quality.policy.review'), ('chief_quality_governance_officer', 'hq.quality.policy.publish'),
  ('platform_engineering_manager', 'hq.quality.policy.view'), ('platform_engineering_manager', 'hq.quality.policy.author'), ('platform_engineering_manager', 'hq.quality.policy.review'), ('platform_engineering_manager', 'hq.quality.policy.publish'),
  ('product_experience_manager', 'hq.quality.policy.view'), ('product_experience_manager', 'hq.quality.policy.author'), ('product_experience_manager', 'hq.quality.policy.review'), ('product_experience_manager', 'hq.quality.policy.publish'),
  ('clinical_standards_competency_manager', 'hq.quality.policy.view'), ('clinical_standards_competency_manager', 'hq.quality.policy.author'), ('clinical_standards_competency_manager', 'hq.quality.policy.review'), ('clinical_standards_competency_manager', 'hq.quality.policy.publish'),
  ('academic_assessment_manager', 'hq.quality.policy.view'), ('academic_assessment_manager', 'hq.quality.policy.author'), ('academic_assessment_manager', 'hq.quality.policy.review'), ('academic_assessment_manager', 'hq.quality.policy.publish'),
  ('finance_administration_manager', 'hq.quality.policy.view'), ('finance_administration_manager', 'hq.quality.policy.author'), ('finance_administration_manager', 'hq.quality.policy.review'), ('finance_administration_manager', 'hq.quality.policy.publish'),
  ('commercial_partnerships_manager', 'hq.quality.policy.view'), ('commercial_partnerships_manager', 'hq.quality.policy.author'), ('commercial_partnerships_manager', 'hq.quality.policy.review'), ('commercial_partnerships_manager', 'hq.quality.policy.publish'),
  ('quality_risk_manager', 'hq.quality.policy.view'), ('quality_risk_manager', 'hq.quality.policy.author'), ('quality_risk_manager', 'hq.quality.policy.review'), ('quality_risk_manager', 'hq.quality.policy.publish'),
  ('governance_compliance_manager', 'hq.quality.policy.view'), ('governance_compliance_manager', 'hq.quality.policy.author'), ('governance_compliance_manager', 'hq.quality.policy.review'), ('governance_compliance_manager', 'hq.quality.policy.publish'),
  ('quality_council_member', 'hq.quality.policy.review'), ('quality_council_member', 'hq.quality.policy.publish')
) as c(position_code, code)
join (select code from hq_position) p on p.code = c.position_code
where exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code
  );


-- ---- 1b. the policy tables ---------------------------------------------------------------------------------

create sequence if not exists hq_policy_code_seq;

create table if not exists hq_policy (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default ('POL-' || lpad(nextval('hq_policy_code_seq')::text, 6, '0')),
  title         text not null,
  policy_type   text not null default 'governance',
  scope         text not null default 'holdings',
  description   text,
  is_active     boolean not null default true,
  legacy_policy_id uuid references policies(id) on delete set null,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table hq_policy drop constraint if exists hq_policy_title_check;
alter table hq_policy add constraint hq_policy_title_check check (char_length(btrim(title)) between 3 and 200);
alter table hq_policy drop constraint if exists hq_policy_type_check;
alter table hq_policy add constraint hq_policy_type_check
  check (policy_type in ('clinical', 'hr', 'safety', 'governance', 'infection_control', 'quality'));
alter table hq_policy drop constraint if exists hq_policy_scope_check;
alter table hq_policy add constraint hq_policy_scope_check check (scope in ('holdings', 'scholar', 'practice', 'enterprise', 'individual'));
alter table hq_policy enable row level security;

create table if not exists hq_policy_version (
  id                         uuid primary key default gen_random_uuid(),
  policy_id                  uuid not null references hq_policy(id) on delete cascade,
  version_no                 integer,
  state                      text not null default 'draft',
  content_hash               text,
  authored_by                uuid[] not null,
  edited_by                  uuid[] not null default '{}',
  last_edited_by             uuid,
  submitted_by               uuid,
  submitted_at               timestamptz,
  published_by               uuid,
  published_at               timestamptz,
  retired_by                 uuid,
  retired_at                 timestamptz,
  duplicated_from_version_id uuid,
  title                      text not null,
  summary                    text,
  content                    text not null default '',
  effective_from             date,
  review_due                 date,
  created_at                 timestamptz not null default now()
);
alter table hq_policy_version drop constraint if exists hq_policy_version_state_check;
alter table hq_policy_version add constraint hq_policy_version_state_check
  check (state in ('draft', 'in_review', 'approved', 'published', 'retired') and cardinality(authored_by) >= 1);
alter table hq_policy_version drop constraint if exists hq_policy_version_title_check;
alter table hq_policy_version add constraint hq_policy_version_title_check check (char_length(btrim(title)) between 3 and 200);
create index if not exists idx_hq_policy_version_policy on hq_policy_version (policy_id, version_no);
create index if not exists idx_hq_policy_version_state on hq_policy_version (state);
alter table hq_policy_version enable row level security;

-- The code and the author of a policy are permanent, like a checklist definition.
create or replace function public.hq_policy_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.code is distinct from old.code or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'hq_policy: the code and the origin of a policy are permanent';
  end if;
  return new;
end;
$$;
drop trigger if exists hq_policy_guard on hq_policy;
create trigger hq_policy_guard before update on hq_policy for each row execute function public.hq_policy_guard();


-- ---- 1c. the engine learns the table and the capabilities ------------------------------------------------

create or replace function public.asmt_version_parent_col(p_table text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case p_table
    when 'asmt_instrument_version' then 'instrument_id'
    when 'asmt_response_scale_version' then 'scale_id'
    when 'asmt_rule_template_version' then 'template_id'
    when 'asmt_layout_template_version' then 'template_id'
    when 'asmt_progression_rule_version' then 'rule_set_id'
    when 'hq_policy_version' then 'policy_id'
    else null end
$$;

-- Which capability a lifecycle step needs on which version table. Policies have their own three rights.
create or replace function public.asmt_lifecycle_capability(p_table text, p_step text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when p_step = 'domain' then 'hq.quality.clinical.approve'
    when p_table = 'hq_policy_version' then case p_step
      when 'author' then 'hq.quality.policy.author'
      when 'review' then 'hq.quality.policy.review'
      when 'publish' then 'hq.quality.policy.publish'
      else null end
    else case p_step
      when 'author' then 'hq.assessment.instrument.author'
      when 'review' then 'hq.assessment.instrument.review'
      when 'publish' then 'hq.assessment.instrument.publish'
      else null end
  end
$$;
revoke all on function public.asmt_lifecycle_capability(text, text) from public, anon, authenticated;
grant execute on function public.asmt_lifecycle_capability(text, text) to service_role;

alter table asmt_definition_event drop constraint if exists asmt_definition_event_table_check;
alter table asmt_definition_event add constraint asmt_definition_event_table_check check (subject_table ~ '^(asmt|hq)_[a-z_]{3,60}$');
alter table asmt_review_decision drop constraint if exists asmt_review_decision_table_check;
alter table asmt_review_decision add constraint asmt_review_decision_table_check check (version_table in (
  'asmt_instrument_version', 'asmt_response_scale_version', 'asmt_rule_template_version',
  'asmt_layout_template_version', 'asmt_progression_rule_version', 'hq_policy_version'));

-- ---- 2. the guards, replaced whole with the capability lookup (lifecycle from 940, decision and duplicate from 890) ----

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
  v_publish text := public.asmt_lifecycle_capability(tg_table_name, 'publish');
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

create or replace function public.asmt_review_decision_sod_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_state text;
  v_hash text;
  v_cap text;
begin
  execute format('select state, content_hash from %I where id = $1', new.version_table) into v_state, v_hash using new.version_id;
  if v_state is null then
    raise exception 'asmt_review_decision: that version does not exist';
  end if;
  if v_state <> 'in_review' then
    raise exception 'asmt_review_decision: a decision is recorded only while the version is in review (it is %)', v_state;
  end if;
  if new.content_hash is distinct from v_hash then
    raise exception 'asmt_review_decision: the decision must name the current content hash of the version';
  end if;
  if new.reviewer_id = any(public.asmt_version_people(new.version_table, new.version_id)) then
    raise exception 'asmt_review_decision: not independent. A reviewer never reviews a version they, or any earlier version of it, authored, edited or submitted';
  end if;
  v_cap := public.asmt_lifecycle_capability(new.version_table, case new.review_kind when 'governance' then 'review' else 'domain' end);
  if new.appointment_id is not null then
    if not public.competency_appointment_holds(new.appointment_id, new.reviewer_id, v_cap) then
      raise exception 'asmt_review_decision: the named appointment does not hold % for this reviewer', v_cap;
    end if;
  elsif not public.individual_holds_capability(new.reviewer_id, v_cap) then
    raise exception 'asmt_review_decision: not authorised. A % decision needs %', new.review_kind, v_cap;
  end if;
  return new;
end;
$$;

create or replace function public.asmt_duplicate_version(p_version uuid, p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_table text;
  v_row jsonb;
  v_new uuid := gen_random_uuid();
  v_t text;
begin
  if p_actor is null then
    raise exception 'asmt_duplicate_version: not authorised. Duplicating needs the author capability';
  end if;
  foreach v_t in array array['asmt_instrument_version', 'asmt_response_scale_version', 'asmt_rule_template_version',
                             'asmt_layout_template_version', 'asmt_progression_rule_version', 'hq_policy_version'] loop
    if to_regclass('public.' || v_t) is not null then
      execute format('select to_jsonb(t) from %I t where id = $1', v_t) into v_row using p_version;
      if v_row is not null then
        v_table := v_t;
        exit;
      end if;
    end if;
  end loop;
  if v_table is null then
    raise exception 'asmt_duplicate_version: version % not found', p_version;
  end if;
  -- 942: the author capability of the table found (policies have their own).
  if not public.individual_holds_capability(p_actor, public.asmt_lifecycle_capability(v_table, 'author')) then
    raise exception 'asmt_duplicate_version: not authorised. Duplicating needs the author capability';
  end if;
  v_row := (v_row - array['content_hash', 'submitted_by', 'submitted_at', 'published_by', 'published_at', 'retired_by', 'retired_at',
                          'last_edited_by', 'version_no', 'adopted_from_version_id'])
           || jsonb_build_object('id', v_new, 'state', 'draft', 'authored_by', jsonb_build_array(p_actor),
                                 'edited_by', '[]'::jsonb, 'duplicated_from_version_id', p_version, 'created_at', now());
  execute format('insert into %1$I select (jsonb_populate_record(null::%1$I, $1)).*', v_table) using v_row;

  if v_table = 'asmt_instrument_version' then
    insert into asmt_group (version_id, code, label, weight, position, source_ref, updated_by)
      select v_new, code, label, weight, position, source_ref, p_actor from asmt_group where version_id = p_version;
    insert into asmt_section (version_id, stable_key, parent_section_id, title, guidance, weight, position, updated_by)
      select v_new, stable_key, null, title, guidance, weight, position, p_actor from asmt_section where version_id = p_version;
    update asmt_section n set parent_section_id = np.id
      from asmt_section o
      join asmt_section op on op.id = o.parent_section_id
      join asmt_section np on np.version_id = v_new and np.stable_key = op.stable_key
     where n.version_id = v_new and o.version_id = p_version and o.stable_key = n.stable_key and o.parent_section_id is not null;
    insert into asmt_item (version_id, section_id, stable_key, code, prompt, guidance, expected_performance, response_type,
                           scale_version_id, config, group_code, method_codes, method_rule, mandatory, critical,
                           critical_requirements, evidence_requirement, weight, references_text, position, updated_by)
      select v_new, ns.id, i.stable_key, i.code, i.prompt, i.guidance, i.expected_performance, i.response_type,
             i.scale_version_id, i.config, i.group_code, i.method_codes, i.method_rule, i.mandatory, i.critical,
             i.critical_requirements, i.evidence_requirement, i.weight, i.references_text, i.position, p_actor
        from asmt_item i
        left join asmt_section os on os.id = i.section_id
        left join asmt_section ns on ns.version_id = v_new and ns.stable_key = os.stable_key
       where i.version_id = p_version;
    insert into asmt_item_field (version_id, item_id, field_key, label, response_type, scale_version_id, config, required, position, updated_by)
      select v_new, ni.id, f.field_key, f.label, f.response_type, f.scale_version_id, f.config, f.required, f.position, p_actor
        from asmt_item_field f
        join asmt_item oi on oi.id = f.item_id
        join asmt_item ni on ni.version_id = v_new and ni.stable_key = oi.stable_key
       where f.version_id = p_version;
    insert into asmt_mapping (version_id, item_id, section_id, kind, ref_id, ref_code, ref_version, ref_hash, ref_snapshot, relation, updated_by)
      select v_new, ni.id, ns.id, m.kind, m.ref_id, m.ref_code, m.ref_version, m.ref_hash, m.ref_snapshot, m.relation, p_actor
        from asmt_mapping m
        left join asmt_item oi on oi.id = m.item_id
        left join asmt_item ni on ni.version_id = v_new and ni.stable_key = oi.stable_key
        left join asmt_section os on os.id = m.section_id
        left join asmt_section ns on ns.version_id = v_new and ns.stable_key = os.stable_key
       where m.version_id = p_version;
    insert into asmt_version_layout (version_id, layout_version_id, updated_by)
      select v_new, layout_version_id, p_actor from asmt_version_layout where version_id = p_version;
    insert into asmt_version_tag (version_id, term_id, updated_by)
      select v_new, term_id, p_actor from asmt_version_tag where version_id = p_version;
  elsif v_table = 'asmt_response_scale_version' then
    insert into asmt_response_scale_level (version_id, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id, updated_by)
      select v_new, code, label, description, ordinal, numeric_value, satisfactory, colour_token, source_level_id, p_actor
        from asmt_response_scale_level where version_id = p_version;
    insert into asmt_response_scale_state (version_id, state, label, updated_by)
      select v_new, state, label, p_actor from asmt_response_scale_state where version_id = p_version;
  end if;
  return v_new;
end;
$$;

drop trigger if exists hq_policy_version_lifecycle on hq_policy_version;
create trigger hq_policy_version_lifecycle
  before insert or update or delete on hq_policy_version
  for each row execute function public.asmt_version_lifecycle_guard();
drop trigger if exists hq_policy_version_after on hq_policy_version;
create trigger hq_policy_version_after
  after insert or update on hq_policy_version
  for each row execute function public.asmt_version_after_guard();


-- ---- 3. Document Template Studio: a review record and the publish guard on the documents configuration ------

create table if not exists hq_config_review (
  id            uuid primary key default gen_random_uuid(),
  scope_type    text not null,
  scope_ref     text,
  config_path   text not null,
  draft_hash    text not null,
  submitted_by  uuid not null references profiles(id) on delete cascade,
  submitted_at  timestamptz not null default now(),
  note          text,
  decided_by    uuid references profiles(id) on delete set null,
  decision      text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
alter table hq_config_review drop constraint if exists hq_config_review_decision_check;
alter table hq_config_review add constraint hq_config_review_decision_check
  check ((decision is null and decided_by is null and decided_at is null)
      or (decision in ('approved', 'changes_requested') and decided_by is not null and decided_at is not null));
create index if not exists idx_hq_config_review_path on hq_config_review (scope_type, scope_ref, config_path, created_at);
alter table hq_config_review enable row level security;

-- The paths governed by a review before publication. Only the documents configuration today.
create or replace function public.hq_config_review_governs(p_path text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select p_path = 'individual.professional_documents'
$$;

-- The hash of a stored draft, as the publish guard will compute it from the published value.
create or replace function public.hq_config_draft_hash(p_scope_type text, p_scope_ref text, p_path text)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select md5(o.draft::text) from workspace_config_overrides o
   where o.scope_type = p_scope_type and o.scope_ref is not distinct from p_scope_ref and o.config_path = p_path
$$;

-- Submit: the current draft of a governed path, by the person who may edit it. Decide: a different holder, once.
create or replace function public.hq_config_review_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if not public.hq_config_review_governs(new.config_path) then
      raise exception 'hq_config_review: % is not a path governed by review', new.config_path;
    end if;
    if new.decision is not null or new.decided_by is not null then
      raise exception 'hq_config_review: a submission carries no decision';
    end if;
    if not public.individual_holds_capability(new.submitted_by, 'hq.individual.config.manage') then
      raise exception 'hq_config_review: not authorised. Submitting the documents configuration needs the Competen Individual policy right';
    end if;
    if new.draft_hash is distinct from public.hq_config_draft_hash(new.scope_type, new.scope_ref, new.config_path) then
      raise exception 'hq_config_review: the submission must name the hash of the current draft';
    end if;
    if exists (select 1 from workspace_config_overrides o where o.scope_type = new.scope_type and o.scope_ref is not distinct from new.scope_ref
                and o.config_path = new.config_path and md5(coalesce(o.published, 'null'::jsonb)::text) = new.draft_hash) then
      raise exception 'hq_config_review: nothing to review. The draft is what is published';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'hq_config_review: the review record is append-only';
  end if;
  if old.decision is not null then
    raise exception 'hq_config_review: a decided review never changes';
  end if;
  if new.scope_type is distinct from old.scope_type or new.scope_ref is distinct from old.scope_ref or new.config_path is distinct from old.config_path
     or new.draft_hash is distinct from old.draft_hash or new.submitted_by is distinct from old.submitted_by or new.submitted_at is distinct from old.submitted_at
     or new.note is distinct from old.note or new.created_at is distinct from old.created_at then
    raise exception 'hq_config_review: only the decision of a submission can be recorded';
  end if;
  if new.decision is null then
    raise exception 'hq_config_review: record a decision';
  end if;
  if new.decided_by = old.submitted_by then
    raise exception 'hq_config_review: not independent. The person who submitted the draft cannot decide it';
  end if;
  if not public.individual_holds_capability(new.decided_by, 'hq.individual.config.manage') then
    raise exception 'hq_config_review: not authorised. Deciding needs the Competen Individual policy right';
  end if;
  if new.decision = 'changes_requested' and char_length(btrim(coalesce(new.decision_note, ''))) < 3 then
    raise exception 'hq_config_review: say what must change';
  end if;
  new.decided_at := now();
  return new;
end;
$$;
drop trigger if exists hq_config_review_guard on hq_config_review;
create trigger hq_config_review_guard before insert or update or delete on hq_config_review
  for each row execute function public.hq_config_review_guard();

-- A governed path is published only as the exact draft that was independently approved. The submitter may publish it.
create or replace function public.hq_config_publish_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_hash text;
begin
  if not public.hq_config_review_governs(new.config_path) then
    return new;
  end if;
  if new.published is not distinct from old.published then
    return new;
  end if;
  if new.published is null then
    return new;
  end if;
  v_hash := md5(new.published::text);
  if not exists (select 1 from hq_config_review r
                  where r.scope_type = new.scope_type and r.scope_ref is not distinct from new.scope_ref and r.config_path = new.config_path
                    and r.draft_hash = v_hash and r.decision = 'approved') then
    raise exception 'hq_config_publish: not approved. The documents configuration is published only as a draft that an independent holder approved on exactly this content. Submit it for review first';
  end if;
  if exists (select 1 from hq_config_review r
              where r.scope_type = new.scope_type and r.scope_ref is not distinct from new.scope_ref and r.config_path = new.config_path
                and r.draft_hash = v_hash and r.decision = 'changes_requested'
                and r.decided_at > (select max(a.decided_at) from hq_config_review a
                                     where a.scope_type = r.scope_type and a.scope_ref is not distinct from r.scope_ref and a.config_path = r.config_path
                                       and a.draft_hash = v_hash and a.decision = 'approved')) then
    raise exception 'hq_config_publish: not approved. A reviewer asked for changes on this exact content after it was approved';
  end if;
  if new.published_by is null then
    raise exception 'hq_config_publish: a publication of a governed path records its publisher';
  end if;
  return new;
end;
$$;
drop trigger if exists hq_config_publish_guard on workspace_config_overrides;
create trigger hq_config_publish_guard before update of published on workspace_config_overrides
  for each row execute function public.hq_config_publish_guard();

revoke all on function public.hq_config_review_governs(text) from public, anon, authenticated;
revoke all on function public.hq_config_draft_hash(text, text, text) from public, anon, authenticated;
grant execute on function public.hq_config_review_governs(text) to service_role;
grant execute on function public.hq_config_draft_hash(text, text, text) to service_role;

notify pgrst, 'reload schema';
