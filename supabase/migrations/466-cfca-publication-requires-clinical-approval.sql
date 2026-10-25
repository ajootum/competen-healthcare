-- ====================================================================================================
-- MIGRATION 466: CFCA PUBLICATION REQUIRES EXACT-VERSION INDEPENDENT CLINICAL APPROVAL
--
-- !! APPLY THIS FILE WHOLE. It contains one plpgsql trigger function. A runner that splits on
-- !! semicolons would cut its body in half. Paste the entire file into the SQL editor and run it.
--
-- Owner, COMPETEN CFCA -- COMPLETE PRODUCTION AUTHORING CAPABILITY (25 Oct 2026), requirement 5: "Allow
-- authoring without clinical approval, but require the existing independent clinical-review process before
-- governed publication." Staging first. Production needs its own owner GO.
-- Build record: docs/evidence/CFCA/465-build-record.md (it covers 465 and 466).
--
-- DEPENDS ON 395 (competency_content_hash, clinical_content_version, clinical_review_decision), 422
-- (clinical_content_version.content_kind) and 384 (frameworks.competency_layer). Independent of 465.
-- Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY. Clinical approval (395) and publication (the governed framework lifecycle) were kept separate, and
-- nothing stopped a CFCA framework being published with competencies nobody had clinically approved.
--
-- WHAT IT ADDS.
--   competency_clinically_approved(id)   true when a 395 version of the competency CURRENT content exists
--                                        with its required independent approvals and no rejection. The
--                                        same predicate as case_library_approved (422), for a competency.
--   cfca_framework_publication_guard     on frameworks, before insert or update of pub_status. A SHARED
--                                        framework with a CFCA layer (hospital_id null, competency_layer
--                                        set) that OWNS competencies may become published only when every one
--                                        of them is clinically approved at its current content. A change after
--                                        approval makes the content a new version, so it must be approved
--                                        again before it can be published.
-- What it does NOT change: authoring (no approval needed), the 395 guards and independence rules, the
-- governance approval of the lifecycle, hospital frameworks, shared frameworks with no CFCA layer (the
-- existing library), controlled catalogues (394) -- they own no competencies, they NAME them with a content
-- status, so a layered catalogue such as SCH-RESPCARD keeps its 394 rules -- and every row
-- already published (the guard acts on the act of publishing, not on what is already there).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA/ROLLBACK-466.sql
-- VERIFY:             docs/evidence/CFCA/VERIFY-466.sql
-- ====================================================================================================

create or replace function public.competency_clinically_approved(p_competency uuid)
returns boolean
language sql
stable
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
      from clinical_content_version ccv
     where ccv.content_kind = 'competency' and ccv.competency_id = p_competency
       and ccv.content_hash = public.competency_content_hash(p_competency)
       and not exists (select 1 from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'rejected')
       and (select count(*) from clinical_review_decision d where d.version_id = ccv.id and d.decision = 'approved') >= ccv.required_approvals
  )
$$;

create or replace function public.cfca_framework_publication_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_total integer;
  v_unapproved integer;
begin
  if new.pub_status is distinct from 'published' or new.hospital_id is not null or new.competency_layer is null then
    return new;
  end if;
  select count(*), count(*) filter (where not public.competency_clinically_approved(c.id))
    into v_total, v_unapproved
    from framework_competencies c
    join framework_domains d on d.id = c.domain_id
   where d.framework_id = new.id;
  -- A framework that owns no competencies is a controlled catalogue (394) or empty: not content to approve here.
  if v_total = 0 then
    return new;
  end if;
  if v_unapproved > 0 then
    raise exception 'cfca publication: % of % competencies are not clinically approved at their current content', v_unapproved, v_total;
  end if;
  return new;
end
$$;

drop trigger if exists trg_cfca_framework_publication_guard on frameworks;
create trigger trg_cfca_framework_publication_guard
  before insert or update of pub_status on frameworks
  for each row execute function public.cfca_framework_publication_guard();

grant execute on function public.competency_clinically_approved(uuid) to service_role;

comment on function public.cfca_framework_publication_guard() is
  'Owner 2026-10-25 (COMPLETE PRODUCTION AUTHORING CAPABILITY, req 5). A shared CFCA framework is published only when every competency is clinically approved (395) at its current content.';

notify pgrst, 'reload schema';
