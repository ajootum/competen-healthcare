# COMPETEN-PROFESSIONAL-PROFILE-01 — Stage 1: Professional Registration, Profile & Identity (build record)

**Authority:** owner GO "COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1", 25 October 2026. Development and staging authorised. Production deployment and activation need a separate owner GO.
**Branch:** `prof/profile-01-stage1` off `origin/main` c20584d4. **Migration:** 450 (staging only; NOT production).

## 1. Focused review: what Professional already had (kept, not reopened)

| Already there (MVP, IND-007 / foundation) | Reused as |
|---|---|
| One Individual identity, membership, invitations (378) with the Professional-only email marker, grant engine, terms gate, dual entitlement, graduation source | Identity and entitlement for every Stage 1 path. Nothing new was built here |
| 373 `individual_professional_profile`: one row per person (profession and one registration), self-declared column naming, no verified column | The CURRENT pointer. 450 extends it |
| Generated evidence class `self_declared` / `source_linked`, private bucket, owner-only document route | The verification model and documents of the profile records |
| Passport classes `institution_issued` / `institution_verified` from estate records | The only "independently verified" source, shown read-only beside the person's own records |
| WCE Individual policy (076 / CONFIG-002) with versions, audit, rollback and the HQ console | All no-code configuration (no new engine) |
| `professional_catalogues` allowlist and the CFCA library (384 / 394 / 395) | Catalogue suggestions |
| Holdings Personal AI, Professional `development` mode, `professional_record` scope | Summary drafting (no gateway change) |

## 2. Genuine gaps, and what was built

| GO | Gap | Built |
|---|---|---|
| s3 | No registration flow. No status or jurisdiction of practice. No save-and-continue | A configurable 3-step form on the Professional home, shown until registration completes. Step 1 has the 3 required facts. Step 2 has the configured optional questions (skippable). Step 3 reviews and enters. Every step saves. `registration_completed_at` is CHECK-guarded by the 3 facts |
| s4 | One overwritten row: no history, no multiple records, no employment, specialties or aspirations | 450: a trigger-written, append-only `individual_professional_profile_context` history, and `individual_professional_profile_item` versioned records for six kinds (a change is a new version; the old one is kept; withdrawal, never deletion). A six-section profile page in configured order |
| s5 | No expiry, supersession or withdrawal states on profile facts | Computed states: self-declared / document-supported / expired / superseded / withdrawn. Nothing the person records can be verified. Organisation-verified credentials come from the Passport, read-only and labelled |
| s6 | No profile-driven suggestions | Ranking of allowlisted, shared, published catalogues by profession and specialty terms (384/395) and the foundational layer. With the allowlist empty, nothing is suggested and nothing is required |
| s7 | No profile-aware AI | The person's own current profile is added to the existing grounding, opening with a no-invention rule, gated by a privacy policy. "Draft a summary" gives advisory text, never saved by the AI |
| s8 | No configuration of professions and the rest | 14 policies in the existing WCE. 9 option lists (professions, titles, jurisdictions defaulting to every country, statuses, qualification types, registration bodies, practice settings, specialties, career interests). Ordered optional registration questions. Which are required (default none). Ordered profile sections. Document-allowed record kinds (the verification policy). AI may read the profile (the privacy rule). A new `sequence` policy kind and console control |

**Production fail-safe:** without 450, the code returns not-provisioned. The home shows no form, the profile page is the MVP page unchanged, and writes refuse with a 409. In production the Individual gate is also OFF.

## 3. Genuine gaps NOT built (owner decisions needed)

- **Independent verification of self-declared records** (dispute and revocation by a verifier). There is no verifying authority or verifier role. The schema cannot store "verified", and the profile says so. Building it needs an owner decision on who verifies.
- **Reminders for additional registrations** (items). Reminders still follow the primary registration on the 373 row.
- **Sharing profile sections through the Passport.** The profile is private. Sharing sections needs a consent design.

## 4. Migration 450 (staging only)

