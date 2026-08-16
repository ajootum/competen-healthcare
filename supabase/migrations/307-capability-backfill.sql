-- 307 -- capability backfill: the catalog grew without one, and existing practices never got the
-- new capabilities.
--
-- THE FINDING (2026-08-16, caught by the lifecycle harness, the one harness that REUSES an old
-- workspace instead of provisioning fresh): capability resolution reads per-membership
-- practice_role_assignment rows, which are copied from the practice_role_capabilities catalog AT
-- PROVISION TIME. Migrations 303 and 305 added billing.view, fee.manage, invoice.draft,
-- invoice.issue, payment.record, billing.adjust, billing.export and cohort.manage to the CATALOG
-- ONLY -- so every membership provisioned before them lacks all eight, the Payments navigation is
-- invisible on those practices, and every billing API refuses. Every other harness provisions a
-- fresh workspace, which is exactly why none of them could see it.
--
-- This is migration 192's own lesson recurring, and this file is 192's own statement verbatim:
-- reach every ACTIVE membership, grant whatever its role holds in the catalog that the membership
-- does not already hold. One statement heals 303, 305 and any other catalog growth that skipped a
-- backfill, and re-running it is a no-op via the not-exists guard.

insert into practice_role_assignment (membership_id, capability_code, source)
select m.id, c.capability_code, 'role_default'
from practice_membership m
join practice_role_capabilities c on c.role_code = m.role_code
where m.status = 'active'
  and not exists (
    select 1 from practice_role_assignment a
    where a.membership_id = m.id and a.capability_code = c.capability_code and a.effective_to is null
  );

notify pgrst, 'reload schema';
