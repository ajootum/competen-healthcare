-- 352 STRUCTURED REFERRAL DESTINATIONS, AND THE LETTER THAT CAME FROM ONE
--
-- CPR-DOC-AUTO-001 section 16 (Search, Reuse and Frequent Destinations) and
-- section 8 (Referral Letters), Phase 1.
--
-- WHAT IS WRONG TODAY. practice_referral.referred_to is one free-text line, and
-- 195's comment defends that choice honestly: "the person or service referred to
-- may be at an institution this product has never heard of, and a foreign key to
-- a facility list would make the common case unrecordable." That reasoning still
-- holds and this migration does not overturn it. What it adds is the case the
-- free-text line cannot serve: the SAME consultant referred to for the ninth
-- time, whose address is retyped from memory every time, differently.
--
-- Section 16 asks for three things the text line cannot express:
--   - destinations that are STRUCTURED (named clinician, specialty, facility,
--     other) rather than only words inside the letter,
--   - reuse of a frequent destination without retyping the address,
--   - recipient held as metadata, so later referral tracking reads the referral
--     entity rather than parsing a letter.
--
-- HOW COMPATIBILITY IS KEPT. referred_to STAYS not-null and stays the rendered
-- recipient line. A structured destination WRITES INTO it rather than replacing
-- it. Every existing reader -- the encounter workspace referral list, the
-- {{referral.addressee}} merge field, the referral history panel -- keeps working
-- unchanged and unaware, and a referral typed free-hand remains a first-class
-- referral with destination_id null. Nothing in this file makes the free-text
-- path second class, because for a one-off destination it is still the right one.
--
-- THE DOCUMENT LINK. Section 15 requires a generated artifact to "link to the
-- originating encounter/referral/order/follow-up where applicable", so the FK
-- lives on the DOCUMENT and points back at what caused it, not the reverse. It
-- is set null on delete: withdrawing a referral must never delete the signed
-- letter that was sent about it. Only referral_id is added here -- order_id and
-- follow_up_id belong to the phases that automate those documents, and a column
-- nothing writes is a column that lies about what is implemented.

-- ---- 1. The reusable destination ------------------------------------------------

create table if not exists practice_referral_destination (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- Section 16's four kinds. 'other' is deliberate and not a failure state: a
  -- referral to "the district TB focal person" is none of the first three.
  kind text not null check (kind in ('clinician', 'specialty', 'facility', 'other')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  -- All optional. A practice that knows only a name gets a destination with only
  -- a name, rather than a form it cannot complete.
  specialty text check (specialty is null or char_length(btrim(specialty)) between 1 and 120),
  facility text check (facility is null or char_length(btrim(facility)) between 1 and 200),
  address text check (address is null or char_length(btrim(address)) between 1 and 500),
  phone text check (phone is null or char_length(btrim(phone)) between 1 and 60),
  email text check (email is null or char_length(btrim(email)) between 1 and 200),
  -- Retired rather than deleted, so the referrals that already point here keep
  -- their recipient. An inactive destination is not offered for a NEW referral.
  active boolean not null default true,
  -- Section 16's "frequently used". Maintained by the writer, not a trigger: a
  -- destination used once in 2024 should sink, and only the application knows
  -- what counts as a use.
  use_count integer not null default 0,
  last_used_on date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table practice_referral_destination enable row level security;

-- One destination per name per kind per practice. Without this the list becomes
-- forty copies of the same consultant, which is precisely the retyping section 16
-- exists to end. A collision is a REACTIVATION, and the writer handles it as one.
create unique index if not exists practice_referral_destination_unique
  on practice_referral_destination (workspace_id, kind, lower(btrim(display_name)));

-- The "frequent destinations" list, in the order it is displayed.
create index if not exists practice_referral_destination_frequent
  on practice_referral_destination (workspace_id, active, use_count desc, last_used_on desc);

-- ---- 2. The referral points at it, optionally -----------------------------------

alter table practice_referral
  add column if not exists destination_id uuid
  references practice_referral_destination(id) on delete set null;

create index if not exists practice_referral_destination_idx
  on practice_referral (workspace_id, destination_id);

-- ---- 3. The document points back at what caused it ------------------------------

alter table practice_clinical_document
  add column if not exists referral_id uuid
  references practice_referral(id) on delete set null;

create index if not exists practice_clinical_document_referral_idx
  on practice_clinical_document (workspace_id, referral_id);

notify pgrst, 'reload schema';
