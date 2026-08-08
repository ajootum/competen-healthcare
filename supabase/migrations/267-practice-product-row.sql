-- ============================================================
-- MIGRATION 267: COMPETEN PRACTICE BECOMES A PRODUCT ROW
-- docs/PCS-BILLING-SURVEY-001.md (H8 and D11), and the user's decision of 2026-08-08
--
-- ----------------------------------------------------------------------------------------------------
-- The user: "Competen Practice is one of the different products we are putting together on one Platform."
--
-- plat_products holds seven rows and Practice is not one of them: competency, mclip, lms, simulation,
-- passport, coe, pce. All seven are the competency estate. Practice has been built alongside that estate
-- for months with no row saying it exists.
--
-- WHAT THAT COSTS TODAY, in one place you can go and look: plat_feature_flags.product_code references
-- plat_products.code, so migration 260 had to write NULL for practice_offline_cache and say why in its
-- own header -- "product_code is NULL because there is no `practice` row in plat_products. The
-- `marketplace` flag sets that precedent rather than this file inventing one." This closes that.
--
-- WARNING: THIS IS THE SAFE FIRST COMMIT OF THE BILLING PROGRAMME AND IT IS SAFE PRECISELY BECAUSE IT
-- GATES NOTHING. The survey's H8 says so in terms: a product row on its own is harmless, and every other
-- step in that programme can take money or withhold service if it is half-built. A row here lets a flag
-- name Practice and lets a plan point at it later. It does not price anything, entitle anything or
-- change any behaviour. Nothing reads it on the request path.
--
-- Plain idempotent statements, ASCII only, no do-blocks, and no semicolon anywhere except ending a
-- statement -- including inside comments, which silently shredded two sections of migration 238 while the
-- editor still reported success.
-- ============================================================

-- ---- THE ROW ---------------------------------------------------------------------------------------
--
-- WARNING: default_on IS FALSE, AND is_core IS FALSE, AND BOTH MATTER.
--
-- The seven existing rows describe one estate, and four of them are default_on true because a hospital
-- buying the competency platform gets them. Practice is a DIFFERENT product bought by a DIFFERENT
-- customer -- a practitioner, not a hospital. Defaulting it on would silently offer it to every existing
-- tenant of the competency estate, which is not a pricing decision anybody made.
--
-- is_core false for the same reason: `core` in this table means "part of what the competency platform
-- IS". Practice is not part of that, and marking it core would make it undeniable to a tenant who never
-- asked for it.
--
-- sort 80 continues the existing sequence (10, 20, 30, 40, 50, 60, 70) rather than interleaving. The
-- ordering is a display concern and Practice is the newest, so it goes last until somebody decides
-- otherwise on a screen rather than in a migration.
--
-- The code is 'practice', which is what src/lib/practice/** has called this product throughout and what
-- migration 260's header already named as the missing row. The survey (D11) records that the comp draws
-- CP / CR / CL / CC / CA and that those share NOTHING with the seven live codes -- that collision is a
-- real open question about the portfolio, and it is not settled by this file. If the answer later is
-- 'CP', this row is renamed by a migration that also updates whatever references it. Today nothing
-- references it, which is the cheapest moment for that to be true.
insert into plat_products (code, name, description, is_core, default_on, sort) values
  ('practice',
   'Competen Practice',
   'Practitioner-owned clinical practice management. One record that follows the practitioner rather than the employer.',
   false,
   false,
   80)
on conflict (code) do nothing;

-- ---- WHAT THIS FILE DELIBERATELY DOES NOT DO -------------------------------------------------------
--
-- It does not backfill plat_feature_flags.product_code for practice_offline_cache. That row was written
-- with NULL deliberately and reads correctly today. Repointing it is a separate decision about whether
-- the practice launch flags belong in plat_feature_flags at all, given that practice_platform_flags is a
-- second flag system with its own three rows and its own reader. The survey's D9 covers the same
-- question for catalogues. Two flag systems is a problem to settle, not to deepen in a seed file.
--
-- It creates no plan, no price and no entitlement. plat_plans is the catalogue by the user's decision,
-- its six rows are all USD 0, and pricing waits on the currency price book and the tax jurisdiction --
-- the latter being a legal fact about Competen's registration that is not yet decided.

-- on conflict do nothing above rather than an upsert: if somebody has already created this code with a
-- different name, re-running this file must not overwrite their row underneath them.

alter table plat_products enable row level security;

notify pgrst, 'reload schema';
