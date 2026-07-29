# CAP-001 — Status/Version Write-Back: Scope & Build Plan

**Status:** Scoping (not yet built) · **Author:** Claude · **Date:** 2026-07-29
**Companion to:** `docs/CAP-001-unified-asset-model-scope.md` · Memory: `cap-build-plan`
**Prereq shipped:** CAP-001 Phases 1–4 (overlay + populator + browser + overlay-spine + binary storage)

---

## Verdict

Build write-back as a **governed edit-through surface with per-type adapters — not a normalization of the 12 source tables.** Let a super-admin change an asset's status/version *from the unified Asset Browser*, and have that change written back to the source table **in the source's own native convention** (set `frameworks.is_active`, `clinical_practice_units.pub_status`, `simulation_scenarios.version`, …), routing through the governed chokepoints that already exist (the publishing engine; the COMP-017 lifecycle state machine) wherever they apply.

The literal reading of "write-back" — add one canonical `status`/`version` column to all 12 tables, backfill, re-point every reader to it, and rewrite every writer — is a genuine **multi-quarter re-platform with a 171-file blast radius** and real data-loss/regression risk. It is **out of scope** here and stays flagged as the deep normalization.

Why edit-through wins, from the CAP-001 audit:

- The 12 asset tables use **three incompatible status conventions** (text-lifecycle / `is_active` bool / none) and version on only **4/12** (mixed `int` vs `text`). There is no lossless single column to collapse them into — a canonical column forces a lossy mapping and a permanent dual-write.
- **171 files / 314 `.from()` references** consume these tables. Re-pointing their status/version reads to a canonical source is the whole re-platform; writes are a **small subset** of that (status/version are written at a few authoring/publish points and *read* everywhere).
- CAP **already governs status transitions** in two places — the publishing engine (`cmo_publications`, versioned publish history) and the COMP-017 lifecycle machine. Edit-through *reuses* these instead of inventing a parallel authority.

---

## 1. What "write-back" actually means (disambiguation)

"Write-back" is ambiguous across three very different designs. Naming them is half the scope:

| | Variant | Direction | Touches source schema? | Re-points readers? | Blast radius |
|---|---|---|---|---|---|
| **A** | **Normalize** — canonical `status`/`version` column on all 12 tables; readers/writers use it | source ← canonical column | **Yes (12 tables)** | **Yes (all status reads)** | **171 files, multi-quarter** |
| **B** | **Edit-through** — unified surface writes each source's *native* status/version via per-type adapters | Browser → source (native) | No | No | ~12 adapters + 1 API + UI |
| **C** | **Flip authority** — `cap_assets` becomes the read source of truth; source tables mirror it | cap_assets → source | No (new table) | **Yes (all status reads → cap_assets)** | **171 files** |

Today `cap_assets.status/version` are **derived, advisory snapshots** — the populator normalizes them on read; the source stays authoritative and disagrees with itself. Write-back's *value* is being able to **govern lifecycle from the unified surface and have it stick**. Variant **B** delivers exactly that value at a fraction of A/C's cost.

---

## 2. Design intent (CAP-003 Version Control, CAP-009 Lifecycle)

**Canonical lifecycle (CAP-009)** — the status ladder write-back should honor:
`Idea → Authoring → Draft → Clinical Review → Governance Review → Approved → Published → Assigned → Active Monitoring → Revision → Superseded → Archived → Retired`.
`cap_assets`' normalized set (`draft · in_review · approved · published · active · archived`) is a clean subset — the write-back target vocabulary.

**Canonical versioning (CAP-003)** — semver with governance:
- Major `2.0` = structural/clinical change · Minor `1.1` = approved enhancement · Patch `1.1.1` = correction.
- **Published versions are immutable**; a draft never overwrites published; rollback restores a prior approved version; every change is attributable.

**The governance rules that constrain write-back:** published assets require an approved change to move; major bumps require governance approval; historical versions are read-only; all transitions are audited and (for publish) e-signed.

---

## 3. Current state — what already governs status/version

The write-back does **not** start from nothing. Three governed chokepoints exist:

- **Publishing engine** (`/competency-office/publishing`, `cmo_publications`, `framework_versions`) — the governed publish + version-history path for published artifacts (COMP-011). This is the real "make it published, bump the version" authority.
- **COMP-017 lifecycle state machine** (`competency_lifecycle_state` + `transitionLifecycle`, wired into educator/validate) — a governed state machine, though currently scoped to competency *achievement* lifecycle, not asset authoring. Reusable pattern; possibly reusable table.
- **Per-type Studio authoring APIs** (`/api/studio/*`, `/api/content/*`) — where each source table's status is set today (e.g. a CPU's `pub_status`, a package's `status`). These are the natural hook points for adapters.

> The precise write-site vs read-site split across the 12 tables is being quantified by a codebase sweep; the numbers slot into §5. The established figure is that **171 files** touch these tables overall, with status/version **writes a small concentrated subset** and **reads the bulk** — which is exactly why re-pointing reads (A/C) is the expensive part and writing native status (B) is cheap.

---

## 4. Why not full normalization (Variant A) — the honest cost

- **Lossy collapse.** `is_active=true` → `active` or `published`? `framework_competencies` has *no* status — inventing one changes semantics. `version_num int` (cpu) vs `version text` (sim) don't share a scheme. Any single column is a lossy, opinionated rewrite of authoritative data.
- **Dual-write forever.** Until *every* reader moves to the canonical column, both the native column and the canonical must be kept in sync on every write — a permanent maintenance tax and a bug farm.
- **Re-point 171 files.** Every `.eq("is_active", true)`, every `.pub_status` read, every status filter across the platform would have to change to read the canonical source. That *is* the re-platform.
- **RLS + concurrency.** Writing normalized state onto 12 differently-scoped tables multiplies the surface for cross-tenant and race regressions.

