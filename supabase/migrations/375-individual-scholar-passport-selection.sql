-- ====================================================================================================
-- MIGRATION 375: COMPETEN SCHOLAR -- WHICH STUDY ACHIEVEMENTS A PERSON SHOWS IN THEIR PASSPORT
--
-- COMPETEN-IND-004 (Scholar Learning MVP), owner continuation GO 2026-10-23 item 3 ("Scholar Passport
-- achievements"), COMPETEN-IND-002 s4.2 (every Passport item says where it came from), ADR-016 owner
-- ruling D6. Build record: docs/COMPETEN-IND-004-scholar-learning-mvp.md s11.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION (owner GO, item 5). It creates one new table.
-- It alters no existing table, row, policy or constraint. It depends on migration 372
-- (individual_scholar_material and its unique (id, user_id) index) and on nothing else. It does not
-- depend on 373 or 374. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- A Scholar student can choose, one achievement at a time, which of their self-directed study
-- achievements appear in their Competen Passport, and take any one of them off again, without touching
-- the study history the achievement is drawn from.
--
-- ----------------------------------------------------------------------------------------------------
-- THE SHAPE.
--
--   individual_scholar_passport_item   One row per achievement the person chose to show. Its presence IS
--                                      the choice. No row means not shown, so nothing is in the Passport
--                                      by default. Removing it is deleting the row.
--
-- An achievement is a fact derived at render time from the study history of the person (migration 372),
-- never a copy of it:
--
--   practice_questions   the person has answered practice questions written from one material
--   practice_scenarios   the person has answered practice scenarios (case questions) from one material
--
-- Both only ever grow while the material exists, so a chosen achievement cannot quietly become untrue.
-- What is shown is the label the person chose, the kind, how many were answered and when the person last
-- studied. NEVER the text of the material, a question, an answer, an explanation or anything an AI wrote.
--
-- ----------------------------------------------------------------------------------------------------
-- OWNERSHIP IS IN THE SCHEMA, NOT ONLY IN THE APPLICATION.
--
-- The composite foreign key (material_id, user_id) to individual_scholar_material(id, user_id) means a
-- row that belongs to one person but points at the material of another person cannot be stored, whoever
-- writes it. Deleting a material (the person erasing it) cascades to its Passport items, so the Passport
-- never shows an achievement whose source is gone. Removing a Passport item deletes only that item. The
-- material, its questions, answers and revision cards are untouched.
--
-- ----------------------------------------------------------------------------------------------------
-- LIVE SHARE LINKS.
--
-- A Passport link minted from Competen Professional (migration 373, individual_professional_share) shows
-- the records the person added. /verify reads THIS table each time the link is opened, so removing an item
-- takes it off every live link at once, not only off links minted afterwards. Nothing is copied into
-- passport_share_tokens.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   1. ASCII only. No semicolons inside any comment or string literal.
--   2. No plpgsql, no do-blocks, no functions. So no APPLY-WHOLE banner is required.
--   3. No partial unique indexes. Every unique index is FULL, on NOT NULL columns.
--   4. RLS ON, own-row SELECT policy only (owner ruling D6). No INSERT, UPDATE or DELETE policy.
--      Writes happen with the service role, behind requireIndividualContext("scholar"), or not at all.
--   5. notify pgrst LAST.
-- ====================================================================================================


-- ---- 1. individual_scholar_passport_item -- ONE CHOSEN ACHIEVEMENT -----------------------------------

create table if not exists individual_scholar_passport_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  material_id uuid not null,
  achievement text not null,
  label text not null,
  included_at timestamptz not null default now(),
  constraint individual_scholar_passport_item_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_passport_item drop constraint if exists individual_scholar_passport_item_achievement_check;
alter table individual_scholar_passport_item add constraint individual_scholar_passport_item_achievement_check
  check (achievement in ('practice_questions', 'practice_scenarios'));

-- The label is what a reader of the Passport sees. Trimmed, not empty, and short.
alter table individual_scholar_passport_item drop constraint if exists individual_scholar_passport_item_label_check;
alter table individual_scholar_passport_item add constraint individual_scholar_passport_item_label_check
  check (label = btrim(label) and char_length(label) between 1 and 120);

create unique index if not exists ux_individual_scholar_passport_item_choice
  on individual_scholar_passport_item(user_id, material_id, achievement);
create index if not exists idx_individual_scholar_passport_item_user
  on individual_scholar_passport_item(user_id, included_at desc);

alter table individual_scholar_passport_item enable row level security;

drop policy if exists individual_scholar_passport_item_read_own on individual_scholar_passport_item;
create policy individual_scholar_passport_item_read_own on individual_scholar_passport_item
  for select using (auth.uid() = user_id);

comment on table individual_scholar_passport_item is
  'COMPETEN-IND-004. A self-directed study achievement the person chose to show in their Competen Passport. The row is the choice: no row, not shown. Removing it deletes only this row, never the study history. The figures shown are derived from individual_scholar_attempt at render time, and /verify reads this table on every view, so a removal reaches live share links at once. Labelled self-directed, never verified.';
comment on column individual_scholar_passport_item.label is
  'The title the person chose for the Passport. It is shown to anyone they share their Passport with, so it is theirs to word, and the material''s own title is only the suggested default.';

notify pgrst, 'reload schema';