| | |
|---|---|
| File | `supabase/migrations/450-individual-professional-profile-and-history.sql` (APPLY WHOLE: plpgsql) |
| sha256 (LF, applied on staging = committed blob) | `118f1e4461b4cdfdcdd355bddaf97d69b153ab5d282f3db661f45aacb9b27b02` |
| Depends on, and application order | **373 only.** Numerically ahead of 426–449, which are other workstreams' and unrelated. It may be applied at any point after 373, independent of 374–449 |
| House rules | ALL CLEAR (463 lines, 92 statements, 12 constraints). A planted comment semicolon goes RED |
| Rollback / verify (LF) | `docs/evidence/COMPETEN-PROFESSIONAL-PROFILE-01/ROLLBACK-450.sql` `ac25fb029859f1f99c3ad090874bb49b7824148b502e692e383fc33710f2aaf1` · `VERIFY-450.sql` (read-only) `311cfd1dff91ac3ed12d7de4a062256bd3dd207a25123d6ff608a8e77bba0eb2` |
| Local rehearsal | postgres:17. Apply ×2 OK. 17 behaviour probes OK. Rollback back to 11 columns. Re-apply OK |
| Pre-application (staging) | `individual_professional_profile`: 0 rows |
| Staging application (coordinating session, guarded runner, file whole, LF bytes) | Fingerprint over the `individual_professional%` columns, constraints, indexes, policies and triggers, plus the `individual_professional_profile*` function md5s, CR-stripped. **PRE** `eeb41896dfdb5fe4d911fa9b30c4aeb6` (185 items) → **apply #1** `7546da1b5e80852b9061a80795c0f9c4` (281) → **apply #2** `7546da1b…` (idempotent) → **rollback** `eeb41896…` (= PRE) → **re-apply** `7546da1b…` (= apply #1). **Final state: APPLIED on staging** (ezhvpgtcqcdsgylrxgdb) |
| VERIFY-450 on staging (after both applies, and re-run read-only by this session) | §1 16 columns · §2 both tables, RLS on, 1 policy, 1 select · §3 four triggers · §4 3 pointer + 6 item constraints · §5 0 forbidden columns · §6 profiles 0 = open periods 0 · §7 0 rows, unchanged |
| Production | **Not applied.** Needs a separate owner GO and the OPS-001 safeguards |

## 5. Verification

| Check | Result |
|---|---|
| `tsc --noEmit`, eslint (changed files) | clean |
| vitest `src/lib/individual` | 394 / 394 (new `profile.test.ts`, 17 tests. The policy default test was extended) |
| `scripts/professional-profile-harness.ts` (new, CI credential-free list) | 38 / 38, including 19 planted violations each proven RED. It found a real defect first: nursing-specific hint text, now neutral |
| `individual-professional-harness` | 100 / 100. W1 went RED on the new unpinned writes, and they were pinned to `profile-store.ts` |
| `individual-foundation-harness` / `individual-config-harness` / `plane-boundary-harness` | 74/74 · 41/41 · 35/35 |
| **Staging acceptance, GO s10** (`professional-profile-acceptance-harness.ts`) | **20 / 20.** The first run went RED on J9 and J10: the MVP Passport shows a recorded profession as an own self-declared item, and staging's allowlist holds one catalogue. The checks were corrected to the actual contract and re-run |
| Staging UI walk-through (dev server against staging, test identity, local test terms versions) | Register (step 1 → skip step 2 → review → enter) → workspace. Profile renders 6 sections. Adding a role, then changing it, shows "Earlier versions (1)" and "Self-declared, not verified". At 375 px there is no horizontal scroll |

Acceptance items (GO s10): 1 J1 · 2 J2 (invitation with the Professional email marker) · 3 J3a/b · 4 J4 · 5 J5 · 6 J6 · 7 J7a/b/c · 8 J8 · 9 J9/J9b · 10 J10/J10b · 11 J11 · 12 J12a/b.

## 6. Part B (owner continuation GO, 25 Oct 2026): verification, reminders, selective sharing

**Authority:** owner, "COMPETEN — LEARNING, PROFESSIONAL & CKRI CONTINUATION" part B. It approves:
- independent credential verification through the existing Holdings authority;
- configurable registration and licence-expiry reminders;
- selective, person-controlled Passport sharing of profile sections.

