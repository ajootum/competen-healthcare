-- ============================================================
-- MIGRATION 024: latest_decisions view (performance)
-- "Latest decision per nurse+competency" was recomputed in JS by at
-- least six callers scanning the full table. This view resolves it
-- in SQL once, and lets engines filter server-side.
-- Additive & idempotent.
-- ============================================================

create or replace view latest_decisions as
select distinct on (nurse_id, competency_id) *
from competency_decisions
order by nurse_id, competency_id, created_at desc;

grant select on latest_decisions to authenticated;
grant select on latest_decisions to service_role;

notify pgrst, 'reload schema';
