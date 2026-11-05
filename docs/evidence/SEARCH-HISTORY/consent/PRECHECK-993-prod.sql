-- PRECHECK-993-prod. Counts only, no learner row or words. For the owner to run in the production SQL editor BEFORE applying 993,
-- and again after it. Expect captured_rows 0 (the key is OFF, so nothing was collected). ai_consents must be the same before and after.
select 'captured_rows' as item, count(*)::text as value from individual_scholar_search_history where origin = 'captured'
union all select 'ai_consents', count(*)::text from individual_scholar_consent where feature = 'ai_processing_uploads'
union all select 'ai_consents_v3_granted', count(*)::text from individual_scholar_consent where feature = 'ai_processing_uploads' and status = 'granted' and notice_version = 'scholar-ai-uploads-notice-v3';
