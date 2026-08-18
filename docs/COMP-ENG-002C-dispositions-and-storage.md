# COMP-ENG-002C §3 + §6 — The two unaccounted policies, and live storage capture

**Read-only analysis.** Registry migrations 332 and 333 applied by the owner; canonicalisation migration 334 written and handed over (not applied).

## §3 — The arithmetic, resolved

The spec is right that my categories accounted for 18 of 20. Enumerating all twenty by exact identity
(`scripts/rls-body-audit.ts`) resolves it:

| Category | Count | Items |
|---|---|---|
| Cross-tenant exposure — **REJECT/RETIRE** | 5 | `access_review_items_read`, `access_reviews_read`, `sod_rules_read` (166), `adm_profile_read` (109), `op_observations_read` (039) |
| Removed write path — **RETIRE** | 1 | `assessments :: Educator validates assessments` |
| Required and safe as written — **RESTORE** | 1 | `departments :: Group admin reads org departments` |
| Rename family — **RETIRE legacy name, adopt live** | **11** | 009/007 policies renamed in-database |
| **Unaccounted #1** | 1 | `profiles :: Super admin reads all profiles` |
| **Unaccounted #2** | 1 | `competency_scores :: Educator views hospital scores` |
| | **20** | |

**The two "unaccounted" were:**

1. **`profiles :: "Super admin reads all profiles"`** — I had categorised it as *UNRESOLVED*, which is not
   one of the four decision types, so it fell outside the count.
2. **`competency_scores :: "Educator views hospital scores"` (ALL)** — **I had wrongly folded this into
   the rename family.** It is not a rename: it has **no live counterpart at all**. `competency_scores`
   carries exactly one live policy, `"Nurse views competency scores"`, which pairs with a *different*
   repo declaration. The rename family is therefore **11, exactly as the spec counted** — my "~12" was
   the error.

⚠ **This correction came from the generator refusing to emit.** Building the canonicalisation SQL from
measured live state, the tool could not find a live policy to pair with `"Educator views hospital
scores"` and printed `NOT FOUND LIVE — INVESTIGATE, not emitted` rather than inventing a name. Had it
guessed, a genuine absence would have been silently encoded as a rename.

⚠ **And it supersedes what I told the owner earlier**, which named `checklist_responses` as the second
unaccounted policy on a counting-slip theory. That was wrong: `checklist_responses` is a confirmed
rename, its live counterpart exists and its body matches.

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

### 2. `public.competency_scores :: "Educator views hospital scores"` (ALL)

| Field | Record |
|---|---|
| **Historical source** | `supabase/migrations/009-assessment-engine.sql` |
| **Historical purpose** | Let an educator, hospital_admin or assessor in the same hospital read **and write** every competency score in that hospital's cycles, through an ordinary client |
| **Current workflow** | **The workflow exists and is server-mediated.** `api/educator/validate` and `api/educator/ai-validate` read and write `competency_scores` through `c.admin` (the service role) behind `getCaller` + `isEducator` + `assertCycleScope`. **No ordinary-client path uses it.** |
| **Security impact** | It is an **ALL** policy, so restoring opens a client-side **write** path to competency scores — not merely a read exposure. Its predicate is `p.role in ('educator','hospital_admin','assessor')`, a role-name primitive **ADR-008 retired**. |
| **Compensating control** | The two educator routes above, each with tenant scoping via `assertCycleScope` and an `audit_log` row. |
| **Decision** | **RETIRE** |
| **Evidence** | `rls-body-audit.ts --table competency_scores` — one live policy (`"Nurse views competency scores"`), which pairs with a different repo declaration; this one has no counterpart. Call-site grep showing admin-client access. |
| **Approval note** | Same reasoning as the educator-validation case: the product moved this workflow behind a server boundary, and the declaration is older than the architecture. Restoring it would reintroduce a write path the product does not offer. |

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
