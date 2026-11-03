-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK 942 (staging rehearsal). Removes the policy tables, the review record and the
-- capability lookup, and restores the engine functions as 940 (lifecycle) and 890 (decision, duplicate, parent
-- column) define them. Refuses while a governed policy version exists (fix forward).
-- ====================================================================================================
do $$
begin
  if to_regclass('public.hq_policy_version') is not null and exists (select 1 from hq_policy_version) then
    raise exception 'ROLLBACK 942 refused: governed policy versions exist. Fix forward';
  end if;
end
$$;
drop trigger if exists hq_config_publish_guard on workspace_config_overrides;
drop function if exists public.hq_config_publish_guard();
drop table if exists hq_config_review;
drop function if exists public.hq_config_review_guard();
drop function if exists public.hq_config_draft_hash(text, text, text);
drop function if exists public.hq_config_review_governs(text);
drop table if exists hq_policy_version;
drop table if exists hq_policy;
drop function if exists public.hq_policy_guard();
drop sequence if exists hq_policy_code_seq;
alter table asmt_review_decision drop constraint if exists asmt_review_decision_table_check;
alter table asmt_review_decision add constraint asmt_review_decision_table_check check (version_table in (
  'asmt_instrument_version', 'asmt_response_scale_version', 'asmt_rule_template_version',
  'asmt_layout_template_version', 'asmt_progression_rule_version'));
alter table asmt_definition_event drop constraint if exists asmt_definition_event_table_check;
alter table asmt_definition_event add constraint asmt_definition_event_table_check check (subject_table ~ '^asmt_[a-z_]{3,60}$');
alter table hq_position_capability disable trigger hq_position_capability_guard;
delete from hq_position_capability where grant_reason = 'UNIFIED-GOVERNANCE-V1 governed policies 942';
alter table hq_position_capability enable trigger hq_position_capability_guard;
delete from hq_capability where code in ('hq.quality.policy.author', 'hq.quality.policy.review', 'hq.quality.policy.publish');

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
    else null end
$$;

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
  v_cap := case new.review_kind when 'governance' then 'hq.assessment.instrument.review' else 'hq.quality.clinical.approve' end;
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
  if p_actor is null or not public.individual_holds_capability(p_actor, 'hq.assessment.instrument.author') then
    raise exception 'asmt_duplicate_version: not authorised. Duplicating needs the author capability';
  end if;
  foreach v_t in array array['asmt_instrument_version', 'asmt_response_scale_version', 'asmt_rule_template_version',
                             'asmt_layout_template_version', 'asmt_progression_rule_version'] loop
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

drop function if exists public.asmt_lifecycle_capability(text, text);
notify pgrst, 'reload schema';
