-- ============================================================
-- MIGRATION 215: AI CLINICAL ASSISTANT (CPR-210)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- THE ASSISTANT MAY REORGANISE WHAT IS ALREADY IN THE RECORD. IT MAY NOT ORIGINATE CLINICAL FACTS.
--
-- Everything in this module follows from that one line. Summarising a consultation the practitioner
-- wrote, drafting a referral from it, putting a plan into plain language for the patient -- all of those
-- rearrange text that a clinician already committed to. Suggesting a diagnosis, a drug, a dose, a
-- guideline or an interaction ORIGINATES a clinical fact, and this product has nothing to ground such a
-- fact in.
--
-- THAT IS WHY THERE IS NO CONFIDENCE COLUMN IN THIS FILE. The comp prints "Confidence: High -- 92%" with
-- a green bar. A language model's self-report is not a measurement of anything; it is another generated
-- token. It is also the single most dangerous figure in the design, because a green bar beside a drug
-- dose invites a clinician to trust it.
--
-- AND WHY THERE IS NO EXTERNAL CITATION COLUMN. The comp cites NICE Guideline NG59, ClinicalKey and the
-- WHO primary care guidelines. This product holds none of them. A model stating a guideline number is
-- precisely the hallucination the specification's own section 7 asks to mitigate -- and a fabricated
-- citation is WORSE than none, because it looks checkable and is not. Sources here are INTERNAL ONLY:
-- rows in this practice, recorded as ids, rendered as links the reader can open and verify.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- NOTHING THE ASSISTANT PRODUCES REACHES THE CLINICAL RECORD BY ITSELF. A response lands in
-- practice_ai_message and nowhere else; there is no foreign key from a note, a diagnosis or a document
-- back to it, and no code path that writes one. The specification's business rule -- "AI never finalises
-- clinical documentation autonomously" -- is enforced by there being no mechanism, not by a checkbox.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The consent gate -------------------------------------------------------------------------------
--
-- USING THE ASSISTANT SENDS RECORD CONTENT TO A THIRD-PARTY MODEL PROVIDER. That is a disclosure of
-- patient data outside this system, and the practitioner has to turn it on knowing that. The comp
-- carries a badge reading "Secure, private and compliant"; the honest version is a switch somebody had
-- to flip, with their name and the date against it.
--
-- OFF BY DEFAULT, and a migration must never silently enable a disclosure.

alter table practice_configuration add column if not exists ai_assistant_enabled boolean not null default false;
alter table practice_configuration add column if not exists ai_assistant_enabled_by uuid;
alter table practice_configuration add column if not exists ai_assistant_enabled_at timestamptz;
-- What they were told when they enabled it. Kept so the practice can show WHAT was consented to, not
-- merely that something was.
alter table practice_configuration add column if not exists ai_assistant_notice_version text;

-- ---- 2. Sessions ---------------------------------------------------------------------------------------
--
-- A conversation, optionally anchored to the consultation or patient it is about. The anchor is what
-- makes grounding possible: an assistant with no record in front of it can only invent.

create table if not exists practice_ai_session (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  -- A SESSION BELONGS TO ONE PERSON. It carries their questions about patients they were treating, and
  -- it is not practice-wide reading material.
  user_id uuid not null,
  patient_id uuid references practice_patient(id) on delete cascade,
  encounter_id uuid references practice_encounter(id) on delete cascade,
  task text not null default 'ask'
    check (task in ('summarise_encounter', 'summarise_history', 'draft_referral',
                    'patient_instructions', 'tidy_note', 'ask')),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_practice_ai_session_user
  on practice_ai_session(workspace_id, user_id, created_at desc);
create index if not exists idx_practice_ai_session_encounter
  on practice_ai_session(encounter_id);

-- ---- 3. Messages ---------------------------------------------------------------------------------------
--
-- Both halves of every exchange, kept in full, because "every AI interaction is auditable" means the
-- prompt as well as the answer. Reconstructing what a practitioner was told from usage counters is not
-- an audit trail.

create table if not exists practice_ai_message (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  session_id uuid not null references practice_ai_session(id) on delete cascade,
  role text not null check (role in ('practitioner', 'assistant')),
  body text not null,

  -- MODEL VERSION TRACKING, from section 7, and REAL: this is the model id the provider reported for
  -- this exact response, not a product name. The comp calls it "Competen Clinical LLM v2.1". There is no
  -- such model; there is no bespoke clinical model anywhere in this product.
  model text,
  provider text,

  -- EXPLAINABILITY, and the honest version of it. Not a rationale the model writes about itself -- which
  -- is just more generated text -- but the LIST OF RECORDS THAT WERE SENT AS CONTEXT. A reader can open
  -- every one and see for themselves what the answer was built from.
  --   [{ "kind": "encounter", "id": "...", "label": "..." }, ...]
  grounding jsonb not null default '[]'::jsonb,

  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  status text not null default 'ok' check (status in ('ok', 'refusal', 'failed', 'not_configured')),
  error_detail text,

  -- FEEDBACK, from the specification's data model. Nullable because most exchanges get none, and a
  -- default would manufacture an opinion nobody expressed.
  helpful boolean,
  feedback_note text,

  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists idx_practice_ai_message_session
  on practice_ai_message(session_id, created_at);
create index if not exists idx_practice_ai_message_ws
  on practice_ai_message(workspace_id, created_at desc);

-- NO CONFIDENCE COLUMN, NO SCORE COLUMN, NO EXTERNAL SOURCE TABLE. See the header. They are absent so
-- that a later page cannot render one by reading a field that happened to exist.

-- ---- 4. Capabilities -------------------------------------------------------------------------------------
--
-- The assistant reads consultations, so it takes encounter.list. It writes nothing clinical, so it needs
-- nothing more. Turning the disclosure ON is a different act and takes practice.settings.manage.

-- ---- 5. RLS: deny-by-default ---------------------------------------------------------------------------

alter table practice_ai_session enable row level security;
alter table practice_ai_message enable row level security;

notify pgrst, 'reload schema';
