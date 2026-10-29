# AI educational guidance, Supervised Pilot mode, cross-experience consent: build record (29 Oct 2026)

**Authority:** three owner GOs on 29 Oct 2026:
- "Personal AI educational guidance";
- "AI supervised pilot mode";
- "Cross-experience Personal AI context", approved subject to explicit individual consent.

## Migration 700: `supabase/migrations/700-individual-cross-experience-ai-consent.sql`

- **sha256:** `eef4c8ba511c109e15c9239c334d96890b93f2e77ac74a17a654374d128ed26f`.
- **Change:** one widened CHECK on `individual_scholar_consent`, adding the feature `ai_cross_experience_context`. OPS-001 Low.
- **Order:** depends on 372 only. Independent of 680 and 690.
- **Staging (ezhvpgtcqcdsgylrxgdb):**
  1. applied twice;
  2. `ROLLBACK-700.sql` rehearsed, restoring the 372 CHECK, and its refusal guard checked;
  3. re-applied.
  House rules ALL CLEAR.
- **Production: NOT applied.** It needs a separate owner GO.
- **Without 700:** a grant fails the CHECK, so the consent cannot be turned on, and Personal AI reads nothing across experiences.

## Configuration only (no migration)

- **Risk rules:** `scripts/ai-pilot-policy.ts`, applied as drafts by `scripts/apply-ai-pilot-drafts.ts`. Staging is drafted, published and verified. Production SQL is `RELEASE-2026-10-25/PENDING-20/AI-PILOT-DRAFTS.sql` (drafts only).
- **Operating mode document:** `ai.mode.scholar` (scope platform / ai_modes). Strict Production for everyone until the owner names a cohort.
- **Cross-experience offer:** optional `PENDING-20/AI-CROSS-EXPERIENCE-DRAFT.sql`. It adds `own_development` to the Scholar assistant profile. Each learner must still opt in.

## Proved by tests

- `src/lib/ai/operating-mode.test.ts` (13): the screenshot question, clinical precedence, the pilot only for the named cohort, clarify then clinical-educational, real-patient, administration, urgent-direction and personal-safety requests refused in every mode, study urgency not clinical urgency, and the activity floor never clarified down.
- `src/lib/ai/modes-admin.test.ts` (11).
- `src/lib/individual/own-learning.test.ts` (11, including the consent).
- Harnesses: ai-fair-use 65/0 (re-pinned to the moved gate, and the tamper controls still fail), scholar-learning 160/0, individual-foundation 74/0, and the CI subset.
