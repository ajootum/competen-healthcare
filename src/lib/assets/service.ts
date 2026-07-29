/* eslint-disable @typescript-eslint/no-explicit-any */
// CAP-001 — unified asset read service (Phase 3). Read/list/facets over the cap_assets index built by
// registry.ts, plus the source-surface deep-link map. This is a façade: it reads the governed header and
// hands off to the existing type surfaces and governance engines — it does not re-implement them.

type Admin = any;

export type AssetRow = {
  id: string;
  object_type: string;
  object_id: string;
  name: string | null;
  hospital_id: string | null;
  status: string | null;
  version: string | null;
  language: string | null;
  source_created_at: string | null;
  indexed_at: string | null;
};

export const TYPE_LABEL: Record<string, string> = {
  framework: "Framework", competency: "Competency", skill: "Skill", cpu: "Clinical Practice Unit",
  blueprint: "Assessment Blueprint", question_bank: "Question Bank", osce_station: "OSCE Station",
  simulation: "Simulation", learning_resource: "Learning Resource", knowledge_object: "Knowledge Object",
  package: "Package", publication: "Publication",
};

export const STATUS_ORDER = ["draft", "in_review", "approved", "published", "active", "archived"] as const;

// Drill-through to the source surface. Frameworks have an id-specific detail route; the rest hand off to
// their management surface (the unified browser routes you to the type's home, where the real actions live).
export function assetHref(type: string, id: string): string {
  switch (type) {
    case "framework": return `/super-admin/content/${id}`;
    case "competency": return "/super-admin/content";
    case "skill": return "/super-admin/studio/skills";
    case "cpu": return "/super-admin/studio/cpus";
    case "blueprint": return "/super-admin/assessment-methods";
    case "question_bank": return "/super-admin/studio/questions";
    case "osce_station": return "/super-admin/ckp/assessment";
    case "simulation": return "/super-admin/studio/simulations";
    case "learning_resource": return "/admin/resources";
    case "knowledge_object": return "/super-admin/ckp/repository";
    case "package": return "/super-admin/studio/packages";
    case "publication": return "/competency-office/publishing";
    default: return "/super-admin/studio/assets";
  }
}

// CAP-001 Phase 4 write-back — which canonical statuses each type can PERSIST to its source and round-trip
// cleanly through a refresh, and whether it has an editable version. Shared by writeback.ts + the row editor.
// Deliberately excluded (a codebase audit showed why, not an oversight):
//   • framework — is_active is INERT (never transitioned); its real lifecycle is pub_status, governed by the
//     framework lifecycle engine. Write-back must route there (W3), not poke a dead flag.
//   • publication — cmo_publications is select-only/inert; governed by the Publishing engine.
//   • competency / blueprint / osce_station — no source status column (kept advisory on the index).
//   • cpu.version_num — display-only, never written by any code; so cpu has status but no editable version.
// Boolean-status types (skill/question_bank/learning_resource) persist only active↔archived via is_active.
export const ASSET_STATUS_SUPPORT: Record<string, string[]> = {
  cpu: ["draft", "in_review", "approved", "published", "archived"],
  knowledge_object: ["draft", "active", "archived"],
  simulation: ["draft", "published", "archived"],
  package: ["draft", "published", "archived"],
  skill: ["active", "archived"],
  question_bank: ["active", "archived"],
  learning_resource: ["active", "archived"],
};
export const ASSET_VERSION_EDITABLE: Record<string, "text"> = {
  simulation: "text", package: "text",
};
// Types that ARE governed, just not here — the editor points the user to the right surface.
export const ASSET_GOVERNED_ELSEWHERE: Record<string, string> = {
  framework: "Frameworks are governed by the framework lifecycle — set status from the framework surface.",
  publication: "Publications are governed by the Publishing engine.",
};

// The CAP governance engines this repository composes (the façade targets — CAP-004/007/010/015).
export const ASSET_ENGINES = [
  { label: "Publishing", href: "/competency-office/publishing", desc: "Govern release" },
  { label: "Relationships", href: "/super-admin/studio/dependencies", desc: "Link & prerequisites" },
  { label: "Reuse", href: "/super-admin/studio/templates", desc: "Clone & template" },
  { label: "Review board", href: "/competency-office/review-board", desc: "Validate & approve" },
];

function scoped(q: any, opts: { hospitalId?: string | null; isSuper?: boolean }) {
  if (opts.isSuper) return q;
  const h = opts.hospitalId;
  // include enterprise/global rows (hospital_id null) plus the caller's tenant
  return h ? q.or(`hospital_id.eq.${h},hospital_id.is.null`) : q.is("hospital_id", null);
}

export async function listAssets(
  admin: Admin,
  opts: { type?: string; status?: string; q?: string; hospitalId?: string | null; isSuper?: boolean; page?: number; pageSize?: number }
): Promise<{ rows: AssetRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(opts.page ?? 1, 1);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  let q = admin.from("cap_assets").select("id,object_type,object_id,name,hospital_id,status,version,language,source_created_at,indexed_at", { count: "exact" });
  if (opts.type) q = q.eq("object_type", opts.type);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.q) q = q.ilike("name", `%${opts.q}%`);
  q = scoped(q, opts);
  q = q.order("indexed_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  const { data, count } = await q;
  return { rows: (data ?? []) as AssetRow[], total: count ?? 0, page, pageSize };
}

// Facet counts for the filter rail: assets by type and by status. Head counts keep it index-only (no rows
// pulled), so it is safe on large tables. Tenant-scoped for non-super callers.
export async function assetFacets(
  admin: Admin,
  opts: { hospitalId?: string | null; isSuper?: boolean }
): Promise<{ byType: Record<string, number>; byStatus: Record<string, number>; total: number }> {
  const types = Object.keys(TYPE_LABEL);
  const headCount = async (col: "object_type" | "status", val: string) => {
    let q = admin.from("cap_assets").select("id", { count: "exact", head: true }).eq(col, val);
    q = scoped(q, opts);
    const { count } = await q;
    return count ?? 0;
  };
  const [typeCounts, statusCounts] = await Promise.all([
    Promise.all(types.map(async t => [t, await headCount("object_type", t)] as const)),
    Promise.all(STATUS_ORDER.map(async s => [s, await headCount("status", s)] as const)),
  ]);
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const [t, n] of typeCounts) { byType[t] = n; total += n; }
  for (const [s, n] of statusCounts) byStatus[s] = n;
  return { byType, byStatus, total };
}
