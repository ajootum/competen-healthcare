-- ====================================================================================================
-- APPLY THIS FILE WHOLE. ROLLBACK 941 (staging rehearsal): restores frameworks_sod_publication_guard as 640 defines it.
-- ====================================================================================================
create or replace function public.frameworks_sod_publication_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_ids uuid[];
  v_submitter uuid;
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
    raise exception 'framework publication: not independent. A publication must record its publisher';
  end if;
  select ca.submitted_by into v_submitter from content_approvals ca
   where ca.framework_id = new.id and ca.status = 'pending' order by ca.submitted_at desc limit 1;
  if v_submitter is not null and v_submitter = new.published_by then
    raise exception 'framework publication: not independent. The person who put the framework forward cannot publish it';
  end if;
  v_ids := array[new.id]
    || coalesce((select array_agg(d.id) from framework_domains d where d.framework_id = new.id), '{}')
    || coalesce((select array_agg(c.id) from framework_competencies c join framework_domains d on d.id = c.domain_id where d.framework_id = new.id), '{}');
  -- Contribution, as contributorsOf reads it (src/lib/competency/framework-publication.ts).
  if exists (select 1 from audit_log a where a.actor_id = new.published_by and a.entity_id = any(v_ids)
              and coalesce(a.action, '') not in ('submit_review', 'approve_content', 'reject_content', 'publish', 'archive', 'revert',
                'catalogue_entry_review', 'clinical_review_submitted', 'clinical_review_decided', 'clinical_scope_added',
                'clinical_scope_ended', 'framework_specialty_set')) then
    raise exception 'framework publication: not independent. The publisher authored or curated content in this framework';
  end if;
  if exists (select 1 from hq_sod_content_rule r where r.content_kind = 'competency_framework' and r.publisher_not_approver)
     and exists (select 1 from clinical_content_version ccv join clinical_review_decision d on d.version_id = ccv.id
                  where d.reviewer_id = new.published_by and d.decision = 'approved' and ccv.competency_id = any(v_ids)) then
    raise exception 'framework publication: not independent. For frameworks the publisher may not be one of the clinical approvers of its competencies';
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
