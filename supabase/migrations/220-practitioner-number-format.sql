-- ============================================================
-- MIGRATION 220: CONFIGURABLE PRACTITIONER NUMBER FORMAT
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- "CHANGES EVERYWHERE" CANNOT MEAN REWRITING NUMBERS ALREADY ISSUED, AND THAT IS NOT A LIMITATION --
-- IT IS THE POINT OF THE NUMBER.
--
-- PIS-000 s2: permanent, never reused. An issued number is printed on cards, encoded into QR codes and
-- written into patients' phones. Rewriting CP-000001 into some new shape would break every one of them
-- and would mean the number was never permanent in the first place.
--
-- So the format governs ISSUANCE FROM NOW ON:
--   - numbers already issued are immutable and keep resolving, forever
--   - exactly ONE place in the codebase knows the shape, so a change reaches every future issuance,
--     every validator and every parser at once -- there is no 'CPR-' literal left anywhere
--   - each identity records the FORMAT VERSION it was issued under, so which shape a number follows is
--     always answerable rather than inferred from its appearance
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- THE PROPOSED FORMAT: CP-000001-4
--
--   CP        Competen Practice. NOT 'CPR', because in this repository a bare CPR-nnn is a SPECIFICATION
--             id -- CPR-240 is the portfolio spec. PIS-000 s2's CPR-000001 differs from it only by digit
--             count, which is a distinction a human skimming a log or a support ticket will miss.
--   000001    six digits from the sequence, zero-padded. Capacity 999,999 practitioners.
--   -4        A CHECK DIGIT, and this is the substantive change.
--
-- WHY A CHECK DIGIT IS NOT DECORATION. s11 says patients may find a practitioner BY NUMBER. Without a
-- check digit, CP-000132 is exactly as valid as CP-000123 and resolves to A DIFFERENT REAL CLINICIAN --
-- the patient reaches the wrong person, and nothing anywhere notices, because both numbers are real.
-- The digit is computed with Damm's algorithm, which catches every single-digit error and every
-- transposition of adjacent digits: the two mistakes people actually make when typing or reading aloud.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The format ---------------------------------------------------------------------------------------

create table if not exists practice_identifier_format (
  key text primary key,
  prefix text not null check (prefix ~ '^[A-Z]{1,6}$'),
  digits integer not null check (digits between 4 and 12),
  check_digit boolean not null default true,
  separator text not null default '-' check (separator in ('-', '/', '.', '')),

  -- Bumped on every change. Stamped onto each identity at issue, so a number's shape is recorded rather
  -- than guessed from its appearance.
  version integer not null default 1,

  -- LOCKED ONCE ANYTHING HAS BEEN ISSUED. The engine sets this the first time it allocates a number, and
  -- a locked format refuses to change without an explicit acknowledgement and a reason. Difficult to
  -- change, deliberately: this is not a display preference, it is the shape of a permanent identifier
  -- that has already left the building on paper.
  locked boolean not null default false,

  updated_at timestamptz not null default now(),
  updated_by uuid,
  change_reason text
);

-- ---- 2. History, because "who changed the shape of our numbers, and why" must be answerable ------------

create table if not exists practice_identifier_format_history (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version integer not null,
  prefix text not null,
  digits integer not null,
  check_digit boolean not null,
  separator text not null,
  -- BOTH SIDES OF THE CHANGE, the position CPR-360 took about timezones: "the prefix is CP" does not
  -- answer "why do our older numbers look different".
  previous jsonb,
  change_reason text,
  changed_at timestamptz not null default now(),
  changed_by uuid
);

create unique index if not exists ux_practice_identifier_format_history
  on practice_identifier_format_history(key, version);

-- ---- 3. The seed -----------------------------------------------------------------------------------------
--
-- Version 1 is the proposal above. `on conflict do nothing` so re-running never quietly rewrites a
-- format somebody has since agreed and changed.

insert into practice_identifier_format (key, prefix, digits, check_digit, separator, version, change_reason)
values ('practitioner_number', 'CP', 6, true, '-', 1, 'Initial format proposed with migration 220')
on conflict (key) do nothing;

-- ---- 4. The allocator returns a NUMBER, not a formatted string -------------------------------------------
--
-- Migration 219's function built the string itself, which put the format in two places at once -- the
-- database and the application -- and guaranteed they would disagree the day one changed. The database
-- now does the one thing only it can do (allocate a number that is never reused) and the application
-- does the formatting, from the table above.

drop function if exists practice_next_practitioner_number();

create or replace function practice_next_practitioner_sequence() returns bigint
language sql
security definer
set search_path = public
as $$ select nextval('practice_practitioner_number_seq') $$;

-- ---- 5. Which format each identity was issued under -------------------------------------------------------

alter table practice_practitioner_identity add column if not exists number_format_version integer;

-- ---- 6. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_identifier_format enable row level security;
alter table practice_identifier_format_history enable row level security;

notify pgrst, 'reload schema';
