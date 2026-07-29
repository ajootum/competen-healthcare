# CAP-001 — Unified Asset-Object Model: Scope & Build Plan

**Status:** Scoping (not yet built) · **Author:** Claude · **Date:** 2026-07-29
**Companion to:** `docs/CAP-006-semantic-search-scope.md` · Memory: `cap-build-plan`

---

## Verdict

Build it as an **additive overlay, not a destructive re-platform.** A single canonical `cap_assets` header row that *references* the existing 12 asset tables via the `(object_type, object_id)` key the codebase already uses everywhere — populated by a loop that generalizes the CAP-006 search indexer — delivers the CAP-001 "single source of truth" object model **without moving a single row or rewriting any of the 171 consuming files.**

The destructive reading of CAP-001 ("collapse every asset table into one `cap_assets`, re-point all consumers") is a genuine multi-quarter re-platform with real data-loss and cross-tenant-RLS risk. It is explicitly **out of scope** for the buildable slice below and flagged as Phase 4.

Grounding for that call, from a fresh audit of the codebase:

- **All 12 asset tables use `uuid` primary keys** (`gen_random_uuid()`), no exceptions — so one polymorphic `asset_id uuid` + `asset_type` discriminator works with **zero key-remapping cost**.
- The `(object_type, object_id)` polymorphic pattern is **already the platform's universal record-pointer** — 16 instance-level tables + `audit_log` (~40 write sites) use it, explicitly "no FK because the referenced table varies by type."
- The exact "project heterogeneous asset tables into one `(type,id)` space without moving data" move is **already proven twice** in production: `knowledge_embeddings` + `indexer.ts` (5 types), and the `search_ckcm` UNION (9 tables). `cap_assets` is that same move, promoted to a first-class governed header.
- A destructive re-home would have to re-point **171 files / 314 `.from()` references** *and* reconcile the divergent status/version conventions of 16 polymorphic overlays. The additive overlay touches none of them.

---

## 1. What the reference set specifies (design intent)

From `CAP-000` (Platform Architecture), `CAP-001` (Repository Engine), `CAP-002` (Metadata & Classification):

**One governed object per asset**, carrying:

| Group | Fields |
|---|---|
| **Identity** | Asset ID · Name · Type · Description · Version · Status · Language |
| **Clinical** | Clinical Domain · Specialty · Subspecialty · Care Setting · Patient Population |
| **Organizational** | Country · Organization · Hospital · Department · Unit · Role · Professional Cadre |
| **Educational** | Learning Level · Competency Level · Bloom's · Miller's · Learning Pathway |
| **Governance** | Owner · Author · Reviewer · Approver · Review Cycle · Effective/Expiry Date |
| **Search** | Keywords · Tags · Synonyms · Clinical Terms · Semantic Embeddings |
| **Standards** | JCI · WHO · SafeCare · National / Internal |
| **AI** | Similar Assets · Duplicate Probability · Knowledge Confidence |

**13 managed asset types:** competency frameworks, competencies, skills, assessment blueprints, OSCE stations, simulation scenarios, learning resources, policies/SOPs, clinical guidelines, evidence templates, quality standards, AI prompts, rules & rubrics.

**One unified authoring lifecycle:**
`Author → Draft → Clinical Review → Governance Approval → Published → Assigned → Used → Assessed → Analytics → Revision → Archive`

**Repository APIs:** Create · Read · Update · Archive · Restore · **Clone · Link · Search · Publish · Validate**.

**Multi-tenant hierarchy:** Global Library → Country → Organization → Department → Personal.

> The reference set is a *full re-platform blueprint* (formal asset schema + object storage for binaries + multi-tenant inheritance). The scope below extracts the **buildable, high-value core** of that blueprint that fits the existing platform additively.

---

## 2. Current-state inventory

### 2a. The 12 asset tables — one common shape hiding under 12 dialects

| Table | Migration | Name col | Tenant | Status convention | Version | Consumers |
|---|---|---|---|---|---|---|
| `framework_competencies` | 003 | `name` | via `domain_id` chain | **none** | — | **89** |
| `frameworks` | 003 | `name` | `hospital_id` | `is_active` bool + `pub_status` | — | **62** |
| `clinical_practice_units` | 011 | `name` | via `practice_id` chain | `pub_status` text | `version_num` **int** | **51** |
| `knowledge_objects` | 025 | `title` | via `cpu_id` chain | `status` text | — | **39** |
| `question_banks` | 022 | `name` | via `cpu_id` (nullable) | `is_active` bool | — | **24** |
| `assessment_blueprints` | 011 | *(none — `unique(cpu_id)`)* | via `cpu_id` | none | — | 15 |
| `learning_resources` | 014 | `title` | `hospital_id` (null=global) | `is_active` bool | — | 12 |
| `skill_library` | 020 | `name` | none (global) | `is_active` bool | — | 5 |
| `osce_stations` | 033 | `name` | via `exam_id` chain | none (parent) | — | 5 |
| `competency_packages` | 130 | `name` | `hospital_id` | `status` text | `version` **text** | 5 |
| `simulation_scenarios` | 131 | `name` | `hospital_id` | `status` text | `version` **text** | 4 |
| `cmo_publications` | 115 | `name` | `hospital_id` | `status` text | `version` **text** | 3 |

