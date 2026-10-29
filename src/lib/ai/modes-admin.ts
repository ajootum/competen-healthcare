/* eslint-disable @typescript-eslint/no-explicit-any */
import { AI_PRODUCTS, type AiProduct } from "./fair-use-policy";
import { AI_MODES, MODE_SCOPE, STRICT_DOC, modePath, resolveModeDoc, type ModeDoc } from "./operating-mode";
import { loadAiQuality } from "./outcomes";

// ── AI OPERATING MODES: the HQ side ── owner GO "COMPETEN AI — SUPERVISED PILOT MODE", 29 Oct 2026 ─────────────────
//
// Reads for /super-admin/ai/fair-use ("AI operating modes") and the pure validation the route saves with. The documents
// live in their own CONFIG-002 scope (MODE_SCOPE), so a pilot is drafted, published and rolled back without carrying the
// other AI drafts. Nothing here approves a model: a mode only says who is in which mode.
//
// ⚠ NO REQUEST TEXT. The decision log (audit_log, action ai_gate_decision) never holds any, and these reads only count it.

const DAY = 86_400_000;
const LIMIT = 20_000;
const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

// ── Validation (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const norm = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map(x => x.trim().toLowerCase()).filter(Boolean))] : []);

/**
 * Pure: the document to store, or the reason it cannot be saved. resolveModeDoc DROPS what it cannot read, which is right
 * for a reader and wrong for a save: an admin who typed a cohort or a user id that was silently dropped would believe a
 * pilot covered people it does not. So every drop is an error here, and Supervised Pilot is never the default.
 */
export function validateModeDoc(input: any): { ok: true; doc: ModeDoc } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Send the mode settings." };
  if (!(AI_MODES as readonly string[]).includes(input.defaultMode)) return { ok: false, error: "Choose a default mode." };
  if (input.defaultMode === "supervised_pilot") return { ok: false, error: "Supervised Pilot cannot be the default mode: it applies only to cohorts you name. Choose Strict Production or Clinical Production as the default." };
  const cohorts: any[] = Array.isArray(input.cohorts) ? input.cohorts : [];
  const doc = resolveModeDoc(input);
  if (doc.cohorts.length !== cohorts.length) {
    const kept = new Set(doc.cohorts.map(c => c.code));
    const lost = cohorts.map((c, i) => (c && typeof c.code === "string" && kept.has(c.code) ? null : `cohort ${i + 1}${c?.code ? ` (${String(c.code).slice(0, 40)})` : ""}`)).filter(Boolean);
    return { ok: false, error: `Not saved: ${lost.join(", ")} would be ignored. A cohort needs a unique code (lower case letters, digits, - or _), a mode, and at least one person (by user id), entitlement source or plan.` };
  }
  for (const [i, c] of cohorts.entries()) {
    const r = doc.cohorts[i];
    if (r.code !== c.code) return { ok: false, error: `Not saved: cohort ${i + 1} (${String(c.code).slice(0, 40)}) is not valid.` };
    const checks: [string, number, number][] = [["user ids", norm(c.userIds).length, r.userIds.length], ["entitlement sources", norm(c.entitlementSources).length, r.entitlementSources.length], ["plan codes", norm(c.planCodes).length, r.planCodes.length]];
    const bad = checks.find(([, a, b]) => a !== b);
    if (bad) return { ok: false, error: `Not saved: cohort "${r.code}" has ${bad[1] - bad[2]} ${bad[0]} that are not valid or too many (user ids are UUIDs, one per line; at most 500).` };
    const h = c.hourlyLimit;
    if (h !== null && h !== undefined && h !== "" && r.hourlyLimit === null) return { ok: false, error: `Not saved: cohort "${r.code}" hourly limit must be a whole number from 1 to 500, or empty.` };
  }
  const rawRules = Array.isArray(input.pilotRisk?.rules) ? input.pilotRisk.rules : [];
  if (input.pilotRisk?.rules !== undefined && !Array.isArray(input.pilotRisk.rules)) return { ok: false, error: "Pilot rules must be a list." };
  if (doc.pilotRisk.rules.length !== rawRules.length) return { ok: false, error: `Not saved: ${rawRules.length - doc.pilotRisk.rules.length} pilot rule(s) are not valid (each needs a unique id, a tier, and at least one matching term, competency risk or framework).` };
  if (norm(input.clarifiableRules).length !== doc.clarifiableRules.length) return { ok: false, error: "Not saved: a clarifiable rule id is not valid." };
  return { ok: true, doc };
}

