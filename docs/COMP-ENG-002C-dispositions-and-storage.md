# COMP-ENG-002C §3 + §6 — The two unaccounted policies, and live storage capture

**Read-only.** No canonicalisation migration written. Two read-only registry migrations handed over.

## §3 — The arithmetic, resolved

The spec is right that my categories accounted for 18 of 20. Enumerating all twenty by exact identity
(`scripts/rls-body-audit.ts`) resolves it:

| Category | Count | Items |
|---|---|---|
| Cross-tenant exposure — **REJECT/RETIRE** | 5 | `access_review_items_read`, `access_reviews_read`, `sod_rules_read` (166), `adm_profile_read` (109), `op_observations_read` (039) |
| Removed write path — **RETIRE** | 1 | `assessments :: Educator validates assessments` |
| Required and safe as written — **RESTORE** | 1 | `departments :: Group admin reads org departments` |
| Rename family — **RETIRE legacy name** | **12** | see below |
| **Unaccounted** | 1 | `profiles :: Super admin reads all profiles` |
| | **20** | |

**The two "unaccounted" were:**

1. **`profiles :: "Super admin reads all profiles"`** — I had categorised it as *UNRESOLVED*, which is not
   one of the four decision types, so it fell outside the count.
2. **`checklist_responses :: "Assessor manages checklist responses"`** — the rename family is **12, not
   11**. This one was the *confirmed exemplar* in my dispositions document: described in full, then
   accidentally excluded when I enumerated "the same shape across…" the other eleven. **My "~11" was an
   undercount, and the approximation is exactly why the spec's audit caught it.**

## §4 disposition records for the two

### 1. `public.profiles :: "Super admin reads all profiles"` (SELECT)

