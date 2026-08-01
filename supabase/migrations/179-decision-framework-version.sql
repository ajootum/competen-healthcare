-- ============================================================
-- MIGRATION 179: STAMP DECISIONS WITH THE FRAMEWORK VERSION THEY WERE MADE AGAINST (XWI P2-10, part)
--
-- competency_decisions records WHICH framework a decision belongs to (framework_id) and not WHICH VERSION
-- of it was in force when the decision was made. Frameworks carry version_major/minor/revision and a
-- pub_status, and every one of them is 1.0.0 today -- so nothing is wrong yet, and nothing is
-- reconstructable the moment a framework changes. "This nurse was found competent" is a different claim
-- from "this nurse was found competent against version 1.0.0 of this framework", and only the second one
-- survives the standard being revised.
--
-- text, holding a semver string, because that is what a reader needs to see and compare. The framework's
-- own numeric version_num is not used: it is 0 on all 15 rows, while the semver columns carry the real
-- 1.0.0, and stamping the field that is actually maintained is the point.
--
-- PURELY ADDITIVE, AND DELIBERATELY SO. Existing decisions are left null rather than backfilled with
-- today's version: they were made against whatever was in force at the time, which this database no
-- longer records, and inventing a value would make an unknown look like a fact. Null reads as "not
-- recorded", which is true.
--
-- WHAT THIS DOES NOT FIX, recorded here because the next reader will assume it did: the decision run
-- still DELETES the cycle's decisions and re-inserts them (src/lib/engines/decisions.ts), so re-running
-- erases the prior record rather than superseding it. That is the immutability half of P2-10 and it
-- changes how every consumer counts decisions, so it is a decision for the owner rather than a repair.
--
-- Additive and idempotent.
-- ============================================================

alter table competency_decisions add column if not exists framework_version text;

create index if not exists idx_competency_decisions_fw_version
  on competency_decisions(framework_id, framework_version)
  where framework_version is not null;

notify pgrst, 'reload schema';