Variant B avoids all four: no new column, no dual-write, no re-point, and it writes through each table's existing (RLS-correct) path.

---

## 5. Proposed design — governed edit-through (Variant B)

### 5a. Per-type write adapters
A small `src/lib/assets/writeback.ts` with one adapter per type mapping a **canonical intent** (`setStatus(canonical)`, `setVersion(semver)`) to the source's native write:

```
framework          → is_active = (canonical ∈ {active,published})           [+ pub_status if present]
skill / question_bank / learning_resource → is_active = (canonical ∈ {active,published})
cpu                → pub_status = mapCanonicalToPubStatus(canonical); version_num = major(semver)
knowledge_object   → status = mapCanonicalToKoStatus(canonical)
simulation / package → status = canonical; version = semver
publication        → route through the PUBLISHING ENGINE (governed), not a raw update
framework_competency / blueprint / osce_station → (no native status) → recorded on cap_assets only, flagged advisory
```

Types with no native status column keep write-back **advisory** (recorded on `cap_assets`, labeled "not persisted to source") rather than fabricating a column — honest, not silently lossy.

### 5b. Route through existing governance
- **Publish transitions** (`→ published`) and **version bumps** go through the **publishing engine** where the type participates in it — so publish stays governed/e-signed/immutable, not a raw column poke.
- Reuse the **audit + change-request** spine already used by publishing/review-board; every write-back writes `audit_log` and (for published assets) requires the same approval the publishing engine requires.

### 5c. The write-back API + surface
- `POST /api/admin/assets/writeback` (super-admin) — `{object_type, object_id, status?, version?}` → adapter → native write + `cap_assets` refresh for that row + audit. Rejects edits to `published` assets unless routed through publishing (immutability).
- **UI:** a small inline editor on the Asset Browser row (next to the status badge) — a status dropdown (canonical ladder) + version bump (major/minor/patch), super-admin only, with the "advisory only" note for the 3 status-less types.

### 5d. Immutability & rollback (CAP-003)
- Block direct status/version edits on `published` rows in the API; changes go via publishing (which snapshots history).
- Rollback is **deferred** to the publishing engine's version history — not reinvented here.

---

## 6. Phased plan

| Phase | Deliverable | Migration? | Risk |
|---|---|---|---|
| **W1 — Adapters + API** | `writeback.ts` (12 native adapters + canonical↔native maps) + `/api/admin/assets/writeback` + audit + published-immutability guard | none | med (writes authoritative source data) |
| **W2 — Edit surface** | Inline status/version editor on the Browser row; advisory note for status-less types; re-refresh the edited row | none | low |
| **W3 — Route publish/version through publishing** | For types in the publishing engine, `→published` and version bumps call the governed publish path (not raw update) | none | med |
| **— edit-through ends here —** | | | |
| **A — Full normalization** *(out of scope)* | canonical `status`/`version` column on 12 tables · backfill · re-point 171 readers · retire native columns | many, destructive | **very high, multi-quarter** |

**Effort (W1–W3, edit-through):** ~1.5–2 weeks. No migration; the risk is *behavioral* (it writes real asset state), mitigated by audit, the published-immutability guard, and routing publish through existing governance. **Smallest slice: W1 + W2** — you can govern status from the unified surface immediately for the types with a native status column.

---

## 7. Key decisions

- **Edit-through, not normalize** — decisive; see §1/§4.
- **Native writes, not a canonical column** — each adapter writes the source's own convention; no schema change, no dual-write, no re-point.
- **Status-less types stay advisory** — `framework_competencies`/`assessment_blueprints`/`osce_stations` record status on `cap_assets` only, clearly labeled; we do **not** fabricate a status column (that's Variant A).
- **Published is immutable** — direct edits blocked; publish/version go through the publishing engine (CAP-003 rule).
- **Reuse governance** — audit_log + change-request/approval spine already used by publishing/review-board; no parallel authority.
- **Version semantics** — semver bumps (major/minor/patch) on types that carry a version; `version_num int` (cpu) maps to the major integer; advisory elsewhere.

---

## 8. Risks

- **It writes authoritative source data** — the first time the CAP layer mutates asset tables (Phases 1–4 were read-only + an additive overlay). Mitigate: super-admin-only, audit every write, published-immutability guard, route publish through governance.
- **Partial coverage reads as complete** — 3 types can't persist status. Mitigate: the UI labels advisory writes explicitly; never imply a status stuck when it didn't.
- **Concurrency/staleness** — an edit-through write must re-refresh that `cap_assets` row so the index doesn't show stale state. Mitigate: single-row re-populate after each write.
- **Scope creep toward Variant A** — "just add a status column" is the whole re-platform. Hold the line at native writes.

---

## 9. What this is *not*

- Not a canonical `status`/`version` column on the 12 tables; not re-pointing the 171 consumers; not retiring native columns.
- Not a new version-history/rollback engine — that already lives in the publishing engine (CAP-003); write-back defers to it.
- Not a bypass of publish governance — `→ published` and major version bumps stay governed/e-signed.

---

## 10. Recommendation

Build **W1–W3 (governed edit-through).** It delivers the actual value of write-back — *govern an asset's status/version from the unified surface and have it persist* — by writing each source's native convention through its existing governed path, with **zero schema changes, zero consumer re-pointing, and full audit.** The destructive normalization (Variant A) stays honestly flagged as the multi-quarter re-platform it is.

Start with **W1 + W2** (adapters + inline editor) for the types with a native status column; add W3 (route publish through the publishing engine) once the edit surface is proven.
