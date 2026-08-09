import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { searchPractice, type SearchDomain } from "@/lib/practice/search";

// CPR-350's saved searches, history, filters and quick searches.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A SAVED SEARCH IS A QUERY, NOT A SNAPSHOT OF RESULTS.
//
// A security rule before it is a design one. The comp prints counts beside saved searches -- "High risk
// follow-ups 12". A STORED 12 would have been computed for whoever saved it, and every later reader
// would see a count of records they may have no right to open. A shared saved search would become a side
// channel: "there are 15 pending referrals" is information about the practice that a delegate with no
// referral access has just been told.
//
// So nothing here stores a result, a count, or an identifier of anything found. Running a saved search
// goes through searchPractice with the CALLER's capabilities -- the same gate every other search passes,
// evaluated fresh, every time. That is also why sharing one is safe.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// SEARCH HISTORY IS PRIVATE TO THE PERSON WHO SEARCHED. CPR-370's access log already answers "who read
// this patient"; this is a convenience for the person typing. A colleague being able to read it would
// turn a search box into a surveillance tool, and the queries people type are often a patient's name.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

export type SearchFilters = {
  domains?: SearchDomain[];
  fromDay?: string | null;
  toDay?: string | null;
  includeInactive?: boolean;
};

const KNOWN_DOMAINS: SearchDomain[] = [
  "patients", "encounters", "notes", "diagnoses", "problems", "treatments",
  "procedures", "documents", "followUps", "tasks", "threads", "contacts", "incoming",
];

/**
 * Normalise whatever was stored or posted into filters this build understands.
 *
 * A FILTER THIS BUILD DOES NOT UNDERSTAND IS DROPPED, NOT OBEYED. A saved search written by a later
 * version could otherwise narrow a search in a way the reader cannot see -- and a search that silently
 * hides results is worse than one that returns too many.
 */
export function normaliseFilters(raw: unknown): SearchFilters {
  const f = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const domains = Array.isArray(f.domains)
    ? (f.domains as unknown[]).map(String).filter(d => (KNOWN_DOMAINS as string[]).includes(d)) as SearchDomain[]
    : undefined;
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
  return {
    domains: domains && domains.length ? domains : undefined,
    fromDay: day(f.fromDay),
    toDay: day(f.toDay),
    includeInactive: f.includeInactive === true,
  };
}

/**
 * Run a search and record it in the caller's own history.
 *
 * THE COUNT STRIP IS COMPUTED HERE, FOR THIS READER. The comp's "Patients 42 · Encounters 128 ·
 * Documents 326" is per-domain counts of what THEY may see; a stored or shared count would be a number
 * about somebody else's permissions.
 */
export async function runSearch(admin: any, ctx: WorkspaceContext, query: string, filters: SearchFilters = {}) {
  const f = normaliseFilters(filters);
  const result = await searchPractice(admin, ctx, query, { domains: f.domains });

  // The date filter is applied to the hits rather than pushed into every domain query: the domains
  // carry different date columns and some carry none, and a filter silently ignored by half of them
  // would be worse than one applied consistently after the fact.
  const withinRange = (when?: string | null) => {
    if (!f.fromDay && !f.toDay) return true;
    if (!when) return false;
    const day = String(when).slice(0, 10);
    if (f.fromDay && day < f.fromDay) return false;
    if (f.toDay && day > f.toDay) return false;
    return true;
  };

  const groups = result.ran
    ? result.groups.map(g => ({ ...g, hits: g.hits.filter(h => withinRange(h.when)) })).filter(g => g.hits.length > 0)
    : result.groups;
  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  if (result.ran) {
    // Fire and forget: a history row that fails to write must not fail the search somebody is waiting
    // for. Same trade CPR-340 makes about notifications.
    await admin.from("practice_search_history").insert({
      workspace_id: ctx.workspaceId, user_id: ctx.userId, query: query.trim().slice(0, 200),
      filters: f, hit_count: total,
    }).then(() => undefined, () => undefined);
  }

  return {
    ...result,
    groups,
    total,
    filters: f,
    // The comp's per-module strip. Computed for THIS reader, never stored.
    counts: groups.map(g => ({ domain: g.domain, title: g.title, total: g.hits.length, truncated: g.truncated })),
    dateFiltered: !!(f.fromDay || f.toDay),
  };
}

// ── SAVED SEARCHES ───────────────────────────────────────────────────────────────────────────────────

