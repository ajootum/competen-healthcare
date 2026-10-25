# COMPETEN-PROFESSIONAL-EVALUATION-01 — Professional Stage 6, My Professional Evaluation (build record)

Owner GO (25 Oct 2026): development, integration, staging migrations and focused staging acceptance. **Production
migration, deploy and activation need a separate owner GO.** Individual is OFF in production.

## Migration

| # | File | Depends on | State |
|---|---|---|---|
| 530 | `supabase/migrations/530-individual-professional-evaluation.sql` (APPLY WHOLE, plpgsql) | 007, 373, 453 | staging only (record below) |

Rollback, verify and fingerprint: `docs/evidence/COMPETEN-PROFESSIONAL-EVALUATION-01/`. 530 names no Stage 2-5, Learning or
C5 table. It can be applied in any order relative to 470-520; the app degrades when Stage 5/C5 are absent.

530 adds the ONLY Stage 6 writes (owner GO s9): `individual_professional_evaluation` (immutable snapshot: scope, period,
context, source references, six findings, limitations, recommendations, criteria, config version, framework versions,
interpretation + AI model/policy where used, linked correction), `_evaluation_annotation` (append-only private notes),
`_evaluation_decision` (accept/defer/dismiss, latest wins; a created need/goal/activity is referenced by id only) and
`individual_professional_share_evaluation` (Passport selection, none by default). RLS own-row SELECT only, no write
policy, one append-only function with the `pg_trigger_depth() > 1` cascade path. CHECKs make a score key, a missing
dimension, a copied source body, AI text without model/policy, or a correction without a note unrepresentable.

## Code (all under `src/lib/individual/professional/` unless noted)

| Piece | File | Reuses |
|---|---|---|
| Six-dimension interpretation, recommendations, comparison (pure) | `evaluation.ts` | — |
| Reading the sources | `evaluation-sources.ts` | record, plan-store, needs-store, learning, learning-reflections, mapping-store, profile-store, passport |
| Stage 5 / C5 reads | `evaluation-stage5.ts` | Stage 5 `competency-store` exports; C5 reader (placeholder until its contract merges) |
| Stage 6 writes, accept via owning services | `evaluation-store.ts` | `needs-store.createNeed` (origin `evaluation`), `plan-store.createGoal` (created_from `evaluation`), `plan-store.createActivity` |
| AI (labelled, provenance-checked) | `evaluation-ai.ts` | `needs-ai.askProfessionalAssistant` (Holdings gateway, fair use, eligibility) |
| Governance (12 WCE policies) | `evaluation-policy.ts`, `../policy.ts` | Individual policy store (CONFIG-002 / WCE), HQ Individual configuration |
| Passport selection | `share-evaluation.ts`, share route/page, `src/app/verify/[token]/page.tsx` | 373/453 share companion, `/verify` |
| Workspace | `src/app/individual/(app)/[experience]/(professional)/progress/evaluation/page.tsx` | Progress module (sidebar unchanged), Professional components |
| Routes | `src/app/api/individual/professional/{evaluations,evaluation-annotations,evaluation-decisions,evaluation-ai}` | `requireIndividualContext("professional")` |

## Boundaries enforced

- No universal score: six findings, never summed. Evidence confidence is about the evidence, in words, with reasons.
- Provenance kept per source: self-reported, document-supported, recorded by Competen Learning, formative, independently verified.
- Missing evidence reads "Nothing recorded yet ... not evidence of a gap". Areas of development come only from the person's own needs, interests and open goals.
- Independent verification = a current C5 decision or a current organisation assessment on the Passport, read only.
- AI only through the Holdings gateway, sent findings only (never reflections or notes), labelled, never a finding; a snapshot carries AI text only when the AI route's audit row matches its sha256, model and policy version.
- Works with no catalogue (goal, topic, CPD, course and need scopes) and with no AI.
- Private by default; a Passport link carries only ticked evaluations, formative, without notes, AI text or private sources.

## Merge order

After Stage 5 (520, `prof/competency-01-stage5`) and C5 (510-519). `evaluation-stage5.ts` imports Stage 5's
`competency-store`; until that merges this branch does not compile on its own.
