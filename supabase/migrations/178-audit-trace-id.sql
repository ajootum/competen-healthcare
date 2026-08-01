-- ============================================================
-- MIGRATION 178: TRACE IDS ON THE AUDIT TRAIL (XWI P2-15)
--
-- domain_events has carried a `trace_id` column since migration 102, the emitter has accepted one since it
-- was written, and src/lib/cgr/integration.ts COUNTS how many events have one and reports it as a
-- traceability figure. Nothing has ever set it. So that figure has been zero since the day it shipped, and
-- reads as "this platform has no distributed tracing" rather than "nobody filled the field in" -- the same
-- shape as the assessment.completed payload that had a consumer, a producer and no contract.
--
-- audit_log has no equivalent column at all, which is the half that matters most: an override, the event
-- it raises, and the remediation that follows are three rows in two tables with nothing joining them. You
-- can see that a supervisor overrode a competency gate, and separately that a remediation card appeared,
-- and not that one caused the other.
--
-- text, not uuid, to match domain_events.trace_id exactly -- a join across two columns of different types
-- is the kind of detail that quietly turns a trace into a full scan.
--
-- Additive and idempotent.
-- ============================================================

alter table audit_log add column if not exists trace_id text;

create index if not exists idx_audit_log_trace on audit_log(trace_id) where trace_id is not null;
create index if not exists idx_domain_events_trace on domain_events(trace_id) where trace_id is not null;

notify pgrst, 'reload schema';
