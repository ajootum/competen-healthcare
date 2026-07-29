/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-001 — Unified Asset registry (Phase 2 populator). Generalises the CAP-006 search indexer
// (src/lib/search/indexer.ts) from 5 asset types to all 12: projects every source row into one
// cap_assets header keyed by (object_type, object_id). No data is moved and no consumer is rewritten —
// the 12 typed tables stay the source of truth; cap_assets is a governed, refreshable index over them.
// Dormant-safe and free: pure DB reads/writes, no external/paid calls, no impact on the source tables.

type Admin = any;
type Row = Record<string, any>;

// Canonical status set. Source tables use 3 incompatible conventions (text lifecycle / is_active bool /
// none); normalise them here on populate. The source row stays authoritative — this is advisory.
function normStatus(raw: unknown): string {
  if (raw === true) return "active";
  if (raw === false) return "archived";
  const s = String(raw ?? "").toLowerCase().trim();
  const map: Record<string, string> = {
    draft: "draft",
    in_review: "in_review", review: "in_review", scheduled: "in_review", pending: "in_review",
    approved: "approved",
    published: "published",
    active: "active",
    retired: "archived", archived: "archived", rolled_back: "archived", inactive: "archived",
  };
  return map[s] ?? (s || "active");
}

const PAGE = 1000;
// Supabase caps a select at 1000 rows; page through so large tables (e.g. framework_competencies) index fully.
async function fetchAll(admin: Admin, table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(select).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Tenant resolvers for the 7 chain-tenant tables (only 5/12 carry hospital_id directly). Built once per
// refresh from the FK chains: competency→domain→framework.hospital_id; cpu→practice→domain→framework;
// blueprint/bank/knowledge→cpu; osce_station→exam.hospital_id.
type Resolvers = { domain: Map<string, string | null>; cpu: Map<string, string | null>; exam: Map<string, string | null> };

async function buildResolvers(admin: Admin): Promise<Resolvers> {
  const [fw, dom, pr, cpus, exams] = await Promise.all([
    fetchAll(admin, "frameworks", "id,hospital_id"),
    fetchAll(admin, "framework_domains", "id,framework_id"),
    fetchAll(admin, "practices", "id,domain_id"),
    fetchAll(admin, "clinical_practice_units", "id,practice_id"),
    fetchAll(admin, "osce_exams", "id,hospital_id"),
  ]);
  const fwH = new Map<string, string | null>(fw.map(r => [r.id, r.hospital_id ?? null]));
  const domain = new Map<string, string | null>(dom.map(r => [r.id, fwH.get(r.framework_id) ?? null]));
  const practice = new Map<string, string | null>(pr.map(r => [r.id, domain.get(r.domain_id) ?? null]));
  const cpu = new Map<string, string | null>(cpus.map(r => [r.id, practice.get(r.practice_id) ?? null]));
  const exam = new Map<string, string | null>(exams.map(r => [r.id, r.hospital_id ?? null]));
  return { domain, cpu, exam };
}

type Source = {
  type: string;
  table: string;
  select: string;
  tenant: (r: Row, m: Resolvers) => string | null;
  name: (r: Row) => string;
  status: (r: Row) => string;
  version: (r: Row) => string;
  owner: (r: Row) => string | null;
  created: (r: Row) => string | null;
  updated: (r: Row) => string | null;
};

// The 12 source projections. Columns are the real, verified schema (see migration refs). Where a table
// has no native status/version/owner, we default honestly (competencies inherit "active"; the 8 without a
// version column default "1.0"); domain enrichment is deferred to Phase 3.
export const SOURCES: Source[] = [
  { type: "framework", table: "frameworks", select: "id,name,hospital_id,is_active,created_at",
    tenant: r => r.hospital_id ?? null, name: r => r.name, status: r => normStatus(r.is_active), version: () => "1.0", owner: () => null, created: r => r.created_at ?? null, updated: () => null },
  { type: "competency", table: "framework_competencies", select: "id,name,domain_id,created_at",
    tenant: (r, m) => m.domain.get(r.domain_id) ?? null, name: r => r.name, status: () => "active", version: () => "1.0", owner: () => null, created: r => r.created_at ?? null, updated: () => null },
  { type: "skill", table: "skill_library", select: "id,name,is_active,created_by,created_at",
    tenant: () => null, name: r => r.name, status: r => normStatus(r.is_active), version: () => "1.0", owner: r => r.created_by ?? null, created: r => r.created_at ?? null, updated: () => null },
  { type: "cpu", table: "clinical_practice_units", select: "id,name,practice_id,pub_status,version_num,created_at",
    tenant: (r, m) => m.cpu.get(r.id) ?? null, name: r => r.name, status: r => normStatus(r.pub_status), version: r => (r.version_num != null ? String(r.version_num) : "1.0"), owner: () => null, created: r => r.created_at ?? null, updated: () => null },
  { type: "blueprint", table: "assessment_blueprints", select: "id,cpu_id,created_at",
    tenant: (r, m) => m.cpu.get(r.cpu_id) ?? null, name: () => "Assessment blueprint", status: () => "active", version: () => "1.0", owner: () => null, created: r => r.created_at ?? null, updated: () => null },
  { type: "question_bank", table: "question_banks", select: "id,name,cpu_id,is_active,created_by,created_at",
    tenant: (r, m) => (r.cpu_id ? m.cpu.get(r.cpu_id) ?? null : null), name: r => r.name, status: r => normStatus(r.is_active), version: () => "1.0", owner: r => r.created_by ?? null, created: r => r.created_at ?? null, updated: () => null },
  { type: "osce_station", table: "osce_stations", select: "id,name,exam_id,created_at",
    tenant: (r, m) => m.exam.get(r.exam_id) ?? null, name: r => r.name, status: () => "active", version: () => "1.0", owner: () => null, created: r => r.created_at ?? null, updated: () => null },
  { type: "simulation", table: "simulation_scenarios", select: "id,name,hospital_id,status,version,created_by,created_at,updated_at",
    tenant: r => r.hospital_id ?? null, name: r => r.name, status: r => normStatus(r.status), version: r => r.version ?? "1.0", owner: r => r.created_by ?? null, created: r => r.created_at ?? null, updated: r => r.updated_at ?? null },
  { type: "learning_resource", table: "learning_resources", select: "id,title,hospital_id,is_active,created_at",
    tenant: r => r.hospital_id ?? null, name: r => r.title, status: r => normStatus(r.is_active), version: () => "1.0", owner: () => null, created: r => r.created_at ?? null, updated: () => null },
  { type: "knowledge_object", table: "knowledge_objects", select: "id,title,cpu_id,status,created_by,created_at",
    tenant: (r, m) => (r.cpu_id ? m.cpu.get(r.cpu_id) ?? null : null), name: r => r.title, status: r => normStatus(r.status), version: () => "1.0", owner: r => r.created_by ?? null, created: r => r.created_at ?? null, updated: () => null },
  { type: "package", table: "competency_packages", select: "id,name,hospital_id,status,version,created_by,created_at,updated_at",
    tenant: r => r.hospital_id ?? null, name: r => r.name, status: r => normStatus(r.status), version: r => r.version ?? "1.0", owner: r => r.created_by ?? null, created: r => r.created_at ?? null, updated: r => r.updated_at ?? null },
  { type: "publication", table: "cmo_publications", select: "id,name,hospital_id,status,version,created_at,published_at",
    tenant: r => r.hospital_id ?? null, name: r => r.name, status: r => normStatus(r.status), version: r => r.version ?? "1.0", owner: () => null, created: r => r.created_at ?? null, updated: r => r.published_at ?? null },
];

export const ASSET_TYPES = SOURCES.map(s => s.type);

// Refresh the cap_assets index from every source. Upsert on (object_type, object_id) so it is safe to
// re-run repeatedly; existing rows are updated in place and indexed_at is refreshed. Per-source failures
// are captured, not fatal — a missing/renamed source never blocks the rest.
export async function refreshAssets(admin: Admin): Promise<{ ok: boolean; total: number; byType: Record<string, number>; errors: Record<string, string> }> {
  const resolvers = await buildResolvers(admin);
  const now = new Date().toISOString();
  const byType: Record<string, number> = {};
  const errors: Record<string, string> = {};
  let total = 0;

  for (const src of SOURCES) {
    try {
      const rows = await fetchAll(admin, src.table, src.select);
      const mapped = rows.map(r => ({
        object_type: src.type,
        object_id: r.id, // every source table keys on a uuid `id`
        name: (src.name(r) ?? "").toString().slice(0, 300) || null,
        owner_id: src.owner(r),
        hospital_id: src.tenant(r, resolvers),
        domain: null as string | null,
        status: src.status(r),
        version: src.version(r),
        language: "en",
        source_created_at: src.created(r),
        source_updated_at: src.updated(r),
        indexed_at: now,
      }));
      for (let i = 0; i < mapped.length; i += 500) {
        const chunk = mapped.slice(i, i + 500);
        const { error } = await admin.from("cap_assets").upsert(chunk, { onConflict: "object_type,object_id" });
        if (error) throw error;
      }
      byType[src.type] = mapped.length;
      total += mapped.length;
    } catch (e) {
      errors[src.type] = e instanceof Error ? e.message : "failed";
    }
  }
  return { ok: Object.keys(errors).length === 0, total, byType, errors };
}

// Index status for the admin panel: per-type counts + total + last refresh time. No provider dependency
// (unlike embeddings) — the index is always available; it just needs a refresh to be current.
export async function assetIndexStatus(admin: Admin): Promise<{ total: number; byType: Record<string, number>; lastIndexedAt: string | null; types: number }> {
  const counts = await Promise.all(
    ASSET_TYPES.map(async t => {
      const { count } = await admin.from("cap_assets").select("id", { count: "exact", head: true }).eq("object_type", t);
      return [t, count ?? 0] as const;
    })
  );
  const byType: Record<string, number> = {};
  let total = 0;
  for (const [t, n] of counts) { byType[t] = n; total += n; }
  const { data: last } = await admin.from("cap_assets").select("indexed_at").order("indexed_at", { ascending: false }).limit(1).maybeSingle();
  return { total, byType, lastIndexedAt: last?.indexed_at ?? null, types: ASSET_TYPES.length };
}
