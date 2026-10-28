-- FINGERPRINT-640: read-only. Expect 0 | 0 | 0 | 0 | 0 before 640 (and after its rollback), 2 | 6 | 17 | 11 | 7 after.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
    ('hq_sod_pair_policy', 'hq_sod_content_rule')) as tables_2,
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in
    (('hq_config', 'sod_strict_positions'), ('hq_config', 'multiple_appointments'), ('hq_config', 'sod_updated_at'),
     ('hq_config', 'sod_updated_by'), ('workspace_config_overrides', 'published_by'), ('frameworks', 'published_by'))) as columns_6,
  (select count(*) from pg_proc where proname in
    ('hq_sod_policy_guard', 'hq_sod_person_positions', 'hq_sod_caps_of_positions', 'hq_sod_conflict', 'hq_sod_pair_holder',
     'hq_sod_appointment_guard', 'clinical_review_decision_sod_guard', 'hq_sod_publication_guard', 'frameworks_sod_publication_guard',
     'clinical_reviewer_scope_sod_guard', 'hq_sod_count_value', 'hq_sod_required_approvals', 'wce_clinical_count_guard',
     'clinical_content_version_sod_floor', 'hq_sod_admin_set_pair', 'hq_sod_admin_set_settings', 'hq_sod_admin_set_content_rule')) as functions_17,
  (select count(*) from pg_trigger where not tgisinternal and tgname in
    ('trg_hq_sod_pair_policy_guard', 'trg_hq_sod_content_rule_guard', 'trg_hq_sod_appointment_guard', 'clinical_review_decision_sod_guard',
     'case_library_version_sod_publication', 'ckri_knowledge_version_sod_publication', 'learning_offering_version_sod_publication',
     'trg_frameworks_sod_publication_guard', 'clinical_reviewer_scope_sod_guard', 'wce_clinical_count_guard', 'clinical_content_version_sod_floor')) as triggers_11,
  (select count(*) from hq_position_capability where position_code = 'scholar_clinical_lead' and effective_to is null) as scholar_grants_7;
