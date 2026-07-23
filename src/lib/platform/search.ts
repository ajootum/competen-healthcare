// Platform Search Service (PFS-000 Search / PCS-000 Search Index). One unified
// cross-entity search over the existing Postgres store — tenants, organisations,
// users, frameworks, competencies, workspaces and the audit trail — using Postgres
// ILIKE (the stack's native full-text capability; a dedicated engine like
// Elasticsearch stays an honest infra-scale gap). Every source is fail-soft: a
// missing table or column degrades that source to empty instead of failing the
// whole search. Returns results grouped by type, each with a deep link. Super-admin
// (landlord) scope — searches across all tenants.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type SearchHit = { type: string; icon: string; label: string; sub?: string | null; href: string };
export type SearchGroup = { type: string; icon: string; hits: SearchHit[] };

// Sanitise the query for a PostgREST or()/ilike filter — strip the delimiters
// (comma, parens, dot) and other punctuation that would break filter parsing.
const clean = (q: string) => q.replace(/[^\p{L}\p{N} _-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);

type Source = { type: string; icon: string; table: string; cols: string[]; select: string; label: (r: any) => string; sub?: (r: any) => string | null; href: (r: any) => string };

const SOURCES: Source[] = [
  { type: "Tenants", icon: "🏢", table: "tenants", cols: ["name", "slug"], select: "id, name, slug", label: r => r.name ?? r.slug ?? "Tenant", sub: r => r.slug ?? null, href: r => `/super-admin/platform-ops/tenants?id=${r.id}` },
  { type: "Organisations", icon: "🏛️", table: "hospitals", cols: ["name"], select: "id, name", label: r => r.name ?? "Organisation", href: () => `/super-admin/organisations` },
  { type: "Users", icon: "👤", table: "profiles", cols: ["full_name", "email"], select: "id, full_name, email", label: r => r.full_name ?? r.email ?? "User", sub: r => r.email ?? null, href: r => `/super-admin/users?id=${r.id}` },
  { type: "Frameworks", icon: "📐", table: "frameworks", cols: ["name", "description"], select: "id, name", label: r => r.name ?? "Framework", href: r => `/super-admin/frameworks?id=${r.id}` },
  { type: "Competencies", icon: "🎯", table: "framework_competencies", cols: ["name", "code"], select: "id, name, code", label: r => r.name ?? "Competency", sub: r => r.code ?? null, href: () => `/super-admin/frameworks` },
  { type: "Workspaces", icon: "🗂️", table: "plat_workspaces", cols: ["label", "code", "description"], select: "id, code, label", label: r => r.label ?? r.code ?? "Workspace", sub: r => r.code ?? null, href: () => `/super-admin/platform-ops/workspaces` },
  { type: "Activity", icon: "📜", table: "audit_log", cols: ["entity_name", "action"], select: "id, entity_name, action, created_at", label: r => r.entity_name ?? ((r.action ?? "").replace(/_/g, " ") || "Activity"), sub: r => (r.action ?? "").replace(/_/g, " ") || null, href: () => `/super-admin/audit` },
];

async function searchSource(admin: any, src: Source, q: string, perSource: number): Promise<SearchGroup | null> {
  try {
    const or = src.cols.map(c => `${c}.ilike.%${q}%`).join(",");
    let query = admin.from(src.table).select(src.select).or(or).limit(perSource);
    if (src.table === "audit_log") query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error || !data?.length) return null;
    return { type: src.type, icon: src.icon, hits: data.map((r: any) => ({ type: src.type, icon: src.icon, label: src.label(r), sub: src.sub ? src.sub(r) : null, href: src.href(r) })) };
  } catch {
    return null;
  }
}

export async function platformSearch(admin: any, rawQuery: string, perSource = 6): Promise<{ query: string; groups: SearchGroup[]; total: number }> {
  const q = clean(rawQuery ?? "");
  if (q.length < 2) return { query: q, groups: [], total: 0 };
  const results = await Promise.all(SOURCES.map(s => searchSource(admin, s, q, perSource)));
  const groups = results.filter((g): g is SearchGroup => g != null && g.hits.length > 0);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  return { query: q, groups, total };
}

// The catalogue of what platform search covers — for the console's "sources" hint.
export const SEARCH_SOURCES = SOURCES.map(s => ({ type: s.type, icon: s.icon }));
