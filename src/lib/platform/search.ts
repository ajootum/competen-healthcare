// Platform Search Service (PFS-000 Search / PCS-000 Search Index). One unified
// cross-entity search over the existing Postgres store — tenants, organisations,
// users, frameworks, competencies, workspaces and the audit trail — using Postgres
// ILIKE (the stack's native full-text capability; a dedicated engine like
// Elasticsearch stays an honest infra-scale gap). Every source is fail-soft: a
// missing table or column degrades that source to empty instead of failing the
// whole search. Returns results grouped by type, each with a deep link. Landlord
// scope — searches across all tenants, but EACH SOURCE is gated by the capability that
// governs its own page (HQ-PLATFORM-SEARCH-REGATE). A source the caller does not hold is
// never queried and never mentioned in the response.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type SearchHit = { type: string; icon: string; label: string; sub?: string | null; href: string };
export type SearchGroup = { type: string; icon: string; hits: SearchHit[] };

// Sanitise the query for a PostgREST or()/ilike filter — strip the delimiters
// (comma, parens, dot) and other punctuation that would break filter parsing.
export const MIN_QUERY = 2;
export const MAX_QUERY = 60;      // the cleaned term
export const MAX_RAW_QUERY = 120; // the route refuses anything longer before cleaning
export const MAX_PER_SOURCE = 10;
const clean = (q: string) => q.replace(/[^\p{L}\p{N} _-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
// `_` survives clean() and is an ilike wildcard; `%` and `\` are stripped by it but escaped here too so this
// stays safe if clean() is ever loosened.
export const escapeLike = (q: string) => q.replace(/[\\%_]/g, m => "\\" + m);

// capability: the HQ capability that opens the page this source mirrors. null = owner only (no page found
// that governs this source, so nothing is widened).
type Source = { capability: string | null; activeOnly?: boolean; type: string; icon: string; table: string; cols: string[]; select: string; label: (r: any) => string; sub?: (r: any) => string | null; href: (r: any) => string };

const SOURCES: Source[] = [
  { capability: "hq.platform.operations.view", type: "Tenants", icon: "🏢", table: "tenants", cols: ["name", "slug"], select: "id, name, slug", label: r => r.name ?? r.slug ?? "Tenant", sub: r => r.slug ?? null, href: r => `/super-admin/platform-ops/tenants/${r.id}` },
  { capability: "hq.platform.tenants.view", type: "Organisations", icon: "🏛️", table: "hospitals", cols: ["name"], select: "id, name", label: r => r.name ?? "Organisation", href: () => `/super-admin/organisations` },
  { capability: "hq.platform.users.view", type: "Users", icon: "👤", table: "profiles", cols: ["full_name", "email"], select: "id, full_name, email", label: r => r.full_name ?? r.email ?? "User", sub: r => r.email ?? null, href: r => `/super-admin/users?user=${r.id}` },
  { capability: "hq.learning.competencies.view", type: "Frameworks", icon: "📐", table: "frameworks", activeOnly: true, cols: ["name"], select: "id, name", label: r => r.name ?? "Framework", href: r => `/super-admin/competencies` },
  { capability: null, type: "Competencies", icon: "🎯", table: "framework_competencies", cols: ["name", "code"], select: "id, name, code", label: r => r.name ?? "Competency", sub: r => r.code ?? null, href: () => `/super-admin/competencies` },
  { capability: "hq.platform.operations.view", type: "Workspaces", icon: "🗂️", table: "plat_workspaces", cols: ["label", "code", "description"], select: "id, code, label", label: r => r.label ?? r.code ?? "Workspace", sub: r => r.code ?? null, href: () => `/super-admin/platform-ops/workspaces` },
  { capability: "hq.platform.audit.view", type: "Activity", icon: "📜", table: "audit_log", cols: ["entity_name", "action"], select: "id, entity_name, action, created_at", label: r => r.entity_name ?? ((r.action ?? "").replace(/_/g, " ") || "Activity"), sub: r => (r.action ?? "").replace(/_/g, " ") || null, href: () => `/super-admin/audit` },
];

async function searchSource(admin: any, src: Source, q: string, perSource: number, owner: boolean): Promise<SearchGroup | null> {
  try {
    const e = escapeLike(q);
    const or = src.cols.map(c => `${c}.ilike.%${e}%`).join(",");
    let query = admin.from(src.table).select(src.select).or(or).limit(perSource);
    // The frameworks page lists active frameworks only; a delegate sees no more than that. The owner keeps today's behaviour.
    if (src.activeOnly && !owner) query = query.eq("is_active", true);
    if (src.table === "audit_log") query = query.order("created_at", { ascending: false });
    const { data, error } = await query;
    if (error || !data?.length) return null;
    return { type: src.type, icon: src.icon, hits: data.map((r: any) => ({ type: src.type, icon: src.icon, label: src.label(r), sub: src.sub ? src.sub(r) : null, href: src.href(r) })) };
  } catch {
    return null;
  }
}

export type SearchAccess = { isOwner: boolean; capabilities: string[] };
const canSearch = (src: Source, a: SearchAccess) => a.isOwner || (src.capability != null && a.capabilities.includes(src.capability));

export async function platformSearch(admin: any, rawQuery: string, access: SearchAccess, perSource = 6): Promise<{ query: string; groups: SearchGroup[]; total: number; searched: string[] }> {
  const allowed = SOURCES.filter(s => canSearch(s, access));
  const searched = allowed.map(s => s.type); // only what the caller holds; refused sources are never named
  const q = clean(rawQuery ?? "");
  if (q.length < MIN_QUERY) return { query: q, groups: [], total: 0, searched };
  const cap = Math.max(1, Math.min(perSource, MAX_PER_SOURCE));
  const results = await Promise.all(allowed.map(s => searchSource(admin, s, q, cap, access.isOwner)));
  const groups = results.filter((g): g is SearchGroup => g != null && g.hits.length > 0);
  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  return { query: q, groups, total, searched };
}

// The catalogue of what platform search covers — for the console's "sources" hint.
export const SEARCH_SOURCES = SOURCES.map(s => ({ type: s.type, icon: s.icon }));
