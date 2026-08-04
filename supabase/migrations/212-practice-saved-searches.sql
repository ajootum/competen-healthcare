-- ============================================================
-- MIGRATION 212: SAVED SEARCHES AND SEARCH HISTORY (CPR-350)
--
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
-- A SAVED SEARCH IS A QUERY, NOT A SNAPSHOT OF RESULTS.
--
-- This is the rule the whole migration turns on, and it is a security rule before it is a design one.
-- The comp shows saved searches with counts beside them -- "High risk follow-ups 12", "Pending referrals
-- 15". If that 12 were STORED, it would have been computed for whoever saved the search, and every
-- reader afterwards would see a count of records they may have no right to open. Worse, a shared saved
-- search would become a side channel: "there are 15 pending referrals" is information about the
-- practice that a delegate with no referral access has just been told.
--
-- So nothing here stores a result, a count, or an identifier of anything found. A saved search holds the
-- QUERY TEXT AND ITS FILTERS, and running it goes through searchPractice with the CALLER's capabilities
-- -- which is the same gate every other search passes, evaluated fresh, every time.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--
-- SEARCH HISTORY IS PRIVATE TO THE PERSON WHO SEARCHED. CPR-350 s9 asks for "audit of search activity",
-- and that already exists: CPR-370's access log records reads against patients. This is a different
-- object with a different purpose -- a convenience for the person typing, showing what they looked for
-- an hour ago. A colleague being able to read it would turn a search box into a surveillance tool, and
-- the queries people type are often a patient's name.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. Saved searches ---------------------------------------------------------------------------------
--
-- PERSONAL BY DEFAULT, shareable deliberately. `shared` makes a saved search visible to the whole
-- practice -- which is safe precisely because it stores no results: a colleague opening it runs it
-- against their own permissions and sees their own answer.

create table if not exists practice_saved_search (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  query text not null check (char_length(query) between 1 and 200),
  -- Domains, a date range, whether to include inactive records. The application defines the shape; a
  -- filter it does not understand is ignored rather than obeyed, which is checked in the engine.
  filters jsonb,
  favourite boolean not null default false,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One name per person per practice. Two searches called "Pending referrals" is a list nobody can use.
create unique index if not exists idx_practice_saved_search_name
  on practice_saved_search(workspace_id, owner_id, lower(name));

create index if not exists idx_practice_saved_search_owner
  on practice_saved_search(workspace_id, owner_id, favourite);

-- ---- 2. Search history -----------------------------------------------------------------------------------
--
-- NO RESULTS AND NO IDENTIFIERS. `hit_count` is the number the searcher saw at the time and is kept only
-- so the list can say "that one found nothing" -- it is never re-shown as a current count, because it is
-- not one.

create table if not exists practice_search_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references practice_workspace(id) on delete cascade,
  user_id uuid not null,
  query text not null check (char_length(query) between 1 and 200),
  filters jsonb,
  hit_count integer,
  ran_at timestamptz not null default now()
);

create index if not exists idx_practice_search_history
  on practice_search_history(workspace_id, user_id, ran_at desc);

-- ---- 3. Capabilities -------------------------------------------------------------------------------------
--
-- search.use throughout, which is what searching already takes. Saving one is not a stronger act than
-- running it -- and a saved search grants nothing, because running it re-applies the reader's own gate.

-- ---- 4. RLS: deny-by-default -----------------------------------------------------------------------------

alter table practice_saved_search enable row level security;
alter table practice_search_history enable row level security;

notify pgrst, 'reload schema';
