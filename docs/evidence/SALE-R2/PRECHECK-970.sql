-- PRECHECK-970 (SALE-2026-11 R2, SALE-10). READ ONLY. APPLY THIS FILE WHOLE (it holds a DO block).
-- It always ends by raising PRECHECK-970 with what it found, so the runner rolls back and prints the line. Nothing is written.
do $$
declare
  r text;
begin
  select concat_ws(' | ',
    'table=' || (to_regclass('public.individual_scholar_transfer_check') is not null),
    'session_table=' || (to_regclass('public.individual_scholar_revision_session') is not null),
    'session_id_user_ux=' || (to_regclass('public.ux_individual_scholar_revision_session_id_user') is not null),
    'session_item_question_ux=' || (to_regclass('public.ux_individual_scholar_revision_session_item_question') is not null),
    'attempt_session_col=' || exists (select 1 from information_schema.columns where table_name = 'individual_scholar_attempt' and column_name = 'revision_session_id'),
    'sessions=' || (select count(*) from individual_scholar_revision_session),
    'session_items=' || (select count(*) from individual_scholar_revision_session_item),
    'rows=' || case when to_regclass('public.individual_scholar_transfer_check') is null then 'n/a'
                    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from individual_scholar_transfer_check', false, true, '')))[1]::text end)
  into r;
  raise exception 'PRECHECK-970 %', r;
end $$;
