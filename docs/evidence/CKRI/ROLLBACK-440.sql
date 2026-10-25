-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It contains a plpgsql block between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 440 (STAGING ONLY): CKRI K1 research governance.
--
-- Drops the five CKRI tables, their triggers and functions, the two positions, their grants and the two
-- capabilities. It REFUSES while any participation row exists, because those rows are choices people made.
-- Purposes and projects made on staging are lost. Reapplying 440 afterwards restores the empty schema.
-- Run 441 and later rollbacks first if they were applied (they depend on these tables).
-- ====================================================================================================

do $$
begin
  if to_regclass('public.ckri_participation') is not null and exists (select 1 from ckri_participation) then
    raise exception 'ROLLBACK-440 refused: ckri_participation has rows. These are recorded choices, so they are not dropped by a rollback';
  end if;
end;
$$;

drop table if exists ckri_participation_event cascade;
drop table if exists ckri_participation cascade;
drop table if exists ckri_research_project_event cascade;
drop table if exists ckri_research_project cascade;
drop table if exists ckri_purpose cascade;

drop function if exists public.ckri_trail_guard();
drop function if exists public.ckri_participation_record();
drop function if exists public.ckri_participation_guard();
drop function if exists public.ckri_research_project_record();
drop function if exists public.ckri_research_project_guard();
drop function if exists public.ckri_purpose_guard();
drop function if exists public.ckri_holds_capability(uuid, text);

delete from hq_position_capability where capability_code in ('hq.quality.research.govern', 'hq.quality.research.propose');
delete from hq_position_capability where position_code in ('research_governance_officer', 'research_lead');
delete from hq_position where code in ('research_governance_officer', 'research_lead')
  and not exists (select 1 from ogs_office_appointments a where a.role = hq_position.code);
delete from hq_capability where code in ('hq.quality.research.govern', 'hq.quality.research.propose');

notify pgrst, 'reload schema';
