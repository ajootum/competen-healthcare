-- ROLLBACK OF MIGRATION 700 (STAGING REHEARSAL ONLY). Restores the 372 feature CHECK exactly. Refuses once a
-- cross-experience consent row exists, so no consent record is ever lost.
do $r$
begin
  if exists (select 1 from individual_scholar_consent where feature = 'ai_cross_experience_context') then
    raise exception 'ROLLBACK-700 refused: cross-experience consent rows exist';
  end if;
end
$r$;
alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_feature_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_feature_check
  check (feature in ('ai_processing_uploads'));
comment on column individual_scholar_consent.feature is null;
notify pgrst, 'reload schema';
