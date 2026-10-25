# Migrations 510 and 511: the Holdings Competency Verification Studio (C5) — build record

**Owner GO:** COMPETEN-PROFESSIONAL-COMPETENCY-01, Professional Stage 5, C5 (P0). Development, integration, staging migrations and focused staging acceptance are authorised. Production deployment, production migrations, real assessor appointments and the activation of competency verification each need a separate owner GO.

**Numbers:** 510–519 belong to C5. 520–529 belong to the Stage 5 portfolio workstream.

**State:**
- **APPLIED and verified on staging** (ezhvpgtcqcdsgylrxgdb) by the coordinator, ×2 with the rollback rehearsed: see `510-511-staging-record.md`.
  - Fingerprints: PRE a9a18a96, F1 = F2 = a823ff9b, rollback = PRE, re-apply a823ff9b.
  - VERIFY: A 7/7; B/C/D 41 PASS, 1 SKIP (no Scholar Passport item on staging).
- **Committed byte-identical:** 510 f9af70d8, 511 a85d704b, VERIFY e7affe9a. The superseded 222e2065 and b08ab4d1 bytes were never committed.
- **Production:** not applied. It needs a separate owner GO, as do real assessor appointments and activation.

## 1. What the two files do

| File | What it adds | APPLY WHOLE |
|---|---|---|
| `510-competency-verification-studio.sql` | Two capabilities and two NEW positions, with no appointment and no grant to any existing position. Seven tables (methods, method versions, assessor scopes, requests, evidence, events, decisions). Seven guard triggers, five predicates and two atomic submission functions. RLS on, own-row read. | yes |
| `511-competency-assessor-separation-of-duties.sql` | Replaces 500's `hq_capability_exclusions()` and `hq_capability_sensitive_class()` with 500's lists unchanged, plus four assessor exclusion pairs and two clinical-sensitive codes. | yes |

The application order is 510, then 511. They are independent at apply time: 511 names codes, not rows. Both are additive, and re-running either is a no-op.

**510 depends on:**
- 264 (HQ authority) and 117 (appointments);
- 451 (`individual_holds_capability`);
- 395 (`competency_content_hash`);
- 384 and 007 (learning outcomes, and the CFCA scale as `scoring_levels`);
- 013 (taxonomy);
- 373 and 393 (CPD and evidence keys), 450 (profile items), 470 (reflections), 462 (`learning_record`) and 375 (Scholar Passport items).

**511 depends on 500.** All of these dependencies are on staging. Production has 451, 470 and 500 only after their own GOs, and 462 belongs to the Learning lane. The production order is stated again when production is asked for.

## 2. The integrity controls (owner F), and where each lives

Every control below is a trigger in 510. None is configuration, so no Studio setting can remove it.

| Control | Enforced by |
|---|---|
| No self-verification | The decision guard refuses `assessor = person`. The assignment guard refuses assigning to, or by, the person. |
| Valid appointment and scope | `competency_appointment_holds`: the appointment must be the actor's own and ACTIVE, in a usable office, and its position must hold `hq.competency.verification.assess` today. `competency_assessor_covers` covers competency, method, level, context and the validity dates. |
| Independent decision authority | Only the ASSIGNED assessor decides. Assignment needs `manage`; an assessor claims only where the method allows it. A scope is granted by `manage`, never by the assessor. 511 keeps `assess` off any position that holds `manage`, clinical approval, clinical governance or competency authoring. |
| Evidence provenance | Composite `(id, user_id)` foreign keys to the person's own records. The trigger takes a provenance snapshot at submission. If the person later removes the source, its reference clears and the snapshot stays. |
| Criteria and version | A request is pinned to a PUBLISHED method version. A decision is pinned to that version, its content hash and the 395 competency hash. Every required criterion and critical checklist item must be answered, a verified outcome cannot leave a required criterion not met, and the method's minimum evidence applies. |
| Immutable history | Requests, evidence, events and decisions are append-only, with the cascade allowance (`pg_trigger_depth() > 1`). Published criteria never change, and a newer version retires the older one. |
| Privacy and access | RLS is on, with own-row SELECT for the person on the four person tables. Assessors read through the server, see only the submission snapshot, and open documents only on requests assigned to them (audited). |
| Revocation and expiry | Validity is computed from the version. Revocation is a new event with a reason, by `manage`, once, and only of a standing verified or partial outcome. Expiry and supersession are derived, never written. |
| Separation of content approval and individual verification | They are separate capabilities, kept apart by 511. A stale check refuses a decision on competency content that changed after the request. |