export async function listSavedSearches(admin: any, ctx: WorkspaceContext) {
  const { data } = await admin.from("practice_saved_search")
    .select("id, owner_id, name, query, filters, favourite, shared, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .or(`owner_id.eq.${ctx.userId},shared.eq.true`)
    .order("favourite", { ascending: false }).order("name");

  return ((data ?? []) as any[]).map(s => ({
    ...s,
    filters: normaliseFilters(s.filters),
    mine: s.owner_id === ctx.userId,
    // NO COUNT. Not omitted for want of a query -- see the header. A number here would be about
    // somebody else's permissions.
  }));
}

export async function saveSearch(admin: any, ctx: WorkspaceContext, args: {
  name: string; query: string; filters?: SearchFilters; favourite?: boolean; shared?: boolean;
  correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  const name = args.name.trim();
  const query = args.query.trim();
  if (!name) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a saved search needs a name" };
  if (!query) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "there is nothing to save" };

  const { data, error } = await admin.from("practice_saved_search").insert({
    workspace_id: ctx.workspaceId, owner_id: ctx.userId, name, query,
    filters: normaliseFilters(args.filters ?? {}),
    favourite: args.favourite === true, shared: args.shared === true,
  }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "NAME_IN_USE", message: `you already have a saved search called "${name}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.search_saved",
    // The NAME, not the query: a query is often a patient's name, and the workspace audit trail is
    // readable by anybody with access.review.
    payload: { savedSearchId: data.id, name, shared: args.shared === true },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

export async function updateSavedSearch(admin: any, ctx: WorkspaceContext, args: {
  id: string; favourite?: boolean; shared?: boolean; correlationId: string;
}): Promise<EngineResult<{ favourite: boolean; shared: boolean }>> {
  const { data: s } = await admin.from("practice_saved_search")
    .select("id, owner_id, favourite, shared").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!s) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // A SHARED SEARCH IS STILL SOMEBODY'S. Being able to see it is not being able to change it, or one
  // person's list would be edited by everybody who could read it.
  if (s.owner_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's saved search" };

  const favourite = args.favourite ?? s.favourite;
  const shared = args.shared ?? s.shared;
  const { error } = await admin.from("practice_saved_search")
    .update({ favourite, shared, updated_at: nowIso() }).eq("id", s.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { favourite, shared } };
}

export async function deleteSavedSearch(admin: any, ctx: WorkspaceContext, args: {
  id: string; correlationId: string;
}): Promise<EngineResult<{ deleted: true }>> {
  const { data: s } = await admin.from("practice_saved_search")
    .select("id, owner_id, name").eq("id", args.id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!s) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (s.owner_id !== ctx.userId)
    return { ok: false, status: 403, code: "NOT_YOURS", message: "that is somebody else's saved search" };

  await admin.from("practice_saved_search").delete().eq("id", s.id);
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.search_deleted",
    payload: { savedSearchId: s.id, name: s.name }, correlationId: args.correlationId,
  });
  return { ok: true, data: { deleted: true } };
}

/**
 * Run a saved search.
 *
 * THE CALLER'S GATE, NOT THE OWNER'S. This is the line that makes sharing safe: a colleague opening
 * somebody else's saved search runs it against their own capabilities and gets their own answer.
 */
export async function runSavedSearch(admin: any, ctx: WorkspaceContext, id: string) {
  const { data: s } = await admin.from("practice_saved_search")
    .select("id, owner_id, name, query, filters, shared").eq("id", id).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!s) return null;
  if (s.owner_id !== ctx.userId && !s.shared) return null;

  const result = await runSearch(admin, ctx, s.query, normaliseFilters(s.filters));
  return { savedSearch: { id: s.id, name: s.name, query: s.query, mine: s.owner_id === ctx.userId }, ...result };
}

// ── HISTORY ──────────────────────────────────────────────────────────────────────────────────────────

/** The caller's own recent searches. There is no parameter for whose -- see the header. */
export async function recentSearches(admin: any, ctx: WorkspaceContext, limit = 10) {
  const { data } = await admin.from("practice_search_history")
    .select("id, query, filters, hit_count, ran_at")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .order("ran_at", { ascending: false }).limit(200);

  // DE-DUPLICATED BY QUERY, newest kept. A history that repeated "John" eleven times is a history that
  // shows one thing.
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of ((data ?? []) as any[])) {
    const key = row.query.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...row,
      filters: normaliseFilters(row.filters),
      // Said plainly: this is what they saw THEN. It is not re-run and is not a current count.
      foundThen: row.hit_count,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function clearHistory(admin: any, ctx: WorkspaceContext): Promise<EngineResult<{ cleared: number }>> {
  const { data } = await admin.from("practice_search_history").delete()
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId).select("id");
  return { ok: true, data: { cleared: ((data ?? []) as any[]).length } };
}

// ── QUICK SEARCHES ───────────────────────────────────────────────────────────────────────────────────

/**
 * The comp's quick-search chips.
 *
 * THEY ARE LINKS TO THE SURFACES THAT ALREADY ANSWER THEM, not text queries. "Follow-ups overdue" is not
 * a phrase to match against a record -- it is a question the follow-up board answers exactly, with the
 * overdue derivation and the ordering that board already has. Turning it into a text search would give a
 * worse answer to a question this product can already answer well.
 *
 * Capability-filtered, so a chip never leads somewhere the reader will be redirected away from.
 */
export function quickSearches(ctx: WorkspaceContext) {
  const can = (c: string) => hasCapability(ctx, c);
  return [
    { key: "tasks_today", label: "My tasks due today", href: "/practice/tasks", show: can("task.view") },
    { key: "followups_overdue", label: "Follow-ups overdue", href: "/practice/follow-ups", show: can("followup.view") },
    { key: "documents_draft", label: "Documents awaiting signature", href: "/practice/documents?status=DRAFT", show: can("document.view") },
    { key: "inbox_unreviewed", label: "Received and not reviewed", href: "/practice/inbox", show: can("inbox.review") },
    { key: "today", label: "Today's clinic", href: "/practice/calendar", show: can("practice.calendar.view") },
    { key: "activity", label: "My clinical activity", href: "/practice/activity", show: can("procedure.record") },
  ].filter(q => q.show);
}
