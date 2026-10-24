-- ====================================================================================================
-- MIGRATION 409: COMPETEN SCHOLAR -- THE SAME FILE TWICE IS ONE MATERIAL
--
-- COMPETEN-SCHOLAR-UPLOAD-01 (owner GO 2026-10-24), U1 duplicate detection. Every material already stores
-- the sha256 of its bytes (372). The upload route refuses a file whose sha256 the person already has, and
-- sends them to the copy in their library. This index makes the second copy UNSTORABLE, so a second writer
-- that skips the check cannot create one either. Per person: two people may upload the same handout.
--
-- KEPT APART FROM 406-408 ON PURPOSE. If a person already holds two identical materials, the index cannot
-- be built: this file then fails ALONE and changes nothing, and the others are unaffected. Count first: the
-- (user_id, sha256) pairs of individual_scholar_material that occur more than once. Staging, 2026-10-24:
-- one material, no duplicates.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. LOW: one unique index (not partial). It depends on
-- 372. Re-running it is a no-op. Rollback: docs/evidence/COMPETEN-SCHOLAR-UPLOAD-01/ROLLBACK-409.sql.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. notify pgrst last.
-- ====================================================================================================

create unique index if not exists ux_individual_scholar_material_user_sha256
  on individual_scholar_material(user_id, sha256);

notify pgrst, 'reload schema';
