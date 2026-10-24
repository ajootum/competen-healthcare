# Owner decision D1: the production configuration step (NOT RUN, for the activation GO)

**Staging, done 2026-10-24:**
- `individual.policy.professional_catalogues` = CF-FOUND (`d5944ae0-a6eb-499f-92dd-99fd3b74aaf2`), set through the governed CONFIG-002 lifecycle: validateDraft, the library check, setOverride, then publishScope.
- WCE version a59ce4f1, actor "IND-007 agent session (owner decision D1, 2026-10-24)".
- `individual-professional-acceptance` passes 57/57:
  - **OD0**, with the allowlist emptied for the run: Professional still works with no catalogue.
  - **OD1**, with CF-FOUND: every offered competency shows its actual clinical review state, and none reads approved without a 395 approval.

**The production dependency (genuine):** CF-FOUND does not exist in production. It is the S1 staging seed (`scripts/seed-staging-competency-foundation.ts`, staging-only by design), and production's 15 frameworks do not include it. Before D1 can apply in production, the owner must decide how CF-FOUND reaches production:
- authored there through the existing framework studio; or
- a reviewed production seed under its own GO.

It is then published through the governed framework lifecycle, with independent approval.

**The step itself, once CF-FOUND is published in production.** It is no-code, by the Individual Product Administrator (`hq.individual.config.manage`):
1. Open `/super-admin/individual/configuration`.
2. Under "Competency catalogues Professional may offer", tick Competen Foundational.
3. Choose "Save draft", then "Publish", recording the reason.

**The same step as requests,** from that administrator's own session (the route re-checks the capability and the library):

```
POST /api/hq/individual/config  { "action": "set", "key": "professional_catalogues", "value": ["<production CF-FOUND id>"] }
POST /api/hq/individual/config  { "action": "publish", "note": "Owner decision D1: CF-FOUND for the restricted internal Professional pilot" }
```

**Notes:**
- Publishing publishes every pending draft in the Individual scope, so check that nothing else is pending first.
- No public Individual activation is part of this. `individual_app` and self-registration stay as they are.
- In production every CF-FOUND competency will read "Not clinically reviewed" until 395 is applied there (separate GO) and appointed reviewers approve its content.
