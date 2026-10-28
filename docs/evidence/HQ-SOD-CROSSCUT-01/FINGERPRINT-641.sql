-- FINGERPRINT-641: read-only. Expect 0 | 0 | 0 | 0 | 0 before 641 (and after its rollback), 7 | 4 | 3 | 5 | 1 after.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in
    (('ogs_office_appointments', 'capability_scope'), ('ogs_office_appointments', 'is_primary'), ('ogs_office_appointments', 'authorised_by'),
     ('ogs_office_appointments', 'authorised_at'), ('hq_position', 'max_holders'), ('hq_position', 'primary_policy'),
     ('hq_position', 'scoped_appointments'))) as columns_7,
  (select count(*) from pg_proc where proname in
    ('hq_appointment_in_force', 'hq_appointment_rules_guard', 'hq_appointment_audit', 'hq_position_admin_set_rules')) as functions_4,
  (select count(*) from pg_trigger where not tgisinternal and tgname in
    ('trg_hq_appointment_rules_guard', 'trg_hq_appointment_audit', 'clinical_review_decision_scope_guard')) as triggers_3,
  (select count(*) from pg_proc where proname in ('ckri_holds_capability', 'individual_holds_capability', 'learning_holds_capability',
     'competency_appointment_holds', 'hq_gov_studio_can_edit') and prosrc like '%hq_appointment_in_force%') as narrowed_5,
  (select count(*) from hq_position p where p.code = 'scholar_clinical_lead' and (to_jsonb(p) ->> 'scoped_appointments') = 'true') as scholar_scoped_1;
