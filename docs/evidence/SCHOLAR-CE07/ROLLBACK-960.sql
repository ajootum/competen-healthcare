-- ROLLBACK 960 (SCHOLAR-CE07C). Drops the in-flight upload record. Safe at any time: the routes fall back to the
-- behaviour before 960 (isNotProvisioned). Uploads in flight then finish without the single-extraction claim.
-- Objects of abandoned uploads are still removed per person on their next upload.

drop table if exists individual_scholar_upload;

notify pgrst, 'reload schema';
