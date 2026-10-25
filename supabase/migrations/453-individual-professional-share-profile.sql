-- ====================================================================================================
-- MIGRATION 453: COMPETEN PROFESSIONAL -- SELECTIVE PASSPORT SHARING OF PROFILE SECTIONS
--
-- COMPETEN-PROFESSIONAL-PROFILE-01, owner continuation GO part B item 3 (25 Oct 2026): selective,
-- individual-controlled Passport sharing of professional profile sections, preserving privacy, provenance
-- and verification status. Development and staging authorised. Production needs its own GO.
-- Build record: docs/COMPETEN-PROFESSIONAL-PROFILE-01-stage1.md, section 6.
--
-- DEPENDS ON 373 (individual_professional_share) and 450 (individual_professional_profile_item).
-- Independent of 451 and 452.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT ADDS. Sharing still reuses passport_share_tokens and /verify, and a Professional link is still
-- marked by its 373 individual_professional_share row. A link now ALSO names exactly what of the profile
-- it carries, chosen by the person when they make it. Nothing is chosen by default:
--
--   individual_professional_share.profile_overview   false by default: the overview is not shared
--   individual_professional_share_item               one row per profile record version the person chose
--
-- A row names a VERSION. If the person later changes or withdraws the record, the link stops showing it
-- rather than showing words they did not choose to share. Cross-person rows are unrepresentable: both the
-- link and the record are joined on (id, user_id).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No plpgsql. No partial unique index. RLS on,
-- own-row SELECT only. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-PROFILE-01/ROLLBACK-453.sql
-- ====================================================================================================

alter table individual_professional_share add column if not exists profile_overview boolean not null default false;

create unique index if not exists ux_individual_professional_share_token_user
  on individual_professional_share(share_token_id, user_id);

create table if not exists individual_professional_share_item (
  share_token_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (share_token_id, item_id)
);

alter table individual_professional_share_item drop constraint if exists individual_professional_share_item_share_fk;
alter table individual_professional_share_item add constraint individual_professional_share_item_share_fk
  foreign key (share_token_id, user_id) references individual_professional_share(share_token_id, user_id) on delete cascade;

alter table individual_professional_share_item drop constraint if exists individual_professional_share_item_item_fk;
alter table individual_professional_share_item add constraint individual_professional_share_item_item_fk
  foreign key (item_id, user_id) references individual_professional_profile_item(id, user_id) on delete cascade;

create index if not exists idx_individual_professional_share_item_user
  on individual_professional_share_item(user_id);

alter table individual_professional_share_item enable row level security;
drop policy if exists individual_professional_share_item_read_own on individual_professional_share_item;
create policy individual_professional_share_item_read_own on individual_professional_share_item
  for select using (auth.uid() = user_id);

comment on table individual_professional_share_item is
  'COMPETEN-PROFESSIONAL-PROFILE-01 (owner GO part B). The profile record versions a person chose to carry on one Professional Passport link. None by default. Own-row read.';

notify pgrst, 'reload schema';