/** Pure: the Strict Production document the "Return to Strict Production now" button saves. */
export const strictDoc = (): ModeDoc => structuredClone(STRICT_DOC);

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type ModeView = { product: AiProduct; published: ModeDoc; draft: ModeDoc | null; hasPublished: boolean; pending: boolean; publishedAt: string | null };

/** Per product: what runs (Strict Production when nothing is published), the draft if saved, and whether it differs. Null when unreadable. */
export async function loadModes(admin: any): Promise<ModeView[] | null> {
  const data = await rows(admin.from("workspace_config_overrides").select("config_path, draft, published, updated_at")
    .eq("scope_type", MODE_SCOPE.scopeType).eq("scope_ref", MODE_SCOPE.scopeRef));
  if (data === null) return null;
  return AI_PRODUCTS.map(product => {
    const r = data.find((x: any) => x.config_path === modePath(product));
    return {
      product, published: resolveModeDoc(r?.published ?? null), draft: r?.draft ? resolveModeDoc(r.draft) : null,
      hasPublished: !!r?.published, publishedAt: r?.published ? r.updated_at : null,
      pending: !!r && JSON.stringify(r.draft ?? null) !== JSON.stringify(r.published ?? null),
    };
  });
}

export type ModeVersion = { id: string; createdAt: string; label: string | null; note: string | null; publishedBy: string | null };

/** Recent published versions of the modes scope, newest first. Null when unreadable. */
export async function loadModeVersions(admin: any, limit = 15): Promise<ModeVersion[] | null> {
  const data = await rows(admin.from("workspace_config_versions").select("id, created_at, label, note, published_by_name, published_by")
    .eq("scope_type", MODE_SCOPE.scopeType).eq("scope_ref", MODE_SCOPE.scopeRef).order("created_at", { ascending: false }).limit(limit));
  if (data === null) return null;
  return data.map((v: any) => ({ id: v.id, createdAt: v.created_at, label: v.label ?? null, note: v.note ?? null, publishedBy: v.published_by_name ?? v.published_by ?? null }));
}

// ── Pilot metrics ─────────────────────────────────────────────────────────────────────────────────────────────

export type GateRow = { created_at?: string; new_value: any };
export type DecisionCell = { product: string; mode: string; cohort: string; served: number; clarify: number; refused: number; total: number };

/**
 * Pure: the decision log counted. By product, mode, cohort and decision; by risk tier; the 15 most-used rules (rule ids
 * are configured codes, or "unknown:..." markers, never text); and the refusal reasons. Anything unreadable is skipped.
 */
export function summariseGateDecisions(log: readonly GateRow[]) {
  const cells = new Map<string, DecisionCell>(), tiers = new Map<string, number>(), rules = new Map<string, number>(), reasons = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  let total = 0;
  for (const r of log) {
    const v = r?.new_value;
    if (!v || typeof v !== "object" || !["served", "clarify", "refused"].includes(v.decision)) continue;
    total++;
    const product = String(v.product ?? "unknown").slice(0, 40), mode = String(v.mode ?? "unknown").slice(0, 40), cohort = v.cohort ? String(v.cohort).slice(0, 40) : "(default)";
    const key = `${product}|${mode}|${cohort}`;
    const c = cells.get(key) ?? { product, mode, cohort, served: 0, clarify: 0, refused: 0, total: 0 };
    c[v.decision as "served" | "clarify" | "refused"]++; c.total++; cells.set(key, c);
    if (v.tier) bump(tiers, String(v.tier).slice(0, 40));
    if (v.rule) bump(rules, String(v.rule).slice(0, 80));
    if (v.decision === "refused" && v.reason) bump(reasons, String(v.reason).slice(0, 100));
  }
  const sorted = (m: Map<string, number>, n = 50) => [...m.entries()].map(([label, count]) => ({ label, n: count })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, n);
  return {
    total,
    cells: [...cells.values()].sort((a, b) => b.total - a.total || `${a.product}${a.mode}${a.cohort}`.localeCompare(`${b.product}${b.mode}${b.cohort}`)),
    byTier: sorted(tiers), topRules: sorted(rules, 15), refusalReasons: sorted(reasons, 15),
  };
}

