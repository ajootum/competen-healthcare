-- ====================================================================================================
-- MIGRATION 590: COMPETEN INDIVIDUAL -- THE PERSONAL AND PROFESSIONAL IDENTITY HUB
-- ====================================================================================================
--
-- COMPETEN INDIVIDUAL PROFILE: FUNCTIONAL REDESIGN (owner directive, 26 Oct 2026). Build record:
-- docs/COMPETEN-INDIVIDUAL-IDENTITY-HUB-01.md. Reserved number 590. STAGING FIRST. Production only on a
-- separate owner GO.
--
-- WHAT IT ADDS, ADDITIVE ONLY. Nothing existing is changed or removed.
--   1. individual_identity_profile -- ONE row per person, shared by Scholar and Professional: preferred name,
--      headline, location, biography and a PRIVATE profile photo (its storage path). Everything optional.
--   2. The private storage bucket individual-photos (5 MB, jpeg, png, webp). Never public: the photo is
--      served only by short-lived signed URLs, to the person, and on a Passport link only where they chose it.
--   3. A skill kind on the shared profile records (450 individual_professional_profile_item.section).
--   4. individual_passport_share_view.include_photo -- the per-link choice to show the photo on a Passport
--      view. Default false. It is fixed with the rest of the view once the link is active (540's guard).
--
-- WHY NOT profiles.avatar_url. That column points at the PUBLIC avatars bucket used by the estate. A public
-- object URL is readable by anyone who holds it, so it cannot be private by default (requirement 9).
-- profiles is not touched here.
--
-- PRIVACY. RLS on, own-row SELECT only, no write policy (the app writes with the service role, scoped to the
-- person, and audits field names only). No scope, organisation or tenant column. Nothing here is shown to
-- anyone else unless the person selects it on a link.
--
-- HOUSE RULES (scripts/migration-house-rules.ts). ASCII only. No semicolons inside any comment or string
-- literal. No function, so no APPLY-WHOLE banner is required. No partial unique indexes. notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-590.sql beside this file in the build record.
-- ====================================================================================================


-- ---- 1. THE SHARED IDENTITY PROFILE -----------------------------------------------------------------

create table if not exists individual_identity_profile (
  user_id uuid primary key references profiles(id) on delete cascade,
  preferred_name text,
  headline text,
  location text,
  biography text,
  photo_path text,
  photo_mime text,
  photo_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table individual_identity_profile drop constraint if exists individual_identity_profile_lengths;
alter table individual_identity_profile add constraint individual_identity_profile_lengths check (
  char_length(coalesce(preferred_name, '')) <= 80
  and char_length(coalesce(headline, '')) <= 140
  and char_length(coalesce(location, '')) <= 120
  and char_length(coalesce(biography, '')) <= 2000
);

-- A photo is a stored object of the person's own, of an accepted type, or there is none. Every part is tested
-- with is not null: a CHECK passes on NULL, so a missing type must not slip through as unknown.
alter table individual_identity_profile drop constraint if exists individual_identity_profile_photo;
alter table individual_identity_profile add constraint individual_identity_profile_photo check (
  (photo_path is null and photo_mime is null and photo_updated_at is null)
  or (photo_path is not null and photo_mime is not null and photo_updated_at is not null
      and photo_path like (user_id::text || '/%') and photo_mime in ('image/jpeg', 'image/png', 'image/webp'))
);

alter table individual_identity_profile enable row level security;
drop policy if exists individual_identity_profile_read_own on individual_identity_profile;
create policy individual_identity_profile_read_own on individual_identity_profile for select using (auth.uid() = user_id);

comment on table individual_identity_profile is
  'COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 (590). The shared Scholar and Professional identity: preferred name, headline, location, biography and a private photo. Self-declared, never verified. Private: shown to others only where the person selects it on a Passport link.';


-- ---- 2. THE PRIVATE PHOTO BUCKET -------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('individual-photos', 'individual-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;


-- ---- 3. A SKILL KIND ON THE SHARED PROFILE RECORDS --------------------------------------------------
-- A skill is a title and an optional detail, like an interest. The 450 shape rule already keeps every other
-- column empty for it, so only the list of sections changes.

alter table individual_professional_profile_item drop constraint if exists individual_professional_profile_item_section_check;
alter table individual_professional_profile_item add constraint individual_professional_profile_item_section_check
  check (section in ('qualification', 'registration', 'employment', 'specialty', 'interest', 'aspiration', 'skill'));


-- ---- 4. THE PER-LINK PHOTO CHOICE -------------------------------------------------------------------

alter table individual_passport_share_view add column if not exists include_photo boolean not null default false;


notify pgrst, 'reload schema';
