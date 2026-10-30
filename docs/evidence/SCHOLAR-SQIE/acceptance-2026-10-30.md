# SCHOLAR-SQIE-02 s15 -- end-to-end acceptance on staging, 30 Oct 2026

Harness: `scripts/scholar-sqie-acceptance-harness.ts` (topic: pyelonephritis; scenarios A-E, cleanup Z).
Target: staging `ezhvpgtcqcdsgylrxgdb` only (the harness refuses any other project and any non-local BASE_URL).

## Result of the 30 Oct run: NOT RUN (environment), nothing changed on staging

| Scenario | Result | Reason |
|---|---|---|
| A sufficient notes | NOT RUN | the server under test was not the code under test (below) |
| B insufficient notes | NOT RUN | same |
| C external scholarly | NOT RUN | same (no staging configuration was written) |
| D safety | NOT RUN | same |
| E cost | NOT RUN | no AI call was made; spend $0 |
| Z cleanup | PASS | fixtures removed; no setting had been changed (restore list empty) |

The dev server on http://localhost:3100 (preview `competen-dev-staging`) is launched from the
`competen-healthcare` checkout, not from `competen-p2`:

- that checkout is on `docs/strategy-002-workforce-graph` at `313d3cc0`, which does NOT contain `77d6590d`
  (#179, #181, #183): `src/lib/individual/scholar/evidence-recovery.ts` does not exist there;
- its `node_modules` has no `unpdf`, so every route importing `scholar/extract.ts` fails to compile
  (`Module not found: Can't resolve 'unpdf'`, import trace through `api/individual/scholar/consent/route.ts`).
  Observed: fixture sign-in 200 then consent 500 for student A, sign-in 500 for students B and D.

## To run it

Start the staging-pointed dev server from THIS tree (`competen-p2`, branch `sqie-e2e` = `77d6590d`):
`node --require <abs>/dev-ca-preload.cjs competen-p2/scripts/dev-staging.mjs` (port 3100, so the current
3100 server must be stopped first), then `BASE_URL=http://localhost:3100 npx tsx scripts/scholar-sqie-acceptance-harness.ts`.

## What the harness changes on staging when it runs (each restored in Z, verified by Z1)

- `platform/individual`: `scholar_short_answer_marking=ai_then_self` (staging's published value is `self`,
  so A3 could not get AI feedback otherwise); for C: `scholar_recovery_external=offer`,
  `scholar_recovery_providers=pubmed,openalex,crossref`, `scholar_learn_source_modes=notes,library,research`.
  None of these had an override before; Z removes them and publishes a restored version.
- `platform/research` (C): pubmed, openalex, crossref through the lifecycle to Active (server connectivity check,
  recorded checks, owner transitions via `src/lib/holdings/research/admin.ts`), workflow `basic` Active, published.
  The scope had no override rows before; Z removes them (engine reads seeded, not operational).
- Left in place by design: `workspace_config_versions`/`_audit` history rows, `plat_ai_outcomes` and
  `plat_research_requests` rows (codes and counts only).
