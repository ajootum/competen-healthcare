-- ============================================================
-- MIGRATION 224: THE DELIVERY CHANNEL (PIS-000 s11, s14; IAM-000 s3, s7; CPR-PRM-001 s10)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THIS DOES NOT OVERTURN THE NO-SENDING DOCTRINE. IT SATISFIES ITS PRECONDITION.
--
-- Migration 198 said it in as many words: "there is no delivery column, no channel column and no
-- sent_at, BECAUSE THERE IS NOTHING TO SEND WITH -- and a nullable sent_at sitting unused is how a
-- product ends up claiming to have messaged somebody."
--
-- The rule was never "sending is wrong". It was "do not carry fields that imply a delivery you cannot
-- perform". Now that a channel exists, the rule becomes its stricter successor:
--
--   A COLUMN ABOUT DELIVERY MAY EXIST ONLY WHERE SOMETHING ACTUALLY DELIVERS, AND IT MUST MEAN
--   EXACTLY WHAT THE PROVIDER DID -- NOT WHAT WE HOPED IT WOULD DO.
--
-- Which is why the column below is called handed_to_provider_at and not sent_at. Handing an SMS to a
-- gateway is not the same as a phone buzzing in somebody's pocket, and the two are conflated by every
-- product that calls the first one "sent". delivery_confirmed_at exists separately and is set ONLY from
-- a real receipt; on a channel that does not report receipts it stays null forever, and the channel says
-- so rather than leaving a reader to assume.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- WHAT MAY BE SENT IS A CLOSED LIST, AND CLINICAL CONTENT IS NOT ON IT.
--
-- An SMS is unencrypted and arrives on whatever handset is holding that number -- a shared family phone,
-- a stolen one, a work one. A diagnosis, a result or an appointment reason in a text message is a
-- disclosure to whoever picks it up. So the caller does NOT supply a message body: it names a PURPOSE
-- and supplies parameters, and the body is composed server-side from a fixed template. There is no code
-- path that puts caller-supplied prose into a patient's SMS.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Per-practice channel settings -------------------------------------------------------------------
--
-- Provider credentials are platform-level and live in the environment, exactly as the AI gateway's do.
-- What a PRACTICE decides is whether it sends at all, and under whose name.

create table if not exists practice_message_channel (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  kind text not null check (kind in ('sms', 'email')),

  -- OFF BY DEFAULT. Sending on somebody's behalf, under their practice's name, to their patients, is
  -- not something a migration switches on.
  enabled boolean not null default false,

  -- Who it appears to come from. A patient who receives "Your code is 481920" from an unknown number
  -- has been phished as far as they can tell.
  sender_name text,
  sender_address text,

  -- A practice can require recorded consent before anything reaches a patient. Independent of the
  -- product-wide rule below, which is not optional.
  require_consent boolean not null default true,

  enabled_at timestamptz,
  enabled_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_practice_message_channel
  on practice_message_channel(workspace_id, kind);

-- ---- 2. The message log ------------------------------------------------------------------------------------
--
-- ONE TABLE FOR WHAT WAS SENT AND WHAT WAS REFUSED. A refusal is not an absence: "why did my patient
-- never get their code" is the question this table exists to answer, and a row that was never written
-- answers it with silence.

create table if not exists practice_message (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  kind text not null check (kind in ('sms', 'email')),

  -- THE CLOSED LIST. Adding to it is a deliberate act with a template behind it; there is no 'other'.
  purpose text not null
    check (purpose in ('otp_booking', 'otp_sign_in', 'appointment_confirmation',
                       'appointment_reminder', 'appointment_cancelled', 'invitation_code')),

  -- Where it went. Kept because a wrong number is the commonest reason a message does not arrive, and
  -- the record has to show which number was actually used.
  destination text not null,
  patient_id uuid references practice_patient(id) on delete set null,

  -- Composed server-side from the purpose and its parameters. Stored so that what a patient received is
  -- answerable later -- but see the header: it can never contain clinical content, because no caller
  -- supplies prose.
  body text not null,

  status text not null default 'queued'
    check (status in ('queued', 'handed_over', 'failed', 'refused')),

  -- NOT CALLED sent_at, DELIBERATELY. See the header. This is the moment a provider accepted it, which
  -- is not the moment a phone buzzed.
  handed_to_provider_at timestamptz,
  -- Set ONLY from a real delivery receipt. On a channel that does not report them it stays null
  -- forever, and the engine reports receiptsAvailable:false rather than letting null read as failure.
  delivery_confirmed_at timestamptz,

  provider text,
  provider_message_id text,
  -- What the provider actually said, kept verbatim. A summarised error is one nobody can debug.
  provider_response text,
  -- Why this product declined to send. Populated for status='refused'.
  refused_reason text,

  created_at timestamptz not null default now(),
  created_by uuid,
  correlation_id text
);

create index if not exists idx_practice_message_ws
  on practice_message(workspace_id, created_at desc);
create index if not exists idx_practice_message_destination
  on practice_message(workspace_id, destination, created_at desc);
create index if not exists idx_practice_message_patient
  on practice_message(patient_id) where patient_id is not null;

-- ---- 3. OTP challenges (IAM-000 s7, PIS-000 s11) ----------------------------------------------------------

create table if not exists practice_otp_challenge (
  id uuid primary key default gen_random_uuid(),
  -- NULLABLE: an OTP before a booking is issued to somebody who is not yet in any practice's record and
  -- may never be. The workspace is the practice being booked with, when there is one.
  workspace_id uuid references practice_workspace(id) on delete cascade,

  purpose text not null check (purpose in ('booking', 'sign_in', 'contact_verification')),
  channel text not null check (channel in ('sms', 'email')),
  destination text not null,

  -- NEVER THE CODE ITSELF. A one-time code sitting in plaintext in a table is a credential anybody with
  -- read access can use, and read access to this table is much wider than the person it was sent to.
  -- Hashed with the row's own id as the salt, so two identical codes hash differently.
  code_hash text not null,

  expires_at timestamptz not null,
  -- Attempts are counted so a code cannot be guessed a thousand times. Six digits is a million
  -- possibilities, which a script exhausts in seconds if nothing stops it.
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  consumed_at timestamptz,

  message_id uuid references practice_message(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_otp_destination
  on practice_otp_challenge(destination, created_at desc);
create index if not exists idx_practice_otp_live
  on practice_otp_challenge(destination, purpose) where consumed_at is null;

-- ---- 4. Capabilities -------------------------------------------------------------------------------------
--
-- Turning a channel on is practice.settings.manage -- the same capability that governs the timezone and
-- the AI disclosure, and for the same reason: it changes what leaves the practice. Sending a
-- transactional message is done by the engines that own the act (booking, invitations), never by a
-- general "send a message" endpoint, because there isn't one.

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_message_channel enable row level security;
alter table practice_message enable row level security;
alter table practice_otp_challenge enable row level security;

notify pgrst, 'reload schema';
