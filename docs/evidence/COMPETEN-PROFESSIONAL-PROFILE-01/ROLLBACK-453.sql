-- ROLLBACK 453 (STAGING ONLY). COMPETEN-PROFESSIONAL-PROFILE-01 part B, selective sharing.
-- Removes the shared-record table (and every choice in it), the overview flag and the composite key. The
-- links themselves (passport_share_tokens, individual_professional_share) are untouched and keep showing
-- what they showed before 453. Plain statements only.

drop table if exists individual_professional_share_item;
drop index if exists ux_individual_professional_share_token_user;
alter table individual_professional_share drop column if exists profile_overview;

notify pgrst, 'reload schema';
