-- ====================================================================================================
-- MIGRATION 1010: COMPETEN SCHOLAR -- WHOLE SLIDES DRAWN FROM THE OWN FILE OF THE LEARNER (SCHOLAR-VISUAL-001 PHASE 2)
--
-- Owner decision of 6 Nov 2026: "Proceed with faithful original-slide rendering and remaining visual-content improvements
-- in phases." Standard: if individual-object extraction cannot reliably preserve the educational meaning, render the complete
-- original slide or page. Never create a synthetic replacement for the original picture.
--
-- 1. individual_scholar_material_render holds one row per material: the record that its slides were drawn once, by what, and
--    where each image is stored. It exists so that drawing happens at most once and is never repeated by a page view. The
--    primary key on material_id is the claim: two requests cannot both start, because the second insert finds the row.
--
-- 2. THE PRIVATE BUCKET TAKES image/webp. A drawn slide is stored beside the file it came from, in the same private bucket,
--    in the folder of the learner. Lossless WebP keeps every pixel of the drawn slide at about a third of the PNG size.
--    Nothing else about the bucket changes: it stays private and keeps its size limit.
--
-- PRIVATE AND ERASABLE. Read own, one policy, as 372. No write policy, so only the server can write. The row goes with its material by cascade. The stored
-- images are removed by the store first, in deleteMaterial and eraseAllMaterial, using the paths in this row. Nothing here is
-- read by Professional, by any employer surface or by the HQ plane. No AI: drawing a slide calls no model.
--
-- APPLY ON STAGING ONLY. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Depends on 372, 405, 406, 413. Re-running it
-- is a no-op. Rollback: docs/evidence/SCHOLAR-VISUAL-001/ROLLBACK-1010.sql (refuses while any drawn slide is on record).
--
-- FAIL CLOSED WITHOUT IT. Policy scholar_whole_slides defaults off. With the policy on and this file absent, the claim fails, no
-- drawing starts, and learners see the original pictures exactly as they do today.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No function. No partial unique index. notify pgrst last.
-- ====================================================================================================

create table if not exists individual_scholar_material_render (
  material_id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'running',
  attempts integer not null default 1,
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  engine text not null,
  units jsonb not null default '[]'::jsonb,
  not_drawn jsonb not null default '[]'::jsonb,
  reason text,
  constraint individual_scholar_material_render_material_fk foreign key (material_id, user_id)
    references individual_scholar_material(id, user_id) on delete cascade
);

alter table individual_scholar_material_render drop constraint if exists individual_scholar_material_render_status_check;
alter table individual_scholar_material_render add constraint individual_scholar_material_render_status_check
  check (status in ('running', 'done', 'partial', 'failed'));

alter table individual_scholar_material_render drop constraint if exists individual_scholar_material_render_attempts_check;
alter table individual_scholar_material_render add constraint individual_scholar_material_render_attempts_check
  check (attempts between 1 and 3);

alter table individual_scholar_material_render drop constraint if exists individual_scholar_material_render_units_check;
alter table individual_scholar_material_render add constraint individual_scholar_material_render_units_check
  check (jsonb_typeof(units) = 'array' and jsonb_typeof(not_drawn) = 'array');

create index if not exists individual_scholar_material_render_user_idx
  on individual_scholar_material_render (user_id);

alter table individual_scholar_material_render enable row level security;

drop policy if exists individual_scholar_material_render_read_own on individual_scholar_material_render;
create policy individual_scholar_material_render_read_own on individual_scholar_material_render
  for select using (user_id = auth.uid());

update storage.buckets
  set allowed_mime_types = array(select distinct m from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['image/webp']) as m order by m)
  where id = 'individual-scholar-materials';

notify pgrst, 'reload schema';