| Field | Record |
|---|---|
| **Historical source** | `supabase/migrations/005-fix-super-admin-rls.sql:18` |
| **Historical purpose** | Let a super admin read every profile through an ordinary client |
| **Current workflow** | Super-admin profile reads go through the **service role**. `getCaller()` reads `profiles` with `createAdminClient()` (`api-auth.ts:78`); admin surfaces such as `app/admin/dashboard/page.tsx` use `createClient()` only for `auth.getUser()` and `createAdminClient()` for every profile read. **No ordinary-client path needs this policy.** |
| **Security impact** | Restoring reintroduces the **RLS recursion** documented in `supabase/fix-super-admin-rls-recursion.sql` — the policy calls into `profiles` from a `profiles` policy. It also depends on `role = 'super_admin'`, a role-name primitive **ADR-008 retired**. |
| **Compensating control** | Application authorization (ADR-012's middle layer): `getCaller` + `isSuper` + the plane boundary. `profiles` retains **4 live policies** including `users_read_own_profile`, so the table is not unprotected. |
| **Decision** | **RETIRE / INTENTIONALLY ABSENT** |
| **Evidence** | `rls-body-audit.ts` (absent from live); grep of every `from("profiles")` call site showing admin-client use; `plat_rls_registry` showing 4 surviving policies |
| **Approval note** | §2's rule decides it: restoration requires *current* architectural justification, and there is none — the read path is service-role, and the policy is both recursive and role-name based. ⚠ Previously held UNRESOLVED at owner instruction; this is a recommendation for approval, not a unilateral reclassification. |

### 2. `public.checklist_responses :: "Assessor manages checklist responses"` (ALL)

| Field | Record |
|---|---|
| **Historical source** | `supabase/migrations/009-assessment-engine.sql` |
| **Historical purpose** | Let the assessor on an assessment, or an educator/hospital_admin/super_admin, manage its checklist responses |
| **Current workflow** | **The workflow still exists and is live** — deployed as `"Manage checklist responses"`, renamed in-database and never written back. Bodies are **semantically identical** (confirmed by body comparison). |
| **Security impact** | **None from the rename.** Access is unchanged. But both forms encode `p.role in ('educator','hospital_admin','super_admin')` — role-name authorization **ADR-008 retired**. |
| **Compensating control** | The live policy already provides the access; no gap exists today. |
| **Decision** | **RETIRE the legacy name** (the live policy is canonical), and **REPLACE the predicate** with a capability check under ADR-008's burn-down. Do **not** re-create the old name. |
| **Evidence** | `rls-body-audit.ts --table checklist_responses` — repo `exists (select 1 from assessments a where a.id = assessment_id and (a.assessor_id = auth.uid() or exists (… p.role in (…))))` vs live, identical modulo Postgres rewriting |
| **Approval note** | Same disposition as the other eleven renames; it was described but miscounted, not mis-analysed. |

**All 20 now have an explicit disposition.** §9's first gate condition is met.

## §6 — Live storage capture

Captured via the storage API (`listBuckets`), read-only:

| Bucket | Public | Size limit | Allowed MIME | Created |
|---|---|---|---|---|
| `avatars` | ⚠ **true** | 2 MB | png, jpeg, webp | 2026-07-18 |
| `evidence` | false | 50 MB | pdf, images, mp4/webm video, audio | 2026-07-17 |
| `practice-attachments` | false | ⚠ **none** | ⚠ **null (any type)** | 2026-08-15 |

### ⚠ Three buckets, not two — my earlier report was wrong

I previously reported two. `practice-attachments` **is in use**, via constants
`LIBRARY_BUCKET` (`practice/document-library.ts:28`) and `ATTACHMENT_BUCKET`
(`practice/documentation-tools.ts:226`). My earlier grep looked for literal `storage.from("…")` and
**indirection through a constant defeated it** — the same class of measurement error this gate has
repeatedly turned up.

### Findings against §7's direction

- **`evidence` is private ✅** — §7 asked for this to be confirmed rather than assumed. It is. 24 code
  references, the highest usage of the three.
- **`avatars` is `public: true`** — objects are publicly addressable by URL to anyone who knows or
  guesses the path. That may be the intended design for profile images, but §7 requires the visibility
  decision to be explicit. **Flagged for confirmation, not corrected.**
- ⚠ **`practice-attachments` has no size limit and no MIME allowlist.** Any file type, any size, in the
  Practice document library. `avatars` (2 MB, three image types) and `evidence` (50 MB, an explicit
  media list) both constrain uploads; this one does not. **Recommended for review** — an unconstrained
  upload surface on a clinical document library is a real exposure, and the inconsistency with its two
  siblings suggests it was created without the same consideration rather than deliberately unrestricted.

### Per-operation policies — ✅ CAPTURED (migration 333 applied 2026-08-19)

`plat_storage_policy_registry()` was needed because `plat_rls_registry()` (172) filters to the `public`
schema and PostgREST refuses the storage schema outright (`Invalid schema: storage`). Applied, then read:

> **storage policies: 0**

**There are no storage policies at all.** Not "none captured" — none exist.

⚠ **Verification of a zero.** The registry returned cleanly rather than erroring, and it uses joins
identical to `plat_rls_registry()` with only the namespace predicate changed (`'storage'` for
`'public'`); the `public` variant returns 317 rows through that same query shape. The form is proven, so
zero is a measurement rather than a broken query.

### What that posture actually means

| Bucket | Effective access |
|---|---|
| `avatars` (public) | **Publicly readable by URL** — a public bucket serves objects without consulting RLS. Writes/updates/deletes: service role only. |
| `evidence` (private) | **Service role only, entirely.** No ordinary client can read, write or delete an object. |
| `practice-attachments` (private) | **Service role only, entirely.** |

⚠ **This mirrors the database posture exactly** — RLS on, zero policies, all access mediated by the
service role through application authorization. It is the same architecture ADR-012 documents for
`practice_*`, applied to storage. Whether by design or by convergence, **it is coherent and it is not
leaking**: assessment evidence is not publicly addressable, and no authenticated user can reach another
tenant's objects through an ordinary client.

**This substantially simplifies canonicalisation.** §6 anticipated capturing and encoding per-operation
policy bodies; there are none to encode. The canonical storage end state is **three buckets with their
configuration, and no policies** — which is expressible as bucket creation plus config, with the
service-role-only posture as an explicit, documented decision rather than an omission.

⚠ **One caveat that is not resolved by this measurement.** Because access is entirely service-role
mediated, **every storage authorization decision lives in application code**, unreviewed by this gate.
`evidence` holds assessment substantiation, and what governs who may fetch it is whichever route builds
the signed URL — not a policy anyone can read from the database. That is consistent with the
architecture, but it means storage authorization is only as good as the API boundary, which is precisely
why the 91-route inline-auth backlog matters.

## §9 gate status

| Condition | Status |
|---|---|
| All 20 MISSING have explicit dispositions | ✅ |
| The two unaccounted identified and dispositioned | ✅ |
| Live `avatars`/`evidence` configuration captured | ✅ **complete** — bucket config **and** policies (there are none) |
| Storage discrepancies resolved | ❌ **three flagged, awaiting your approval** |
| Canonical RLS + Storage end state documented | ❌ blocked only on the above |
| Function/trigger/policy-role evidence incorporated | ✅ |

**Canonicalisation remains unauthorised**, and now on a single class of blocker rather than a mix of
measurement and decision: **three storage questions need approval.**

1. **`avatars` is public** — every object is addressable by URL to anyone who knows the path. Intended
   for profile images, or should it be private with signed URLs?
2. **`practice-attachments` has no size limit and no MIME allowlist** — unlike its two siblings. An
   unconstrained upload surface on a clinical document library.
3. **Service-role-only storage is the de-facto posture** — confirm it as the *canonical* posture rather
   than an accident, so the canonicalisation encodes it deliberately.

Everything else §9 requires is measured and recorded.
