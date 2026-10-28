-- VERIFY-641: read-only. Every row must say true.
select 'no HQ appointment was changed: none carries a capability scope or a primary flag yet' as check,
  not exists (select 1 from ogs_office_appointments where capability_scope is not null or is_primary) as ok
union all select 'every position allows unlimited holders and an optional primary (nothing capped)',
  not exists (select 1 from hq_position where max_holders is not null) and not exists (select 1 from hq_position where primary_policy <> 'optional')
union all select 'only scholar_clinical_lead requires scoped appointments, and nobody is appointed to it',
  (select coalesce(array_agg(code order by code), '{}') = array['scholar_clinical_lead'] from hq_position where scoped_appointments)
  and not exists (select 1 from ogs_office_appointments where role = 'scholar_clinical_lead')
union all select 'the five holds-capability functions are narrowed by appointment scope and term',
  (select count(*) = 5 from pg_proc where proname in ('ckri_holds_capability', 'individual_holds_capability', 'learning_holds_capability',
     'competency_appointment_holds', 'hq_gov_studio_can_edit') and prosrc like '%hq_appointment_in_force(a.capability_scope, a.term_start, a.term_end, pc.capability_code)%')
union all select 'the three 641 triggers are enabled',
  (select count(*) = 3 from pg_trigger where tgenabled = 'O' and tgname in ('trg_hq_appointment_rules_guard', 'trg_hq_appointment_audit', 'clinical_review_decision_scope_guard'))
union all select '640 is untouched: 11 guards enabled and 6 blocked pairs',
  (select count(*) = 11 from pg_trigger where tgenabled = 'O' and tgname in
    ('trg_hq_sod_pair_policy_guard', 'trg_hq_sod_content_rule_guard', 'trg_hq_sod_appointment_guard', 'clinical_review_decision_sod_guard',
     'case_library_version_sod_publication', 'ckri_knowledge_version_sod_publication', 'learning_offering_version_sod_publication',
     'trg_frameworks_sod_publication_guard', 'clinical_reviewer_scope_sod_guard', 'wce_clinical_count_guard', 'clinical_content_version_sod_floor'))
  and (select count(*) = 6 from hq_capability_exclusions())
union all select 'no live HQ appointment is outside its term (nobody loses access by the term check)',
  not exists (select 1 from ogs_office_appointments x join ogs_offices o on o.id = x.office_id
               where x.status = 'active' and o.office_type like 'hq\_%'
                 and ((x.term_start is not null and x.term_start > current_date) or (x.term_end is not null and x.term_end < current_date)))
union all select 'the rules function is the service role''s only',
  not has_function_privilege('authenticated', 'hq_position_admin_set_rules(uuid, text, text, text, integer, text, boolean, text, text)', 'execute')
  and has_function_privilege('service_role', 'hq_position_admin_set_rules(uuid, text, text, text, integer, text, boolean, text, text)', 'execute')
union all select 'one decision per reviewer per version still holds (two appointments never give two approvals)',
  exists (select 1 from pg_indexes where indexname = 'ux_clinical_review_decision_reviewer');
