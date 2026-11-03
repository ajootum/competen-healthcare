/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR-ENGAGEMENT-ANALYTICS-01 -- one builder behind the page's first render and the API's every answer, so the
// identity rule is written once: pseudonyms by default, names only for a caller who holds the identifiable right (or
// ownership), the testing filter likewise, and one audit row per identifiable answer.
import { currentTraceId } from "@/lib/trace";
import { BASE_INCLUDE, TESTING_INCLUDE, loadDashboardRows } from "./load";
import { buildActivities, costByActivity, kindBreakdown, learnerDetail, learnerRow, METHOD, sortRows, summaryCards, touches } from "./metrics";
import { pseudonymTable, resolvePseudonym } from "./pseudonym";
import { inRange, parseRange } from "./range";
import type { DashboardResponse, LearnerRow, SortKey } from "./types";

export const IDENTIFIABLE = "hq.scholar.analytics.identifiable.read";
export const PAGE_SIZE = 20;
const SORTS: SortKey[] = ["activities", "activeDays", "sessions", "activeMinutes", "aiRequests", "aiCostUsd", "lastActive"];

export type Caller = { userId: string; fullName: string | null; isOwner: boolean; capabilities: readonly string[] };
export type DashboardParams = { range?: string | null; from?: string | null; to?: string | null; named?: string | null; include?: string | null; q?: string | null; sort?: string | null; page?: string | null; learner?: string | null };
export type DashboardResult = { status: 200; body: DashboardResponse } | { status: 403 | 409; body: { error: string } };

export const canIdentifyWith = (c: Caller): boolean => c.isOwner || c.capabilities.includes(IDENTIFIABLE);

export async function buildDashboard(admin: any, caller: Caller, params: DashboardParams, now = new Date()): Promise<DashboardResult> {
  const canIdentify = canIdentifyWith(caller);
  const named = params.named === "1";
  const wanted = (params.include ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const testing = wanted.filter(s => (TESTING_INCLUDE as readonly string[]).includes(s));
  if ((named || testing.length) && !canIdentify)
    return { status: 403, body: { error: "Named View and the testing filter need the identifiable analytics right." } };
  const include = [...BASE_INCLUDE, ...testing];
  const range = parseRange({ range: params.range, from: params.from, to: params.to }, now);

  const data = await loadDashboardRows(admin, { from: range.from, to: range.to, include, now });
  if (!data.salt) return { status: 409, body: { error: data.limits[0] ?? "Not set up." } };

  const ids = data.learners.map(l => l.userId);
  const table = pseudonymTable(ids, data.salt);
  const activities = buildActivities(data.raw, now);
  const byId = new Map(data.learners.map(l => [l.userId, l]));

  const rowsAll: LearnerRow[] = ids.map(id => {
    const key = table.get(id)!;
    const acc = byId.get(id)!;
    const row = learnerRow({ userId: id, activities, ai: data.ai, settled: data.settled, range }, key, named ? (acc.fullName ?? key) : key);
    if (named) { row.name = acc.fullName ?? "(no name)"; row.status = acc.accountStatus; row.classification = acc.classification; }
    return row;
  });
  const q = (params.q ?? "").trim().toLowerCase();
  const rows = q ? rowsAll.filter(r => r.key.toLowerCase().includes(q) || (named && (r.name ?? "").toLowerCase().includes(q))) : rowsAll;
  const sort = (SORTS.includes(params.sort as SortKey) ? params.sort : "activities") as SortKey;
  const sorted = sortRows(rows, sort);
  const page = Math.max(0, Number(params.page ?? 0) || 0);
  const pageRows = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  let detail: DashboardResponse["detail"] = null;
  if (params.learner) {
    const id = resolvePseudonym(table, params.learner);
    const row = id ? rowsAll.find(r => r.key === table.get(id)) : null;
    if (id && row) detail = learnerDetail({ userId: id, activities, ai: data.ai, settled: data.settled, range, allowance: data.allowances.find(a => a.userId === id) ?? null, row });
  }

  const inRangeActs = activities.filter(a => ids.includes(a.userId) && touches(a, range));
  const limits = [...data.limits];
  if (!data.ai.some(x => inRange(x.at, range))) limits.push("No AI request by these learners in this range.");
  limits.push("Activity counts are one per record: a page refresh writes no record, so it is never counted.");

  if (named) {
    await admin.from("audit_log").insert({
      trace_id: await currentTraceId(), actor_id: caller.userId, actor_name: caller.fullName ?? null,
      action: "scholar_analytics_identifiable_read", entity_type: "scholar_analytics", entity_id: null, entity_name: "Learner engagement, Named View",
      new_value: { range: range.label, from: range.from, to: range.to, learners: rowsAll.length, page, learner: detail ? detail.row.key : null, include },
    }).then((x: unknown) => x, () => {});
  }

  return { status: 200, body: {
    range, named, canIdentify, include, method: METHOD,
    cards: summaryCards({ learners: data.learners, activities, ai: data.ai, settled: data.settled, range, now }),
    costByActivity: costByActivity(data.ai.filter(x => ids.includes(x.userId)), range),
    kinds: kindBreakdown(inRangeActs),
    leaderboard: { rows: pageRows, page, pageSize: PAGE_SIZE, total: sorted.length, sort, q },
    detail, limits,
  } };
}
