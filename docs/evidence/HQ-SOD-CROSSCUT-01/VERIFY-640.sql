-- VERIFY-640: read-only. Every row must say true.
select 'policy: 15 pairs, 9 allowed, 6 never liftable, allowed only where liftable' as check,
  (select count(*) = 15 and count(*) filter (where allowed) = 9 and count(*) filter (where not liftable) = 6
          and bool_and(liftable or not allowed) from hq_sod_pair_policy) as ok
union all select 'never liftable = the 4 competency assessor pairs and the 2 research pairs',
  (select bool_and(capability_a in ('hq.competency.verification.assess', 'hq.quality.research.propose')) and count(*) = 6
     from hq_sod_pair_policy where not liftable)
union all select 'hq_capability_exclusions() is STABLE and returns the 6 blocked pairs',
  (select provolatile = 's' from pg_proc where proname = 'hq_capability_exclusions')
  and (select count(*) = 6 from hq_capability_exclusions())
union all select 'strict position separation OFF, multiple appointments ON',
  (select sod_strict_positions = false and multiple_appointments = true from hq_config where id = 'singleton')
union all select '4 content-type rules, none switched on',
  (select count(*) = 4 and not bool_or(publisher_not_approver) from hq_sod_content_rule)
union all select 'Scholar Clinical Lead: 7 live grants, nobody appointed or seated',
  (select count(*) = 7 from hq_position_capability where position_code = 'scholar_clinical_lead' and effective_to is null)
  and not exists (select 1 from ogs_office_appointments where role = 'scholar_clinical_lead')
  and not exists (select 1 from hq_gov_seat where authority_position_code = 'scholar_clinical_lead')
union all select 'no live position holds an effectively blocked pair',
  not exists (select 1 from hq_position_capability g1 join hq_position_capability g2 on g2.position_code = g1.position_code
               join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
              where g1.effective_to is null and g2.effective_to is null)
union all select 'no person holds an effectively blocked pair across appointments and seats',
  not exists (select 1 from hq_capability_exclusions() e where hq_sod_pair_holder(e.capability_a, e.capability_b) is not null)
union all select 'the 11 guards are enabled',
  (select count(*) = 11 from pg_trigger where tgenabled = 'O' and tgname in
    ('trg_hq_sod_pair_policy_guard', 'trg_hq_sod_content_rule_guard', 'trg_hq_sod_appointment_guard', 'clinical_review_decision_sod_guard',
     'case_library_version_sod_publication', 'ckri_knowledge_version_sod_publication', 'learning_offering_version_sod_publication',
     'trg_frameworks_sod_publication_guard', 'clinical_reviewer_scope_sod_guard', 'wce_clinical_count_guard', 'clinical_content_version_sod_floor'))
union all select '395/461 independence, version-exact approval and one decision per reviewer are still in place',
  exists (select 1 from pg_trigger where tgname = 'clinical_review_decision_guard' and tgenabled = 'O')
  and exists (select 1 from pg_indexes where indexname = 'ux_clinical_review_decision_reviewer')
union all select 'the sensitive classes are unchanged',
  hq_capability_sensitive_class('hq.quality.clinical.approve') = 'clinical' and hq_capability_sensitive_class('hq.platform.ai.manage') = 'financial'
  and hq_capability_sensitive_class('hq.platform.home.view') is null
union all select 'the admin functions are the service role''s only',
  not has_function_privilege('authenticated', 'hq_sod_admin_set_pair(uuid, text, text, text, text, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'hq_sod_admin_set_settings(uuid, text, text, boolean, boolean, text)', 'execute')
  and has_function_privilege('service_role', 'hq_sod_admin_set_content_rule(uuid, text, text, text, boolean, text)', 'execute')
union all select 'the 2 new tables have RLS on and no policy',
  (select count(*) = 2 and bool_and(c.relrowsecurity) from pg_class c where c.relname in ('hq_sod_pair_policy', 'hq_sod_content_rule'))
  and not exists (select 1 from pg_policies where tablename in ('hq_sod_pair_policy', 'hq_sod_content_rule'));
