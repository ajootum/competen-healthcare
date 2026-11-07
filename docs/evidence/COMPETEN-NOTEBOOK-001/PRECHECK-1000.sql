-- PRECHECK-1000 (read only). Whether 1000 is present, and the row counts and note text it must never change.
select (select count(*) from information_schema.columns where table_name = 'individual_scholar_note' and column_name in ('title','tags','pinned_at','client_key','revision','section_label','section_anchor','captured_in','competency_id','study_id','was_on','search_tsv')) as new_columns,
       (select count(*) from pg_proc where proname in ('individual_scholar_notebook_1000','individual_scholar_notebook_search','individual_scholar_note_search_doc','individual_scholar_note_detach_material','individual_scholar_note_detach_session')) as new_functions,
       (select count(*) from individual_scholar_note) as notes,
       (select count(*) from individual_scholar_note where kind = 'note') as note_kind,
       (select count(*) from individual_scholar_note where kind = 'highlight') as highlights,
       (select count(*) from individual_scholar_note where kind = 'bookmark') as bookmarks,
       (select count(*) from individual_scholar_note where kind = 'summary') as summaries,
       (select md5(coalesce(string_agg(id::text || coalesce(body, '') || coalesce(quote, ''), '|' order by id), '')) from individual_scholar_note) as note_text_md5,
       (select count(*) from individual_scholar_material) as materials,
       (select count(*) from individual_scholar_learning_session) as sessions;