Verification is optional, and no verifier is appointed automatically. Development and staging only.

| Item | Built | Reused, not duplicated |
|---|---|---|
| Verification (451) | Capability `hq.individual.professional.verify`, position `individual_professional_verifier` (product line `individual`) and **no appointment**. An append-only history per record VERSION: requested, request withdrawn, verified (with method and optional validity date), declined, revoked, disputed. The guard trigger enforces: an active appointment for verifier events, an actor who is not the subject, person events only by the person, a request first, the current version only. The person asks, withdraws or disputes from the profile. The verifier works from `/super-admin/individual/verification`, where the queue shows open requests only, never the verifier's own records, and the document opens only on an open request and is audited | HQ capability/position/appointment model (264/117) · `hqApiGate`/`requireHqCapability` · intent map · the Passport verified-tier wording (green only for a standing, in-date verification) |
| Reminders (452) | Policy keys: reminder kinds, offsets (180 to 7 days, default 60), registration standings (default active and provisional). A profile record gets ONE email at the tightest offset reached. Each claim is a row in the 452 ledger, released if the send fails. The new branch fails soft, so the MVP reminders never stop | The existing daily `individual_professional_reminders` job (`/api/cron/jobs`, hourly runner), the notification dispatcher's email channel, the person's 374 opt-in, and the release gate |
| Sharing (453) | `individual_professional_share.profile_overview` (default false) and `individual_professional_share_item` (record versions chosen per link). The share page offers opt-in ticks, with each record's exact state shown. `/verify` shows them only on a Professional link, and only while current and in a shareable section. It never shows the registration number, document, details, reasons or history. Policy key: shareable sections | `passport_share_tokens` and `/verify`, the 373 companion row, `EVIDENCE_LABEL` |

**Migrations, staging only (LF bytes; apply order 451 → 452 → 453; each depends on 450, and 453 also on 373; independent of 426–449):**

| File | sha256 (LF) | Rollback / verify (LF) |
|---|---|---|
| 451 (APPLY WHOLE) | `44c0e307cbf40d93e3958d61fcab53cab8fb113046d12136b915d75facb9a8a9` | `8d207c14…5366a` / `ad713c8d…6f6d` |
| 452 | `568aeceefc8665cc02f24ddc580e0633417efafda6b9540c1e8f1571f414bb71` | `f7d5774c…366a` / `4c1e9205…f676` |
| 453 | `24aa8be62fbf53add9401d292d541eb20cebd89daa25fe448075a375a47c16fe` | `c4919f6e…bf27` / `a6a87c63…fc63` |

- **Local rehearsal** (postgres:17):
  - each file applied twice;
  - 32 behaviour probes, all as designed;
  - rolled back to zero, re-applied, VERIFY as expected.
- **Staging:** present on staging (coordinating session). Its ×2 and rollback record goes here.
- **Production:** not applied. Each migration needs its own owner GO.

**Checks:**
- `tsc` and eslint clean · vitest 1153/1153.
- `professional-profile-harness`: 59/59, with 35 planted reds (16 new: B1–B5).
- The guard harnesses went red first, on real omissions, and are green after the fixes:
  - `hq-guard` 51/51 (the capability was missing from the TypeScript catalogue);
  - `individual-config` 41/41 (an unpinned HQ door, and pinned policy reads that had changed);
  - `individual-professional` 100/100 (new write pins, and exactly one file allowed to name the verified state).
- foundation 74/74 · plane-boundary 35/35 · access-doors 39/39.
- **Staging acceptance** (`professional-profile-b-acceptance-harness`): 14/14. A planted schedule defect turned R1 red, and the run was green again after restoring.
- **Staging UI walk-through:**
  - ask to verify → request open (withdraw offered);
  - share page selection is unticked by default and shows each record's state;
  - `/verify` shows exactly the ticked overview and record, with its exact state, and leaves the unticked record off.

**Not built (outside this GO):**
- Appointing a verifier: an owner act on the existing appointment surface.
- A regulator register lookup.
- Reminders at multiple offsets for the primary registration and credentials, which keep the MVP single lead time.
