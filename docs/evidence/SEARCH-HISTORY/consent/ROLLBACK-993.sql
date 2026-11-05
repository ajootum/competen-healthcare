-- ROLLBACK-993: return the consent CHECK and the two history foreign keys to their state before 993.
-- APPLY THIS FILE WHOLE (it holds a DO block).
-- Refuses once a learner has made this choice: that row is their record, and removing it is an owner decision made by hand.
-- Set the key scholar_search_history OFF first. Deleting a material then clears the link again and keeps the words, as 992 did.
do $$
begin
  if exists (select 1 from individual_scholar_consent where feature = 'scholar_search_history') then
    raise exception 'ROLLBACK-993 refused: search history choices exist';
  end if;
end $$;

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_feature_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_feature_check
  check (feature in ('ai_processing_uploads', 'ai_cross_experience_context'));

comment on column individual_scholar_consent.feature is
  'ai_processing_uploads (372): AI may read the person own Scholar uploads. ai_cross_experience_context (700): Personal AI in Scholar may read the person own Professional development needs, goals and plans. Each is granted and revoked separately.';

alter table individual_scholar_search_history drop constraint if exists individual_scholar_search_history_material_fk;
alter table individual_scholar_search_history add constraint individual_scholar_search_history_material_fk
  foreign key (material_id, user_id) references individual_scholar_material(id, user_id) on delete set null (material_id);

alter table individual_scholar_search_history drop constraint if exists individual_scholar_search_history_session_fk;
alter table individual_scholar_search_history add constraint individual_scholar_search_history_session_fk
  foreign key (session_id, user_id) references individual_scholar_learning_session(id, user_id) on delete set null (session_id);

notify pgrst, 'reload schema';
