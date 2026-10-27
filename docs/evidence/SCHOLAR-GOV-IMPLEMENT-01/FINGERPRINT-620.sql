-- FINGERPRINT-620: read-only. Expect 0 0 0 0 before 620 and 3 15 3 8 after.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
    ('hq_gov_structure', 'hq_gov_structure_version', 'hq_gov_relation_type')) as tables_3,
  (select count(*) from pg_proc where proname in
    ('hq_gov_published_version', 'hq_gov_appointment_version_stamp', 'hq_gov_delegation_version_stamp',
     'hq_gov_structure_version_guard', 'hq_gov_studio_can_edit', 'hq_gov_studio_require', 'hq_gov_studio_project',
     'hq_gov_studio_check', 'hq_gov_studio_audit', 'hq_gov_studio_create_structure', 'hq_gov_studio_create_draft',
     'hq_gov_studio_save_draft', 'hq_gov_studio_transition', 'hq_gov_studio_publish', 'hq_gov_studio_add_relation_type')) as functions_15,
  (select count(*) from pg_trigger where tgname in
    ('trg_hq_gov_appointment_version_stamp', 'trg_hq_gov_delegation_version_stamp', 'trg_hq_gov_structure_version_guard')) as triggers_3,
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in
    (('hq_gov_body', 'structure_code'), ('hq_gov_body', 'introduced_version_id'), ('hq_gov_seat', 'appointment_requirements'),
     ('hq_gov_delegation', 'is_active'), ('hq_gov_delegation', 'decided_version_id'), ('hq_gov_link', 'is_active'),
     ('hq_gov_seat_appointment', 'structure_version_id'), ('hq_gov_seat', 'retired_version_id'))) as columns_8;
