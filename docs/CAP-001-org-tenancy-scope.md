# CAP-001 — Org-Tenancy Hierarchy: Scope & Build Plan

**Status:** Scoping (not yet built) · **Author:** Claude · **Date:** 2026-07-29
**Companion to:** `docs/CAP-001-unified-asset-model-scope.md`, `docs/CAP-001-writeback-scope.md` · Memory: `cap-build-plan`

---

## Verdict

The correct move is an **additive org/tenant dimension on `cap_assets`, resolved from the hierarchy that already exists** — *not* "build an org model" (it's already there) and *not* re-pointing the platform's tenant enforcement.

I have said several times that "no organization model exists." **That was wrong, and this scope corrects it.** A full hierarchy — `tenants → enterprises → organisations → hospitals → departments → units` — exists as **real, FK-connected, super-admin-writable registry tables** (migrations 006/041/052; the Enterprise Admin surfaces write them live). What "doesn't exist" is narrower and precise: **nothing above `hospital_id` participates in data isolation.** The hierarchy is *structurally real but operationally inert* for tenancy.

So the honest decomposition of "assets inherit down Global→Country→Org→Dept→Hospital" is **hybrid**, and only one slice is a clean, additive CAP build:

- **Org / Dept / Hospital** → **wire an existing, disconnected hierarchy** (the tables + FKs are there and populated).
- **Country** → **genuinely new** (free text today; no `countries` table).
- **Global** → **formalize a convention** (`hospital_id IS NULL` already means "shared/master").

The recommended slice gives `cap_assets` an `organisation_id`/`tenant_id` resolved *from the existing hospital→org chain* and lets the Asset Browser browse/filter/inherit by org — **without touching the platform-wide `hospital_id` enforcement** (the ~130-module change that is the real multi-quarter re-platform).

---

## 1. What the design intent asks (CAP-000/001/002)

CAP's multi-tenant model is an **inheritance hierarchy**:
`Global Library → Country → Organization → Department → Personal Assignment Views`
with *metadata inheritance* down the chain (CAP-002: "Global Metadata → Country → Organization → Department → Role Extensions"). An asset authored once at a higher tier is reused/overridable below it.

Two distinct capabilities are bundled in that sentence, and they must be scoped separately:
- **Inheritance / visibility** — an asset at org-level is *visible and reusable* by its hospitals. (Additive; a filter + resolution dimension.)
- **Isolation / enforcement** — a user scoped to org X *cannot read* org Y's assets, enforced server-side. (Invasive; changes the tenancy boundary platform-wide.)

The recommended slice delivers the first for CAP assets. The second is the re-platform.

---

## 2. Current state — the bifurcation (real tables, hospital-only enforcement)

### 2a. The hierarchy that EXISTS (registry tables + FKs + live writes)

| Level | Table (migration) | Wired by FK | Written by |
|---|---|---|---|
| Tenant (root) | `tenants` (041) | — | landlord plane |
| Enterprise ("Networks" in UI) | `enterprises` (041) | `tenant_id → tenants` | Enterprise Admin → Networks |
| **Organisation** | `organisations` (006) | `tenant_id`, `enterprise_id` | Enterprise Admin → Organisations |
| **Hospital** (tenant boundary) | `hospitals` (schema) | `organisation_id → organisations`, `tenant_id → tenants` | Enterprise Admin → Facilities |
| Division ("Facility" tree) | `ent_divisions` (052) | `hospital_id → hospitals` | Structure Builder |
| Department | `departments` (006) | `hospital_id`, `division_id` | Structure Builder |
| Unit / Team | `units` (006), `ent_teams` (052) | `department_id` / `unit_id` | Structure Builder |

There are **no `networks`/`facilities` tables** — "Networks" = `enterprises`, "Facilities" = `hospitals`. The `/super-admin/enterprise/*` modules are all `live:true`, service-role-gated, audited real writes (`api/enterprise/{networks,structure,organisations,facilities,people,templates}`). **The org model is genuinely built.**

### 2b. The enforcement that's ACTUALLY used (hospital_id only)

- `hospital_id` is **the** tenant key: **~408 `.eq("hospital_id"` refs across 276 files**; the `scope = q => isSuper ? q : q.eq("hospital_id", hid)` one-liner lives in **~130 lib modules**. `src/lib/api-auth.ts` is the core — every `assert*Scope` resolves a row's `hospital_id` and compares to the caller's.
- `getCaller()` **loads `organisationId`** from the profile — but only **stamps it on insert** and uses it for **client-side directory filtering**. It is **never a server-side read-isolation boundary**.
- `tenant_id` exists (mig 041, denormalized onto hospitals/profiles/organisations) but is used in **only 9 refs / 6 landlord-plane files** — operationally dormant.
- **Country is not a scoping level** anywhere. No `countries` table; country is free text (`hospitals.country`, `organisations.hq_country`, `tenants.primary_country`). The `country_admin` role + `current_user_is_country_admin_for()` + RLS from migration 008 are **orphaned — zero references in `src/`**.
- **Global** = the convention `hospital_id IS NULL` (frameworks, learning_resources, skill_library, position_library treat null as shared/master).

### 2c. RLS posture (so the scope doesn't re-open closed holes)

Primary isolation is **server-side `scope()` on `hospital_id`** via the service-role client (which **bypasses RLS**); RLS is the defense-in-depth floor. The prior-audit `using(true)`/role-only holes were **fixed** — `074-rls-tenant-lockdown` (op_*, competency_decisions), `103-rls-positions-lockdown`, `045-rls-lock-platform-tables` (plat_*/tenants/enterprises). Remaining open reads are **intentional shared content** (frameworks, taxonomies, policies). Any org-tenancy work must preserve these locks.

### 2d. Asset tables (from the unified-model scope)

`cap_assets` and the 12 sources carry **only `hospital_id`** — 5/12 directly, 7/12 resolved via FK chains. **No asset table has `organisation_id`, `tenant_id`, or a country key.** The populator already resolves `hospital_id` up the chain — the natural hook to *also* resolve `organisation_id`/`tenant_id`.

> **Doc inconsistency to fix:** `docs/PLATFORM-ARCHITECTURE-CONFORMANCE.md` (PDS-000) claims "tenant hierarchy + `tenant_id` scoping ✅". That's aspirational — the code scopes on `hospital_id`. `docs/CAP-001-unified-asset-model-scope.md` ("tenant == hospital_id") is the accurate account. This scope recommends correcting the conformance doc.

---

## 3. The gap per level

| Level | Table? | Written? | Scopes data today? | Work to make assets inherit |
|---|---|---|---|---|
| **Global** | convention (`hospital_id IS NULL`) | super-admin | yes (null = shared) | **Formalize** — surface "Global" explicitly |
| **Country** | **NO** | text only | **no** | **Net-new** — `countries` dim + FKs + revive `country_admin` |
| **Organisation** | yes (006/041) | yes (Enterprise Admin) | **no** | **Wire** — add `organisation_id`/`tenant_id` to assets + resolve up the chain |
| **Dept / Unit** | yes (006/052) | yes (Structure Builder) | via `hospital_id` | Inherit hospital tenancy (mostly already covered) |
| **Hospital** | yes | yes | **YES — the sole key** | — |

---

## 4. Architecture decision — additive CAP dimension vs platform enforcement re-point

| | **A — CAP org dimension** ✅ recommended | **B — Platform enforcement up the chain** | **C — Country dimension** |
|---|---|---|---|
| What | `organisation_id`/`tenant_id` on `cap_assets`, resolved from the existing hospital→org chain; Browser filters/inherits by org | Extend `scope()` so a caller scoped to an org reads all its hospitals' data | Promote free-text country to a real `countries` dimension + FKs |
| Touches | `cap_assets` + populator + Browser (CAP-local) | **~130 scope modules / 408 refs + RLS + `api-auth.ts`** | new table + FKs on org/hospital + revive mig-008 machinery |
| Risk | low (additive, CAP-scoped) | **very high (platform-wide isolation change)** | med (new dimension, orphaned code to revive) |
| Delivers | org visibility/inheritance/filtering for assets | true org-level isolation | country roll-up + country_admin |

**Decision: build A.** It realizes CAP-002's *inheritance/visibility* intent for assets by **reading the org hierarchy that already exists** — no new tables, no enforcement change, no re-point. B (true org isolation) and C (country) stay flagged as the platform re-platform.

---

## 5. Proposed design (the additive slice)

### 5a. Resolve org/tenant on populate (extend, don't re-point)
The populator (`registry.ts`) already builds `hospital_id` via FK-chain resolvers. Add one hop: `hospitals.organisation_id` and `hospitals.tenant_id` → denormalize `organisation_id`/`tenant_id` onto `cap_assets` alongside `hospital_id`. Enterprise-level (`hospital_id IS NULL`) assets get null org = **Global**.

```
migration: alter table cap_assets add column organisation_id uuid, add column tenant_id uuid;  (nullable, no FK enforcement — denormalized snapshot, same idiom as hospital_id)
registry.ts: resolvers gain hospital→{organisation_id, tenant_id}; each asset row carries all three.
```

### 5b. Browser filter + inheritance view
- Add an **organisation filter** to the Asset Browser (super-admin sees all; the chip reads `organisations` for labels). Assets show their tenancy as **Global / Org / Hospital** (today it's just Global/Tenant).
- **Inheritance display** (read-only): an org-level asset is shown as available to its hospitals — a visibility rollup, not an isolation change.

### 5c. Honest boundary in the UI
Label clearly that org is a **visibility/inheritance dimension**, not (yet) an isolation boundary — a user's *access* is still governed by `hospital_id`. No false security implication.

---

## 6. Phased plan

| Phase | Deliverable | Migration? | Risk |
|---|---|---|---|
| **T1 — Org dimension on cap_assets** | `organisation_id`/`tenant_id` columns + populator resolves them from the existing chain | 1 additive | low |
| **T2 — Browser org filter + Global/Org/Hospital labels + inheritance view** | filter chip + tenancy label + read-only rollup | none | low |
| **— additive CAP slice ends here —** | | | |
| **B — Platform org isolation** *(out of scope)* | extend `scope()`/`api-auth.ts` to resolve up the chain; RLS to match | invasive, ~130 modules | **very high, multi-quarter** |
| **C — Country dimension** *(out of scope)* | `countries` table + FKs + revive `country_admin` (mig 008) | many | high |
| **D — Conformance doc fix** | correct the aspirational "tenant_id scoping ✅" claim | none | trivial |

**Effort (T1+T2):** ~1 week, additive, CAP-local. **B and C are the re-platform** — B especially, because org-level isolation rewrites the tenancy boundary that 130 modules depend on.

---

## 7. Key decisions

- **Read the existing hierarchy, don't rebuild it** — org tables are real; resolve up `hospitals.organisation_id`.
- **Org = inheritance/visibility for assets, not isolation** (in the additive slice). Isolation stays `hospital_id` until Phase B.
- **Country is net-new** — deferred; don't fake it from free-text.
- **Global = the `hospital_id IS NULL` convention**, surfaced explicitly.
- **Denormalized snapshot columns** (no hard FK), same idiom as `cap_assets.hospital_id` — resilient to the drift we've seen.
- **Preserve RLS locks** (074/103/045) — additive columns only, no policy changes.

---

## 8. Risks

- **Isolation illusion** — showing an org dimension must not imply org-level access control exists. Mitigate: explicit "visibility, not isolation" labeling.
- **Phase B blast radius** — extending `scope()` beyond `hospital_id` touches ~130 modules + RLS; a wrong move is a cross-tenant leak. This is why B is out of the additive slice.
- **Stale org resolution** — like all `cap_assets` snapshots, org/tenant drift until refresh. Same accepted trade-off as `hospital_id`.
- **Reviving orphaned country_admin** (Phase C) — mig-008 machinery is dead code; reviving vs replacing needs its own analysis.

---

## 9. What this is *not*

- Not building an org model (it exists) — it's *reading* it.
- Not changing tenant isolation — `hospital_id` stays the enforced boundary in the additive slice.
- Not the country dimension (net-new, deferred).
- Not a platform-wide `scope()` change (that's Phase B, the re-platform).

---

## 10. Recommendation

Build **T1 + T2** — give `cap_assets` an `organisation_id`/`tenant_id` dimension resolved from the **already-existing** hierarchy, and let the Asset Browser filter and show tenancy as Global / Org / Hospital with a read-only inheritance view. It delivers CAP-002's inheritance intent for assets, additively, by wiring what's already built — **no new org model, no enforcement change, no re-point.** True org-level isolation (Phase B) and the country dimension (Phase C) remain the honestly-flagged multi-quarter re-platform, and the conformance-doc claim should be corrected (Phase D) regardless.