**Universal (safe to hoist):** `id uuid` (**12/12**), `created_at` (**12/12**), a human name (**11/12** — only `assessment_blueprints` lacks one; it is a per-CPU config, not a named asset).

**Divergent (must be normalized on read, not merged in place):**
- **Tenant** — only **5/12** carry `hospital_id`; the other 7 inherit tenancy *transitively* up an FK chain (`competency→domain→framework`; `cpu→practice→domain`; `blueprint/bank/CKO→cpu`; `station→exam`). **There is no `organization_id` anywhere** — tenant == `hospital_id`.
- **Status** — three incompatible conventions: text lifecycle (5 different enum sets), boolean `is_active`, or none.
- **Version** — only 4/12, mixed `int` vs `text`. `updated_at` only 2/12. `created_by` only 5/12.

**Blast radius of a re-home:** **171 distinct source files**, 314 `.from()` references, ~265 of them in five tables. Concentrated in hub loaders `studio-data.ts`, `super-admin/ckp*.ts`, `competency-office-data.ts` — and `super-admin/studio/assets/page.tsx`, which **already queries all 12** (the de-facto unified browser and the natural first surface).

### 2b. Unification infrastructure that already exists (~60-70%, as convention)

1. **A pervasive `(type, id)` polymorphic convention** — 16 instance-level overlay tables reference assets FK-lessly: `object_tags` (CAP-002 metadata/013), `knowledge_embeddings` (CAP-006/017), `knowledge_edges` (CAP-007 relationships/012, double-poly source+target), `cap_asset_translations` (CAP-012/137), `competency_package_items` (composition/130), plus `audit_log`, `plat_comments`, approval requests, `domain_events`, `ogs_signatures`, quality/knowledge links, `cmo_renewals`.
2. **A working unified index** — `knowledge_embeddings(object_type, object_id, …)` populated by `indexer.ts`'s `SOURCES` map (5 types today). The overlay-populate pattern is production-proven.
3. **A working unified read view** — `search_ckcm` (058) UNIONs 9 asset tables into `(object_type, object_id, title, snippet, rank)`; `match_assets` (138) returns the same shape; `hybrid.ts` RRF-fuses them.
4. **A governed-registry precedent** — `configuration_registry_objects` (WCE-002/092): versioned rows + immutable audit + service-role RLS. The exact schema idiom `cap_assets` should reuse. *(But it catalogues object **types**, not asset **instances**.)*
5. **A composition layer** — `competency_packages` + `competency_package_items(item_type, item_id, item_label)` already bundle across 7 asset types.
6. **The CAP information architecture** — `super-admin/studio/assets/page.tsx` (CAP-000..016) already maps every asset type + engine to its surface and explicitly flags "a unified asset-object model" as the Planned gap.

---

## 3. The gap — what is genuinely missing

- **The header row itself.** No `cap_assets`. `cap_asset_translations` is the only `cap_`-prefixed table.
- **Normalized status / version / language on one spine.** Source tables disagree; `framework_competencies` has no status column at all; language lives *only* in `cap_asset_translations`, never on the asset.
- **A shared asset-type vocabulary.** Every table hard-codes its own `CHECK` list and the four that overlap (indexer=5, translations=10, package_items=7, object_tags=freetext) **do not agree**. There is no canonical enum.
- **An asset *authoring* lifecycle.** `competency_lifecycle_state` (126) is *worker × competency achievement*, not asset author→review→publish. `cmo_publications` is per-artifact-name and holds **no `asset_id`**.
- **Centralized clone / link / publish / validate keyed to one asset id.** These exist piecemeal (`templates.ts`=reuse, `dependencies.ts`/`knowledge_edges`=link, publishing=publish, `rules-engine`=validate) but not behind one service addressed by a single unified id.

---

## 4. Architecture decision — additive overlay (with evidence)

