-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql function body between dollar quotes. A runner that splits
-- on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 941: COMPETENCY FRAMEWORKS ON THE APPROVED TWO-PERSON PUBLICATION PRINCIPLE
--
-- Owner follow-up to UNIFIED-GOVERNANCE-V1 (3 Nov 2026, item 6): align competency frameworks with the two-person
-- principle. Person A authors and publishes. Person B independently reviews and approves. A may publish only
-- the exact independently approved version. Professional reviewer eligibility (395 clinical reviewer scopes,
-- NOT_AUTHORSHIP, the 640 decision guard across every version), the specialist approval requirement (466:
-- every competency clinically approved at its current content before publication) and actor-level
-- separation of duties are unchanged. Staging first. Production is applied by the owner on a separate GO.
-- Build record: docs/evidence/UNIFIED-GOVERNANCE-V1/941-build-record.md.
--
-- DEPENDS ON 640 (frameworks_sod_publication_guard, hq_sod_content_rule, frameworks.published_by), 395
-- (clinical_content_version, clinical_review_decision) and 466 (cfca_framework_publication_guard). APPLY
-- AFTER 940. Re-running it is a no-op. It changes no row.
--
-- WHAT CHANGES. frameworks_sod_publication_guard is replaced whole with two refusals removed: the one for the
-- person who put the framework forward and the one for a contributor in the audit trail. What stays: a
-- publication records its publisher, a stale publisher is cleared on any non-publication, and where the
-- content rule publisher_not_approver is on, the publisher may not be one of the clinical approvers of the
-- framework's competencies (one person never both approves and releases). Independence of the approvals
-- themselves is enforced by clinical_review_decision_sod_guard (640), and 466 refuses a publication while
-- any competency is not approved at its current content, so what is published is exactly what was
-- independently approved.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/UNIFIED-GOVERNANCE-V1/ROLLBACK-941.sql
-- ====================================================================================================

create or replace function public.frameworks_sod_publication_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ids uuid[];
begin
  if new.pub_status is distinct from 'published' then
    -- A publisher is recorded only on a publication, so a stale one can never authorise the next.
    new.published_by := null;
    return new;
  end if;
  if new.hospital_id is not null or new.competency_layer is null then
    return new;
  end if;
  if old.pub_status is not distinct from 'published'
     and new.version_major is not distinct from old.version_major and new.version_minor is not distinct from old.version_minor
     and new.version_revision is not distinct from old.version_revision then
    return new;
  end if;
  if new.published_by is null then
    raise exception 'framework publication: a publication must record its publisher';
  end if;
  -- 941: the submitter and the contributors may publish the exact independently approved content. The approvals
  -- are independent by the 640 decision guard, and 466 refuses a publication while any competency is unapproved
  -- at its current content.
  v_ids := array[new.id]
    || coalesce((select array_agg(d.id) from framework_domains d where d.framework_id = new.id), '{}')
    || coalesce((select array_agg(c.id) from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = new.id), '{}');
  if exists (select 1 from hq_sod_content_rule r where r.content_kind = 'competency_framework' and r.publisher_not_approver)
     and exists (select 1 from clinical_content_version ccv join clinical_review_decision d on d.version_id = ccv.id
                  where d.reviewer_id = new.published_by and d.decision = 'approved' and ccv.competency_id = any(v_ids)) then
    raise exception 'framework publication: not independent. For frameworks the publisher may not be one of the clinical approvers of its competencies';
  end if;
  return new;
end;
$$;

comment on function public.frameworks_sod_publication_guard() is
  'Owner 2026-11-03 (UNIFIED-GOVERNANCE-V1 item 6, migration 941). The author or submitter may publish the exact independently approved content. The publisher is recorded, a stale publisher is cleared, and where configured the publisher may not be one of the clinical approvers.';

notify pgrst, 'reload schema';
