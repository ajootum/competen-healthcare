-- ============================================================
-- MIGRATION 368: WHO WROTE THIS ACCESS PERIOD (CPR-PD-PROV-001 s12, ADR-015)
--
-- ADR-015 settled the precedence between billing state, manual entitlement and administrative
-- suspension, and closed with one stated limit: authority was judged per WORKSPACE -- "does a live paid
-- subscription exist" -- because no column recorded which source wrote a given period. This is that
-- column, and it moves the judgement to where the rule actually belongs.
--
-- ---- WHY PER-PERIOD IS DIFFERENT, AND NOT MERELY MORE PRECISE ------------------------------------
--
-- Per-workspace, every period of a practice that has ever paid is treated as billing-authoritative.
-- So a Director who grants a 14-day courtesy extension AFTER a subscription lapses is asked to
-- acknowledge that they are overriding a payment -- when the period they are shortening is their own
-- goodwill, and the payment they are said to be overriding ended weeks ago. The acknowledgement would
-- be false, and a false warning is worse than none: it is the one people learn to click through.
--
-- Per-period, the question becomes the true one -- is THIS period the one somebody paid for.
--
-- ---- FOUR VALUES, AND THE FOURTH IS AN ADMISSION -------------------------------------------------
--
-- provisioning  the first period of a practice, from the provisioning saga.
-- payment       a settled checkout. The only value that carries billing authority.
-- director      a Product Director acting from the access card. A promotion is one of these --
--               there is no separate promotional source in this schema, which ADR-015 records.
-- unknown       written before this column existed. NOT a guess dressed as a fact.
--
-- Every row that exists today is backfilled to `unknown` rather than inferred. The one live period
-- almost certainly came from provisioning -- but "almost certainly" is how a guess becomes a record,
-- and this codebase renders missing evidence as missing rather than substituting a plausible value.
--
-- It is safe here, and the safety was measured rather than assumed: practice_checkout and
-- practice_subscription are both EMPTY in production, so no existing period can be one somebody paid
-- for, and `unknown` therefore withholds no billing authority that any row actually has.
--
-- ---- NOT NULL, AND NO DEFAULT --------------------------------------------------------------------
--
-- A default would let a future writer forget to say where a period came from and have the database
-- quietly answer for it. With no default and NOT NULL, an insert that omits the source FAILS -- the
-- state is unrepresentable rather than merely discouraged. Every insert path was checked first: after
-- this migration exactly one function writes this table (openAccessPeriod), and no harness or seed
-- script inserts into it.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

alter table practice_entitlement
  add column if not exists source text;

-- Backfill BEFORE the not-null, or the alter refuses on every existing row.
update practice_entitlement
   set source = 'unknown'
 where source is null;

alter table practice_entitlement
  drop constraint if exists practice_entitlement_source_check;

alter table practice_entitlement
  add constraint practice_entitlement_source_check
  check (source in ('provisioning', 'payment', 'director', 'unknown'));

alter table practice_entitlement
  alter column source set not null;

-- Verification: the column exists, refuses null, carries no default, and every row has a value from
-- the closed list.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'practice_entitlement'
   and column_name = 'source';

select conname
  from pg_constraint
 where conname = 'practice_entitlement_source_check';

select source, count(*) as periods
  from practice_entitlement
 group by source
 order by source;

notify pgrst, 'reload schema';