| | **Additive overlay** ✅ recommended | **Destructive re-home** ❌ |
|---|---|---|
| Data movement | None — references existing rows | Migrate every asset row |
| Consumer changes | Zero (171 files untouched) | Re-point + reconcile 171 files / 16 overlays / ~40 audit sites |
| RLS risk | Each source table keeps its own policy; overlay inherits `hospital_id` on populate (like `knowledge_embeddings`) | Collapse many `hospital_id` policies into one set → cross-tenant leak surface |
| Status/version | Normalized on read; source stays truth (lossless) | Lossy merge of `is_active`/`pub_status`/`status`/none into one column |
| Idiom fit | Matches every migration ("additive & idempotent") and mig 040's "legitimize drift additively" precedent | Cuts against the entire established convention |
| Proven here | Yes — twice (`indexer`+embeddings, `search_ckcm`) | Never attempted |

**Decision: additive overlay.** `cap_assets` becomes the governed header/index; the 12 typed tables remain the source of truth for type-specific payload; every existing overlay (`object_tags`, `knowledge_edges`, `cap_asset_translations`, `competency_package_items`, `knowledge_embeddings`) already carries the `(object_type, object_id)` needed to attach to it — no data movement, no rewrite.

---

## 5. Proposed design

### 5a. Canonical vocabulary (Phase 1)

A single source-of-truth map (code + a small reference table), reconciling the four disagreeing vocabularies to the 13 CAP-000 types:

```
cap_asset_types(key text pk, label text, source_table text, id_column text,
                name_column text, tenant_mode text)   -- 'direct' | 'chain:<join path>' | 'global'
```

Seeded rows (12 real today; `policy`/`guideline`/`evidence_template`/`ai_prompt`/`rubric` reserved for when those stores land):

```
framework          → frameworks.id / name              / direct(hospital_id)
competency         → framework_competencies.id / name  / chain(domain→framework.hospital_id)
skill              → skill_library.id / name           / global
cpu                → clinical_practice_units.id / name / chain(practice→domain.hospital_id)
blueprint          → assessment_blueprints.id / (cpu)  / chain(cpu→…)
question_bank      → question_banks.id / name          / chain(cpu→…)   [nullable→global]
osce_station       → osce_stations.id / name           / chain(exam.hospital_id)
simulation         → simulation_scenarios.id / name    / direct(hospital_id)
learning_resource  → learning_resources.id / title     / direct(hospital_id, null=global)
knowledge_object   → knowledge_objects.id / title      / chain(cpu→…)
package            → competency_packages.id / name     / direct(hospital_id)
publication        → cmo_publications.id / name        / direct(hospital_id)
```

### 5b. The header table (Phase 1)

```
cap_assets(
  id uuid primary key default gen_random_uuid(),
  object_type text not null,          -- references cap_asset_types.key
  object_id   uuid not null,
  name        text,
  owner_id    uuid,                    -- from created_by where present, else null
  hospital_id uuid,                    -- resolved on populate (direct or via chain); null = enterprise/global
  domain      text,                    -- clinical domain where derivable
  status      text,                    -- normalized: draft|in_review|approved|published|active|retired|archived
  version     text,                    -- stringified; '1.0' default
  language    text default 'en',
  tags        jsonb default '[]',      -- denormalized from object_tags on populate
  source_created_at timestamptz,
  source_updated_at timestamptz,
  indexed_at  timestamptz default now(),
  unique(object_type, object_id)
)
```

