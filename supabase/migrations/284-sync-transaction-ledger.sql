-- 284 - THE INBOUND SYNCHRONISATION LEDGER
-- CP-OFFLINE-SURVEY-001 s5 precondition 3 (idempotent server acceptance), COMP-SYNC-001 s5 and s9,
-- CP-SYNC-001 s3 (idempotent processing), COMP-SEC-001 s8 (replay attack protection).
--
-- ====================================================================================================
-- WHAT THIS IS FOR, IN ONE SENTENCE: A RETRY MUST NOT CREATE A SECOND ENCOUNTER.
--
-- A device that captured work offline uploads it when it can. Uploads fail halfway, connections drop
-- after the server committed but before the client heard, and the client retries because from where it
-- sits nothing arrived. Without a ledger the second attempt creates a second encounter, and the patient
-- record now has two consultations that happened once.
--
-- !! THE TRANSACTION ID IS GENERATED ON THE CLIENT AND IT IS THE IDEMPOTENCY KEY. A server-generated id
-- cannot do this job: by the time the client learns it, the thing it identifies has already happened,
-- which is exactly the case a retry exists for. So `id` here is a uuid the device minted before it ever
-- had a connection, and the primary key is what makes a repeat harmless.
--
-- ====================================================================================================
-- !! WHY practice_domain_event IS NOT THIS TABLE, HAVING LOOKED.
--
-- practice_domain_event (migration 233) and domain_events (102) are OUTBOUND logs - things the server
-- decided had happened, waiting to be published to consumers. Their idempotency index exists to stop a
-- consumer processing the same emission twice. This table is the opposite direction: untrusted inbound
-- claims from a device, needing a verdict recorded against each one. Reusing 233 would put client
-- assertions and server facts in one table, and the closed 34 type CHECK on event_type would have to be
-- widened to admit entity mutations, which would then let any writer emit a fake domain event.
--
-- ====================================================================================================
-- !! THE PRIMARY KEY IS (workspace_id, id) AND NOT id ALONE, FOR A SECURITY REASON.
--
-- With a global primary key on id, a caller in workspace B could submit a transaction id belonging to
-- workspace A. The insert would collide, the endpoint would treat it as a repeat, and it would return
-- workspace A results to workspace B - a cross tenant probe with a clean 200. Scoping the key to the
-- workspace makes the collision impossible rather than making it somebody elses job to remember to
-- filter. Two workspaces may hold the same uuid independently and neither can see the other.
--
-- ====================================================================================================
-- !! THE PAYLOAD IS NOT STORED HERE, AND THAT IS DELIBERATE.
--
-- The obvious design keeps the submitted payload for replay and debugging. It would also copy clinical
-- content into a second table that no clinical screen reads, that no retention rule covers, and that
-- would outlive the record it describes. It is not needed: an APPLIED transaction put its content in the
-- real table, and a REFUSED one is still held on the device, because outbox-model.ts refuses to delete
-- anything not delivered. The device is the right custodian of work the server would not take.
--
-- What is kept is payload_hash, so COMP-SEC-001 s8 transaction integrity validation has somewhere to
-- land, and so a support question of the form did this device send the same thing twice can be answered
-- without holding the thing.
--
-- ====================================================================================================
-- !! WHAT IS NOT CONSTRAINED, AND WHY, BECAUSE THE OBVIOUS CONSTRAINT WOULD BREAK A REAL CASE.
--
-- There is NO unique index on (workspace_id, device_id, client_sequence), even though the client
-- allocates that sequence monotonically and a duplicate would indicate a client bug. A device that is
-- reinstalled, or whose browser storage is cleared, starts its sequence at 1 again - and every one of
-- those numbers is already in this table from before. A uniqueness rule would refuse every upload from
-- that device forever, and the practitioner would have no way to tell why. The sequence is an ORDERING
-- HINT within an upload, not a key, and it is indexed rather than enforced.
--
-- ====================================================================================================
-- RETENTION IS NOT SET HERE, AND THAT IS A KNOWN OPEN ITEM RATHER THAN AN OVERSIGHT. Deleting a row
-- restores the duplicate it was preventing, so the safe retention is longer than any device could
-- plausibly hold an unsent transaction. There is no cron in this migration and no purge function,
-- because choosing that window is a decision about how long a device may be away and it has not been
-- taken. The table grows until it is.
--
-- House rules obeyed: ASCII only, plain idempotent statements, no plpgsql, no do blocks, RLS on the
-- table, notify pgrst last, and NO SEMICOLON ANYWHERE EXCEPT ENDING A STATEMENT - INCLUDING INSIDE A
-- COMMENT, because the runner splits the file on semicolons and one inside a comment silently drops the
-- statements around it while still reporting Success. No rows returned.
-- ====================================================================================================