export type CohortRef = { product: string; code: string; label: string; userIds: readonly string[] };
export type CohortCost = { product: string; code: string; label: string; members: number; requests: number; costUsd: number; tokens: number };

/** Pure: AI cost, tokens and request count for each cohort's NAMED members (a cohort by plan or source has none to count). */
export function summariseCohortCost(requests: readonly { actor_id?: string | null; cost_usd?: number | string | null; total_tokens?: number | string | null }[], cohorts: readonly CohortRef[]): CohortCost[] {
  return cohorts.map(c => {
    const ids = new Set(c.userIds.map(x => x.toLowerCase()));
    let n = 0, cost = 0, tokens = 0;
    for (const r of requests) {
      if (!r.actor_id || !ids.has(String(r.actor_id).toLowerCase())) continue;
      n++; cost += Number(r.cost_usd ?? 0) || 0; tokens += Number(r.total_tokens ?? 0) || 0;
    }
    return { product: c.product, code: c.code, label: c.label, members: ids.size, requests: n, costUsd: cost, tokens };
  });
}

export type PilotMetrics = ReturnType<typeof summariseGateDecisions> & {
  days: number; cohortCost: CohortCost[] | null;
  /** The existing quality view, reused: null when it cannot be read. Feedback per output kind and the reasons given. */
  feedback: { kinds: { kind: string; n: number; positive: number }[]; reasons: { label: string; n: number }[] } | null;
  truncated: boolean;
};

/** The decision log and the named cohorts' cost over the window. Bounded (20000 rows each); null when the log cannot be read. */
export async function loadPilotMetrics(admin: any, days = 30, modes: ModeView[] | null = null): Promise<PilotMetrics | null> {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const log = await rows(admin.from("audit_log").select("created_at, new_value").eq("action", "ai_gate_decision").gte("created_at", since).order("created_at", { ascending: false }).limit(LIMIT));
  if (log === null) return null;
  const views = modes ?? (await loadModes(admin));
  const cohorts: CohortRef[] = (views ?? []).flatMap(v => v.published.cohorts.filter(c => c.userIds.length).map(c => ({ product: v.product, code: c.code, label: c.label, userIds: c.userIds })));
  let cohortCost: CohortCost[] | null = null;
  if (cohorts.length) {
    const ids = [...new Set(cohorts.flatMap(c => c.userIds))].slice(0, 1000);
    const req = await rows(admin.from("plat_ai_requests").select("actor_id, cost_usd, total_tokens").in("actor_id", ids).gte("created_at", since).limit(LIMIT));
    cohortCost = req === null ? null : summariseCohortCost(req, cohorts);
  } else cohortCost = [];
  let feedback: PilotMetrics["feedback"] = null;
  try {
    const q = await loadAiQuality(admin, days);
    if (q.feedbackReady) feedback = { kinds: q.perKind.map(k => ({ kind: k.kind, n: k.feedback.n, positive: k.feedback.positive })), reasons: q.feedbackReasons };
  } catch { /* the rest still shows */ }
  return { ...summariseGateDecisions(log), days, cohortCost, feedback, truncated: log.length >= LIMIT };
}