Plain, idempotent statements (no PL/pgSQL do-blocks — the user's `;`-splitting runner requires it). RLS mirrors `knowledge_embeddings`.

**Status normalization map** (per type, applied on populate/read — lossless because source stays truth):
`is_active=true → active` / `is_active=false → archived`; `pub_status`/`status` text passed through to the canonical set; `framework_competencies` (no status) → inherit parent framework, default `active`.

### 5c. The populator (Phase 2) — generalize the indexer

`src/lib/assets/registry.ts`, a direct sibling of `src/lib/search/indexer.ts`:

```
refreshAssets(admin, limit?)  // upsert one cap_assets row per source row, onConflict (object_type,object_id)
assetIndexStatus(admin)       // { total, byType, staleCount }
```

Each `SOURCES` entry: `{ type, table, select, name(row), tenant(row)→hospital_id, status(row), version(row) }`. The 7 chain-tenant types resolve `hospital_id` via a join on populate; unresolved → null (enterprise). Snapshot-in-time, exactly like embeddings.

`POST /api/admin/assets/refresh` (super_admin: GET status / POST refresh) with `audit_log`. **Dormant-safe and free** — pure DB reads/writes, no paid calls, no consumer impact.

### 5d. Unified service + surface (Phase 3)

- `src/lib/assets/service.ts` — `readAsset(type,id)` (header + typed payload), `listAssets({type,domain,status,hospitalId,tag})`. The CAP-001 **Clone/Link/Publish/Validate** ops are **façade delegations** to existing engines (`templates.ts`, `knowledge_edges`/`dependencies.ts`, publishing, `rules-engine`), now addressable by the unified id — honestly a façade, not new engines.
- Upgrade `super-admin/studio/assets` from a *counting* hub into a real **Asset Browser** reading `cap_assets` (filter by type/domain/status/tenant, search via the existing hybrid endpoint, drill to the source surface). This is CAP-001's "Repository Administration Console."

---

## 6. Phased breakdown

| Phase | Deliverable | Migration? | Consumer changes | Risk |
|---|---|---|---|---|
| **1 — Header + vocabulary** | `cap_assets` + `cap_asset_types` (seeded) + status/tenant maps documented | 1 additive, idempotent | none | low |
| **2 — Populator** | `registry.ts` `refreshAssets`/`assetIndexStatus` + `/api/admin/assets/refresh` + audit | none | none | low |
| **3 — Service + browser** | `assets/service.ts` (read/list + façade clone/link/publish/validate) + real Asset Browser on `/studio/assets` | none | additive only | low–med |
| **— buildable slice ends here —** | | | | |
| **4 — True re-platform** *(next-phase, not additive)* | write-back normalized status/version onto source tables · attach overlays to `cap_assets` via real FK · binary/object storage (Supabase Storage) for asset files · Global→Country→Org→Dept tenancy (needs an org model that does not exist today) | many, some destructive | 171-file blast radius | high |

**Effort (Phases 1–3, the additive overlay):** ~2–3 weeks. Comparable to CAP-006 in code, heavier only in the populator (12 sources, chain-tenant joins, status maps) and the browser UI. **Phase 4 is the multi-quarter re-platform** and is deliberately excluded.

**Smallest valuable slice:** Phases **1 + 2**. The moment `cap_assets` exists and is populated, the platform has a real single-source-of-truth spine that the existing search index, tags, relationships, translations and packages already know how to attach to — and the Asset Browser (Phase 3) becomes a thin read over it.

---

## 7. Key decisions

- **Overlay, not re-home** — decisive; see §4.
- **Tenant for the 7 chain-tenant tables** — resolve `hospital_id` via the documented FK chain on populate; unresolved → `null` (enterprise). No `organization_id` is invented (none exists).
- **Status** — normalize to a canonical 7-value set on populate; source remains truth; `framework_competencies` inherits from parent framework.
- **Version** — canonical `text`; `version_num int` (cpu) stringified; the 8 without version default `'1.0'`.
- **Asset-type enum** — one canonical list = the 13 CAP-000 types; the four disagreeing vocabularies map to it via `cap_asset_types`.
- **Freshness** — MVP = manual/on-demand refresh (snapshot, like embeddings). Later: a refresh-on-write hook, or event-driven via `domain_events` (102). Not real-time in the additive slice.

---

## 8. Risks

- **Staleness** — the overlay drifts from source between refreshes (same property as `knowledge_embeddings`). Mitigate with a refresh-on-write hook in the studio write-paths, or a scheduled refresh. Acceptable for a browse/governance index; **not** to be treated as transactional truth.
- **Normalization is advisory until Phase 4** — `cap_assets.status/version` are *derived*; the source table stays authoritative. Any write-back is Phase 4 and touches the source schema.
- **Reuse ≠ dedup** — `(object_type, object_id)` uniquely identifies a *row*, not a *logically identical asset reused across tenants*; cross-tenant dedup is CAP-010 (Reuse), separate.
- **Scope creep** — the pull toward "just re-home the tables" is the entire Phase-4 blast radius. Hold the line at overlay for the additive build.

---

## 9. What this is *not*

- Not moving data out of the 12 tables; not rewriting the 171 consumers.
- Not the binary/object-storage layer for asset files (CAP-001 "binary assets") — greenfield, Phase 4.
- Not the Global→Country→Organization→Department inheritance hierarchy — there is no organization model in the schema today.
- Not an authoring-lifecycle write engine — `cap_assets.status` is derived; normalized write-back is Phase 4.

---

## 10. Recommendation

Build **Phases 1–3 as an additive overlay.** It realizes the CAP-001 promise — "every competency asset exists once, is governed once, is reused everywhere" — as a *governed header + index* over the assets that already exist, using the platform's own proven `(object_type, object_id)` idiom, with **zero data movement, zero consumer rewrites, and no paid calls.** It turns the six de-facto unification fragments (embeddings, tags, relationships, translations, packages, the search UNION) into spokes around a real hub. The destructive re-platform (Phase 4) stays honestly flagged as the multi-quarter effort it is.

Start with the **1 + 2 slice** (header table + populator); the browser and façade service follow cheaply once the spine is populated.
