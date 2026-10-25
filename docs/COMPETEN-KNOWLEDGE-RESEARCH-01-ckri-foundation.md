# COMPETEN-KNOWLEDGE-RESEARCH-01 — Knowledge & Research Intelligence (CKRI) foundation

Owner GO 2026-10-25: architecture, governance design and development/staging authorised. Production research-data
collection and external sharing are **not** authorised. Migrations 440–443 (coordinator range 440–449).

## 1. Assessment: what CKRI reuses, and the genuine gaps

| Holdings engine | Reused as | Gap CKRI fills |
|---|---|---|
| Identity & Entitlements (370+, `requireIndividualContext`) | the person, their Scholar entitlement | none |
| Scholar consent (372 `individual_scholar_consent`) | permission 1, personal AI learning, unchanged | none |
| Case candidacy (423 `case_candidacy`) | permission 3, specific content contribution, unchanged and owner-disabled | none |
| Learner context (387, 402) | cohort attributes: programme, level, institution **codes** | none |
| Scholar structured evidence (388 mappings, 372/416 attempts, 414 sessions, 435 case answers, 423 library sessions) | K2 inputs, read in-database only | none |
| Evaluate (426, staging only) | K2 `evaluation_performance` | **pending**: bound when 426 is merged |
| Clinical approval (395) + case library (422–423) | K3 review, versioning, publication | a non-case educational resource kind (K3, 442) |
| HQ positions/capabilities/appointments (264, 117) | every CKRI authority | new capabilities and positions only |
| CONFIG-002 / Workspace Configuration Engine | the CKRI policy, versioned and audited | none |
| `audit_log`, trace ids | every route action | none |
| AI Consumption Ownership (421) | platform/institution budgets for any CKRI AI | CKRI workflow names, **proposed to IND-007** (not edited here) |
| Platform flags (`practice_platform_flags`) | the `ckri_research` gate, OFF unless written | none |

Genuine gaps (built): permitted-purpose register; the two optional participation records with an enforced trail;
research-project approval with independence and ethics; disclosure control (cohort floor, suppression, rounding);
aggregate snapshots with provenance and retention; an educator needs-to-resource link; a research workspace.

Not gaps (deliberately not built): a second consent engine, analytics engine, governance engine, content-approval
engine or AI gateway. CKRI K2 is deterministic SQL; it calls no AI.

## 2. K1 — governance and data contracts (migration 440)

- **Four permissions, four records** (`src/lib/knowledge/governance.ts`): personal AI learning (372), collective
  analytics (440, one per person), content contribution (423, per item, disabled), research study (440, one per person
  per recruiting study). One choice per request; no bundle. Declining removes no Scholar learning: nothing in Scholar
  reads CKRI (harness K1-4).
- **Purposes** (`ckri_purpose`): draft → active (by a governor who did not author it) → retired. Wording frozen once
  active. A research-study purpose always requires ethics review (CHECK).
- **Projects** (`ckri_research_project`): draft → submitted → approved/rejected → recruiting → closed, or withdrawn.
  Proposer needs `hq.quality.research.propose`; decider needs `hq.quality.research.govern` and must not be the
  proposer; recruiting needs an active purpose, the ethics record where required, and an agreement reference for an
  institution sponsor; `data_access = 'aggregate_only'` is the only representable value; `min_cohort >= 5`;
  approval sets a retention date. All in the trigger/CHECK.
- **Trails**: `ckri_participation_event` and `ckri_research_project_event` are written only by their record
  triggers, append-only, cascade-deletable on erasure.
- **Notice gate**: a grant needs a participation notice version + URL configured for the environment. None exists
  (no counsel draft covers research), so production refuses every grant. Withdrawal is never gated.
- **Data contracts** (`src/lib/knowledge/data-contracts.ts`): a closed, code-reviewed catalogue of eligible fields
  per Scholar stage, the forbidden columns (uploads, conversations, free text, AI feedback, labels a student typed),
  and the measures with their units and stated limits. Policy can only narrow it.

## 3. K2 — aggregate learning intelligence (migration 441)

Built in-database (`ckri_build_snapshot`), so no row-level evidence reaches the application. Population: people whose
`collective_analytics` choice is granted **at build time**; withdrawal excludes them from every later snapshot.
Measures: outcome coverage, knowledge gaps, retention, clinical-reasoning difficulty (AI-marked points apart),
resource demand; evaluation performance pending 426. Cohorts: programme / level / institution codes × period.
Disclosure: cells below the policy minimum (never below 5) suppressed; complementary suppression; counts rounded;
cells store no person column (CHECK). Provenance: contract version, policy version, builder version, build time,
population size (rounded). Retention: `retain_until` NOT NULL, purge function.

## 4. K3 — educator knowledge improvement (migration 442)

Educators (`hq.learning.ckri.educator`) see only K2 cells (suppressed) for measures the policy releases, and raise a
**learning need** tied to a snapshot cell. A need is answered by an existing governed path: a clinical case (422
studio), a competency improvement (395 competency version), or a **knowledge resource** (explanation, revision
question, targeted resource) — a new 395 content kind with the same independence, scope and staleness rules, and
publication only when approved. Provenance kind (`ai_draft` / `educator`) is stored and never upgraded by editing;
"educator-reviewed" and "clinically approved" stay separate states. Nothing is sourced from student uploads: a
resource has no column that can reference student material.

## 5. K4 — research and publication workspace (migration 443)

Around the 440 project: protocol and analysis plan (versioned, frozen on approval), team appointments (lead, analyst,
reviewer, external collaborator; external members `aggregate_only`, need an agreement reference, and get nothing
before the project is approved), approved datasets (= named K2 snapshots, never rows), statistical outputs (with
method, population, instrument version, missing data, limitations), manuscripts, independent scientific review
(reviewer not on the team), publication approval (governor, not an author), corrections and withdrawal (append-only).
No external account is created and nothing is exported by this build.

## 6. Scientific integrity (s8)

Every measure states its unit and limits; Scholar evidence is formative, self-selected and consenting; AI-generated
questions and AI-marked case points are not validated instruments; an output must record population, selection,
provenance, instrument and version, scoring, missing data, methods and limitations before it can be approved (K4
CHECK). No output may claim patient-outcome effects (publication approval requires the integrity attestation).

## 7. Owner, legal and partnership dependencies (not resolved here)

1. A counsel-approved **research participation notice** and a privacy-notice update covering collective analytics and
   research (`docs/legal/drafts` has none). Until then grants are refused everywhere.
2. **Lawful basis** for collective analytics: built as explicit opt-in (safest). Any opt-out model is a legal decision.
3. **Withdrawal effect** on aggregates already built: built as "excluded from every later snapshot; existing snapshots
   expire at their retention date". Counsel to confirm.
4. Ethics committee arrangements, research agreements (IP, authorship, data responsibilities) per partner.
5. Production activation: migrations 440–443, the `ckri_research` flag, and any CKRI AI budget, each by separate GO.
6. IND-007: add CKRI AI workflows to `ATTRIBUTION` (proposed: `knowledge.educator_develop` platform_or_institution,
   `research.analysis_assist` platform_or_institution). CKRI calls no AI until then.