Assessment outcome, not a declaration:
- **Outcome classes:** fixed (verified, partial, further_evidence, not_demonstrated, unable_to_determine).
- **Labels:** configurable. The Studio refuses a label such as "competent", "incompetent", "unsafe" or "fit to practise".

## 3. Reused, not rebuilt

**Reused:**
- HQ positions, capabilities and appointments (264, 117), with the 500 guard extended by 511;
- 451's appointment predicate;
- 395's content hash and its appointment-scope pattern;
- the CFCA proficiency scale (`scoring_scales` / `scoring_levels`, as 384 uses);
- `framework_competencies.learning_outcomes`;
- `audit_log`;
- Professional's own documents module for signing.

**Not reused, and why:** `assessment_method_configs`, `assessment_requests` and `competency_assessments` (007, 177, 003) are hospital-scoped and mutable. They hard-code their methods and are read by hospital analytics.

**Configuration:**
- **Not WCE (CONFIG-002):** a WCE version snapshots a whole scope, and publishing it would publish every other draft in that scope.
- **Method versions instead:** each is immutable and hashed, so a decision pins exactly what it applied, as 460's offering versions do.

## 4. Local proof (PG17, scratch database, files normalised to LF as staging receives them)

**The first staging run (25 Oct) failed, and this is the fix.** The structure was exact (fingerprint fee831c1, rollback = PRE), but VERIFY B aborted on `column f.version does not exist`. The local stand-in had invented a `frameworks.version` column that neither staging nor production has. Staging was rolled back to PRE. Two changes followed:
- **The version used:** 510 and the store now take the governed `major.minor.revision` (012), composed exactly as the catalogue shows it (`competency/foundation.ts`).
- **The stand-in:** it is now GENERATED from staging's real `information_schema` column list (24 tables, 337 columns: names, types, nullability, simple defaults and generated columns). A column that does not exist on staging cannot exist locally. The generated file is in the package as `LOCAL-STUB-from-staging-columns.sql`.

A unit test pins that no SQL or code reads `frameworks.version`, and the planted defect turns it red.

- **Apply ×2:** 395, 451 and 500, then 510+511 twice. Clean.
- **Fingerprints:**
  - PRE `a9a18a96`. This equals staging PRE, read on 25 Oct.
  - F1 = F2 = `a823ff9b`: 89 columns, 48 constraints, 18 indexes, 7 triggers, 4 policies, 16 functions, 8 authority rows and 14 exclusion pairs.
  - ROLLBACK-511 then ROLLBACK-510 returns `a9a18a96`, and the re-apply returns `a823ff9b`.
- **ROLLBACK-510 refuses:**
  - while 511 is applied;
  - once anyone was appointed to either position;
  - once any request exists.
- **VERIFY-510:** Part A has 7 checks, all true. Parts B, C and D have **43 PASS**, rolled back, on the staging-shaped stand-in.
- **Planted defects:** with the self-verification check and the scope check removed from the decision guard, VERIFY shows those two lines FAIL. With Scholar evidence snapshotted as `independently_verified` instead of `scholar_formative`, that line FAILs. Restored, it is 43 PASS.

## 5. The application, while 510 is absent (fail closed)

- **Studio and assessor pages:** `verificationReady` probes 510's table, and both pages say "not set up on this environment yet".
- **Library functions:** every function returns 409 "not set up".
- **Gates:** both routes are gated by capabilities that nobody holds until the owner appoints someone, and the database re-checks every write.
- **hq-guard B1** (applied catalogue = code catalogue) stays red on an environment without 510 until 510 is applied there.

## 6. Unit tests and harnesses

- **`src/lib/competency/verification.test.ts`:** 22 tests.
  - The 510 vocabularies mirror the code.
  - Nothing clinical is hard-coded.
  - Publication rules and decision rules are checked.
  - State and standing are derived.
  - Store write paths: the caller's id is used, the body is never trusted, and refusals come back in words.
  - The two doors keep two authorities.
  - Six planted code defects all went red.
- **`src/lib/hq/positions.test.ts`:** now reads 511, the latest definition. 511 keeps 500's ten pairs in order, and assess is excluded from all four.
- **individual-professional-harness: 100/100.** The assessor route was added to IMPORTERS_ALLOWED, with its reason, for `signDocument` only.
- **plane-boundary:** 35/35.
- **hq-nav-filter:** 35/35.
