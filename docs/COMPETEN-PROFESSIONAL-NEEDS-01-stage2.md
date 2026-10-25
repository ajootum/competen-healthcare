# COMPETEN-PROFESSIONAL-NEEDS-01 — Professional Stage 2: Personal Development Needs (build record)

**Authority:** owner GO "COMPETEN-PROFESSIONAL-NEEDS-01, Stage 2 — Personal Development Needs". Development and staging only. Production deployment and activation need a separate owner GO.

**Branch:** `prof/needs-01-stage2`, off `origin/main` 4229e27d. **Migration:** 470 (staging only).

## 1. Existing functionality reused (not rebuilt)

| Existing | Reused for |
|---|---|
| 373 `individual_professional_need` / `_goal`, the needs and goals routes, the Needs & plan page | THE need record and page. 470 widens the need, and the MVP route paths are unchanged |
| WCE Individual policy (076 / CONFIG-002) | All Stage 2 configuration (14 new policies) |
| The Professional catalogue allowlist + CFCA library (384 / 394 / 395) and the 393 mapping view | Competencies offered for linking: the expected level, recorded evidence (393 accepted links), completed Learning |
| Passport (estate competency decisions) | "Independently verified" (an organisation's current assessed decision), shown read-only |
| Learning catalogue (460–464) `publishedCatalogue({competencyId})`, `findLearningHref`, `learningEnabled` | Learning discovery on a need. Nothing is extended, enrolled or purchased |
| Holdings Personal AI (`runIndividualAssistant`, Professional `development` mode), the legacy-quota or metering rule, the identifier screen | AI suggestions and reflection summaries (`needs-ai.ts`), with no gateway change |
| 450 profile (aspirations, expiring registrations and qualifications) | Deterministic rule suggestions |
| audit_log, append-only trigger pattern (402 / 450) | Need history and link history |

## 2. N1–N9

| | Built |
|---|---|
| N1 | The **My development needs** workspace inside Needs & plan, with no new navigation. Filters: All, Identified, Exploring, Prioritised, In development, Addressed and deferred, To review. A need opens in a detail view (`?need=`) with its history. |
| N2 | A configurable form. **Only "What would you like to develop?" is required.** Optional, configured fields: why it matters, source, motivation, priority, category, professional context, interests. A need can be saved incomplete and enriched later. |
| N3 | Nine sources produce one record (470 origin). Provenance is kept: origin, reflection or aspiration link, and how it was created (`person`, `ai_suggestion`, `rule_suggestion`). Nothing converts feedback, results or missing evidence into a need. |
| N4 | **Private reflections** (prompt templates). A need can be created from a reflection, and copying its words is the person's opt-in. A reflection is edited in place. The AI summary is an authorised, policy-gated action on one reflection. |
| N5 | Many-to-many need ↔ CFCA competency links, recording the **framework version**. Unlinking is kept as history. Each link shows the expected level, recorded evidence, and independent verification, as "Nothing recorded" where absent. The catalogue is optional. |
| N6 | Learning discovery through the existing catalogue (by linked competency), with "Find learning" links and ideas that need no course. No purchase or enrolment. Usable without Learning. |
| N7 | Rule suggestions (from aspirations and expiring records) and AI suggestions (gateway, fair use, eligibility). Each states its basis, is private, editable, and can be accepted, dismissed or deferred. A suggestion is a need only on acceptance. |
| N8 | Seven configurable stages, **in any order**, with a reopen rule. Priorities are words, never scores. Needs can be retired without erasing history; erase is a separate, confirmed action. History is preserved by trigger. |
| N9 | Many-to-many goal ↔ need. A goal can be linked from a need, or a new goal created for it. The goal itself is still Stage 3's to govern. |

## 3. Privacy

Reflections are read only by `needs-store.ts`. They are never in AI grounding, the Passport, share links, `/verify` or plans; the harness pins this. Stage 2 adds no scope, verified, deficiency or score column anywhere.

## 4. Configuration (no code, WCE)

`professional_need_*` / `professional_reflection_*`:

| Setting | Policy kind |
|---|---|
| Categories | options |
| Sources | set |
| Motivations | options |
| Form fields and order | sequence |
| Priorities | options |
| Stages and order | sequence |
| Reopen rule | choice |
| Reflection templates | options |
| Competency links | choice |
| Rule suggestions | choice |
| AI suggestions | choice |
| Learning | choice |
| Reflection AI | choice |
| Review interval | int, 14–365, default 90 |

The defaults are neutral: no profession or country is named.

## 5. Migration 470 (staging only)

- **File:** `supabase/migrations/470-individual-professional-development-needs.sql`. **APPLY WHOLE** (plpgsql).
- **sha256 (LF):** `e53ce82e273ec080bcdf87ce861db2cb66d8cdbe8132cad589e289353412292a`.
- **Depends on:** 373, 450, 003. Independent of 451–453 and 460–464.
- **Evidence files:** `docs/evidence/COMPETEN-PROFESSIONAL-NEEDS-01/`:
  - ROLLBACK (`47a179e3…408f`);
  - VERIFY (`0d2939c3…0ac0`);
  - FINGERPRINT (`8e446160…89c4`).
- **Local rehearsal** (postgres:17):
  - apply ×2 idempotent, with backfill;
  - 30 probes as designed;
  - rollback restores the 12 MVP columns and the 373 origin set;
  - re-apply and VERIFY OK;
  - fingerprint stable.
- **Staging** (coordinating session, guarded runner, file whole, LF bytes as above):
  - Applied twice, then rolled back and re-applied. **Final state: APPLIED on staging** (ezhvpgtcqcdsgylrxgdb).
  - Full record: `docs/evidence/COMPETEN-PROFESSIONAL-NEEDS-01/470-staging-record.md`.
  - Pre-application: `individual_professional_need` had 0 rows, so the backfill touched nothing.

    | Step | FINGERPRINT-470 | Items |
    |---|---|---|
    | PRE | `b46ab0fa1b8a2ae2131aa2da2250cd85` | 332 |
    | Apply #1 = apply #2 (idempotent) | `a0812a5017bfcfb6f49a0d2142d07b55` | 443 |
    | Rollback | = PRE | 332 |
    | Re-apply | = apply #1 | 443 |

  - VERIFY-470, after apply #2 and again after re-apply:
    - §1: 15 columns.
    - §2: 5 tables, each RLS t\|1\|1.
    - §3: 4 triggers.
    - §4: 0\|0\|0.
    - §5: 0.
    - §6: 0.
    - §7: the origin CHECK lists 9 origins.
- **Production:** not applied. Production only on separate owner GO, after 450.

## 6. Verification

| Check | Result |
|---|---|
| `tsc`, eslint | clean |
| vitest `src/lib/individual` | 475 / 475 (new `needs.test.ts`, policy default test extended) |
| `professional-needs-harness.ts` (new, in the CI credential-free list) | **33 / 33**, including 18 planted reds. Two controls first failed to bite (a plant that changed only one of three identical keys), and were tightened |
| `individual-professional-harness` | 100 / 100. W1 went RED on the new unpinned writes, which were then pinned. The U1 control had weakened (a count of panels), and was tightened to named panels |
| `professional-profile`, `individual-config`, `individual-foundation`, `hq-guard` | 59 · 41 · 74 · 51, all green |
| **Staging journey, GO s14** (`professional-needs-acceptance-harness`) | **12 / 12**, covering items 1–15. A planted defect turned 1–3 RED, and it was green after the restore |
| Staging UI walk-through | Workspace and form (one required field) → save → listed → detail → stage moved out of order. No horizontal scroll at 375 px |

## 7. Bounded follow-ups (not built)

- **Suggestions from earlier study:** suggestions drawn from earlier study records are not built. Professional code may not read study data (harness rule), so this needs a governed consent read. "My earlier study" is available as a source the person picks.
- **AI reflection summaries:** these send the first 650 characters of the reflection (the gateway's question limit).
- **Sharing needs:** a need-level sharing switch is not built, because nothing shares needs today. Copying reflection words into a need is the person's choice.
- **Stage 3:** goals, activities, scheduling and review are not built.
