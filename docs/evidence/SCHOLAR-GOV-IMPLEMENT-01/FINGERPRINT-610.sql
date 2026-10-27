-- FINGERPRINT-610: read-only. Expect 0 0 0 before 610 and 8 9 3 after.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
    ('hq_gov_body', 'hq_gov_seat', 'hq_gov_seat_exclusion', 'hq_gov_seat_appointment', 'hq_gov_interest_declaration',
     'hq_gov_delegation', 'hq_gov_link', 'hq_gov_status_item')) as tables_8,
  (select count(*) from pg_proc where proname in
    ('hq_gov_seat_appointment_guard', 'hq_gov_append_only_guard', 'hq_gov_delegation_guard', 'hq_gov_admin_require',
     'hq_gov_admin_appoint', 'hq_gov_admin_end', 'hq_gov_admin_declare_interest', 'hq_gov_admin_set_delegation',
     'hq_gov_admin_set_status_item')) as functions_9,
  (select count(*) from pg_trigger where tgname in
    ('trg_hq_gov_seat_appointment_guard', 'trg_hq_gov_interest_append_only', 'trg_hq_gov_delegation_guard')) as triggers_3;