create table if not exists practice_sync_transaction (
  -- Minted on the device before it had any connection. See the header.
  id uuid not null,
  workspace_id uuid not null references practice_workspace(id) on delete cascade,

  -- COMP-SYNC-001 s5 tenant, user and device. device_id is the practice_session cookie value, text,
  -- and NOT a fingerprint - device-register.ts refuses fingerprinting on principle.
  device_id text not null check (char_length(btrim(device_id)) between 1 and 200),
  actor_id uuid,

  entity_type text not null check (char_length(btrim(entity_type)) between 1 and 64),
  entity_id uuid not null,
  operation text not null,

  -- The version the practitioner was looking at when they acted. Null for a create, which has no prior
  -- version. Required for an update - see the constraint below for why that is a safety rule.
  base_version integer,

  -- COMP-SYNC-001 s5 sequence number. Monotonic per device. Ordering only - see the header.
  client_sequence bigint not null,

  -- !! TWO CLOCKS, AND THEY ARE NOT THE SAME FACT. occurred_at is when the practitioner acted, which may
  -- be four days before the server heard about it, and it is what a clinical timeline must draw.
  -- received_at is when this row was written, and it is what a reader paginates. Migration 233 makes the
  -- same split for the same reason.
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),

  status text not null,

  -- The version the record ended up at, so a retry can be answered with the same result it produced the
  -- first time rather than a fresh attempt.
  applied_version integer,

  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 2000),

  payload_hash text check (payload_hash is null or char_length(btrim(payload_hash)) between 1 and 128),

  primary key (workspace_id, id)
);

-- ---- CONSTRAINTS, DROPPED THEN ADDED SO THIS FILE CAN BE CORRECTED AND RE-RUN --------------------

alter table practice_sync_transaction
  drop constraint if exists practice_sync_transaction_operation;

alter table practice_sync_transaction
  add constraint practice_sync_transaction_operation
  check (operation in ('create', 'update', 'delete'));

-- THREE VERDICTS AND NO PENDING. The server applies a transaction while it holds it, so a row in this
-- table always describes something that has already been decided. A pending state would be a row nobody
-- ever comes back to update, and a queue that looks like progress is the exact failure the outbox states
-- were designed to avoid.
alter table practice_sync_transaction
  drop constraint if exists practice_sync_transaction_status;

alter table practice_sync_transaction
  add constraint practice_sync_transaction_status
  check (status in ('applied', 'refused', 'conflict'));

-- !! A VERDICT THAT IS NOT APPLIED MUST SAY WHY, IN WORDS, AND btrim RATHER THAN is not null.
-- Migration 256 shipped archived_reason is not null believing it stopped a blank reason. A blank string
-- is not null, so an empty reason passed, and correcting it cost migration 257. A refusal whose reason
-- renders as nothing tells the practitioner their work was rejected for no stated cause.
alter table practice_sync_transaction
  drop constraint if exists practice_sync_transaction_verdict_reason;

alter table practice_sync_transaction
  add constraint practice_sync_transaction_verdict_reason
  check (
    status = 'applied'
    or (error_code is not null and btrim(error_code) <> ''
        and error_message is not null and btrim(error_message) <> '')
  );

-- An applied create or update settled on a version, and the retry answer needs it. A delete has no
-- resulting version to report, so it is exempt rather than forced to invent one.
alter table practice_sync_transaction
  drop constraint if exists practice_sync_transaction_applied_version;

alter table practice_sync_transaction
  add constraint practice_sync_transaction_applied_version
  check (status <> 'applied' or operation = 'delete' or applied_version is not null);

-- !! AN UPDATE WITHOUT A BASE VERSION CANNOT BE CONFLICT CHECKED, AND IS THEREFORE A BLIND OVERWRITE.
-- COMP-SYNC-001 s8 says never silently overwrite clinically significant data, and CP-SYNC-001 s6 says
-- never silently overwrite practitioner data. An update carrying no base version is exactly that, so the
-- database refuses it rather than trusting every future caller to remember. A create is exempt because
-- it has no prior version to carry.
--
-- !! A DELETE IS NOT COVERED BY THIS RULE, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. A delete
-- carrying no base version is also a blind write, so the strict reading would include it. It is left out
-- because a constraint that refuses a legitimate delete strands that work in the outbox permanently,
-- with no way for the practitioner to clear it, and stranding real work is the worse failure of the two.
-- Almost every removal in this product is a status change, which is an update and IS covered. A true
-- delete that arrives without a version is still conflict checked at apply time by the endpoint.
alter table practice_sync_transaction
  drop constraint if exists practice_sync_transaction_update_needs_base;

alter table practice_sync_transaction
  add constraint practice_sync_transaction_update_needs_base
  check (operation <> 'update' or base_version is not null);

alter table practice_sync_transaction
  drop constraint if exists practice_sync_transaction_create_has_no_base;

alter table practice_sync_transaction
  add constraint practice_sync_transaction_create_has_no_base
  check (operation <> 'create' or base_version is null);

-- ---- INDEXES --------------------------------------------------------------------------------------

-- The synchronisation status endpoint, COMP-SYNC-001 s10.
create index if not exists idx_practice_sync_transaction_recent
  on practice_sync_transaction(workspace_id, received_at desc);

-- Everything that did not simply apply. Partial, because in a healthy practice almost every row is
-- applied and this is the list somebody actually has to look at.
create index if not exists idx_practice_sync_transaction_attention
  on practice_sync_transaction(workspace_id, status)
  where status <> 'applied';

-- What happened to this patient, this encounter. Answers the per record status CP-SYNC-001 s7 wants.
create index if not exists idx_practice_sync_transaction_entity
  on practice_sync_transaction(workspace_id, entity_type, entity_id);

-- Ordering within one device, and the support question of what that device has sent.
create index if not exists idx_practice_sync_transaction_device
  on practice_sync_transaction(workspace_id, device_id, client_sequence);

-- ---- RLS ------------------------------------------------------------------------------------------
--
-- Enabled with NO POLICY, which denies every non service role by default. That is the posture of the
-- practice tables around it. This table is written only by the synchronisation endpoints, which hold the
-- service role and scope every statement by workspace_id themselves.
alter table practice_sync_transaction enable row level security;

notify pgrst, 'reload schema';
