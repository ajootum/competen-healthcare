-- ====================================================================================================
-- MIGRATION 391: COMPETEN SCHOLAR -- A LOG OF REVISION REVIEWS, AND REVISION AS A PASSPORT ACHIEVEMENT
--
-- COMPETEN-SCHOLAR-01 S5 (Learning Intelligence), owner GO: development authorised, production not.
-- Build record: docs/COMPETEN-SCHOLAR-S5-learning-intelligence.md.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION. It creates one new table, adds one unique index to
-- an existing table, and WIDENS one existing CHECK by one value. It removes nothing and rewrites no row.
-- It depends on migration 372 (individual_scholar_card, individual_scholar_material and the unique
-- (id, user_id) index of the material) and on 375 (individual_scholar_passport_item). Re-running it is a
-- no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR.
--
-- Learning Intelligence tracks learning engagement and knowledge retention separately. The answers to
-- practice questions are already a full history (individual_scholar_attempt), but a spaced-review card
-- keeps only its LATEST review (last_reviewed_at, last_quality) and a running count. So nobody could say
-- on which days a person revised, or how their recall has gone over time. This adds the missing history,
-- one row per review, from the day it is installed. Reviews made before it was installed are not
-- reconstructed: the page says when the record starts rather than inventing earlier ones.
--
--   individual_scholar_review   One row per review of one card: when, the self-graded recall (0 to 5) and
--                               the interval the schedule chose. Written by the same store call that
--                               updates the card, and by nothing else.
--
-- It also lets the person choose to show revision in their Passport, through the EXISTING path
-- (migration 375): the achievement CHECK gains 'revision_reviews', a count of reviews made on one
-- material, derived at render time from this log. Like the two existing kinds it only grows while the
-- material exists, and no recall grade or accuracy is ever shown with it.
--
-- ----------------------------------------------------------------------------------------------------
-- OWNERSHIP IS IN THE SCHEMA.
--
-- Composite foreign keys (card_id, user_id) and (material_id, user_id) mean a review that belongs to one
-- person but points at the card or material of another cannot be stored. The card side needs a unique
-- (id, user_id) on individual_scholar_card, added here as a FULL index, the pattern 372 uses for every
-- other Scholar table. Deleting a card or a material (the person erasing it) cascades to its reviews.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   1. ASCII only. No semicolons inside any comment or string literal.
--   2. No plpgsql, no do-blocks, no functions. So no APPLY-WHOLE banner is required.
--   3. No partial unique indexes. Every unique index is FULL, on NOT NULL columns.
--   4. RLS ON, own-row SELECT policy only (owner ruling D6). No INSERT, UPDATE or DELETE policy.
--   5. notify pgrst LAST.
-- ====================================================================================================


-- ---- 1. A UNIQUE (id, user_id) ON THE CARD, FOR THE COMPOSITE FOREIGN KEY -----------------------------

create unique index if not exists ux_individual_scholar_card_owner
  on individual_scholar_card(id, user_id);


-- ---- 2. individual_scholar_review -- ONE ROW PER REVIEW --------------------------------------------------

create table if not exists individual_scholar_review (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id uuid not null,
  material_id uuid not null,
  quality integer not null,
  interval_days integer not null,
  reviewed_at timestamptz not null default now(),
  constraint individual_scholar_review_card_fk foreign key (card_id, user_id)
    references individual_scholar_card(id, user_id) on delete cascade,
  constraint individual_scholar_review_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_review drop constraint if exists individual_scholar_review_values_check;
alter table individual_scholar_review add constraint individual_scholar_review_values_check
  check (quality between 0 and 5 and interval_days >= 0);

create index if not exists idx_individual_scholar_review_user
  on individual_scholar_review(user_id, reviewed_at desc);
create index if not exists idx_individual_scholar_review_material
  on individual_scholar_review(material_id, reviewed_at desc);

alter table individual_scholar_review enable row level security;

drop policy if exists individual_scholar_review_read_own on individual_scholar_review;
create policy individual_scholar_review_read_own on individual_scholar_review
  for select using (auth.uid() = user_id);

comment on table individual_scholar_review is
  'COMPETEN-SCHOLAR-01 S5. One row per spaced-review of one card: when, the self-graded recall (0 to 5) and the interval chosen. Self-directed study, never an assessment. History starts when migration 391 was installed. Separate from cdp_reinforcement_cards, which hospitals read (owner ruling D1).';


-- ---- 3. REVISION AS A PASSPORT ACHIEVEMENT (the existing 375 path, one value wider) --------------------

alter table individual_scholar_passport_item drop constraint if exists individual_scholar_passport_item_achievement_check;
alter table individual_scholar_passport_item add constraint individual_scholar_passport_item_achievement_check
  check (achievement in ('practice_questions', 'practice_scenarios', 'revision_reviews'));


-- ---- 4. VERIFICATION (read only) --------------------------------------------------------------------------

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_name = 'individual_scholar_review'
 order by ordinal_position;

select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid in ('individual_scholar_review'::regclass, 'individual_scholar_passport_item'::regclass)
 order by conname;

notify pgrst, 'reload schema';
