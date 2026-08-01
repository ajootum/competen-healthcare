/* eslint-disable @typescript-eslint/no-explicit-any */
// QIE-000 — Quality Intelligence Engine, platform architecture.
//
// The spec describes thirteen engines that turn operational events into quality intelligence. Most of
// that capability ALREADY EXISTS on this platform, under other names and owned by other workspaces:
// pa_kpis and pa_kpi_values are the metrics engine, pa_predictions is the predictive engine,
// pa_benchmarks is the benchmarking engine, domain_events is the event spine, HEX is the executive
// service, WCE is the configuration engine, and the audit trail with trace ids is the explainability
// spine. Building qie_* copies of all of it would create a second source of truth for numbers a hospital
// makes decisions on, which is a worse outcome than the fragmentation it would claim to fix.
//
// So QIE is a COMPOSING LAYER. It reads the real stores and presents them as one intelligence service.
// New tables are for genuine gaps only.
//
// THE HONEST PART IS THE POINT. Every module reports which of three states it is actually in --
//   live      the store exists and has data behind it
//   empty     the store exists and nobody has written to it yet
//   gap       there is no store; the capability is described but not built
// -- measured at request time rather than asserted in a constant, because a module that "went live" the
// day someone seeded a table should say so by itself. A hub that claims thirteen engines and shows
// thirteen green tiles over four real tables is the kind of thing this codebase has spent a session
// removing.

export type QieState = "live" | "empty" | "gap";

export type QieModule = {
  id: string;
  name: string;
  purpose: string;
  /** where the capability actually lives today, in the user's words */
  provider: string;
  /** deep link to the surface that already owns this, when there is one */
  href: string | null;
  /** tables read to decide the state; the first that exists decides it */
  tables: string[];
  state: QieState;
  count: number;
  detail: string;
};

/** The thirteen engines, mapped to what actually backs them. */
const CATALOGUE: Omit<QieModule, "state" | "count" | "detail">[] = [
  { id: "QIE-001", name: "Event Collection", purpose: "Capture every quality-relevant event once, standardise and publish it.", provider: "domain_events + orchestration producers", href: "/super-admin/delivery", tables: ["domain_events"] },
  { id: "QIE-002", name: "Metrics & Indicators", purpose: "One calculation engine for every quality metric.", provider: "Performance Analytics, surfaced as the QIE registry", href: "/super-admin/quality-intelligence/indicators", tables: ["pa_kpi_values", "pa_kpis"] },
  { id: "QIE-003", name: "Leading & Lagging Indicators", purpose: "Predictive signals and outcome measures, correlated.", provider: "pa_kpis.indicator_class (migration 181) — a governance decision, not an inference", href: "/super-admin/quality-intelligence/indicators", tables: ["pa_kpis"] },
  { id: "QIE-004", name: "Predictive Analytics", purpose: "Forecast risk early enough to intervene.", provider: "pa_predictions", href: "/unit-manager/performance", tables: ["pa_predictions"] },
  // THE ONLY REAL GAP: there is no causal store at all. 8 incidents are recorded and not one has a
  // root-cause analysis, because there is nowhere to put one.
  //
  // This entry was right, then wrong, then right again, and the round trip is why resolveState probes the
  // way it does. head+count on a missing table returns 204 / no error / null count -- so my inventory
  // printed "null", I read it as absent (correct), a harness check built on the SAME head+count method
  // then told me the table existed, and I "corrected" the catalogue to match. Only a plain select, which
  // returns PGRST205, settles it. A check that shares the blind spot of the thing it checks will confirm
  // the bug rather than find it.
  // Built here (migration 180) rather than composed, because this was the only module with nothing behind
  // it. It will read "empty" until the first investigation is opened, which is the true state of a new
  // capability and better than a surface that implies neglect.
  { id: "QIE-005", name: "Root Cause & Causal", purpose: "Explain why events happen, not just that they did.", provider: "Built for QIE — rca_investigations + rca_factors", href: "/super-admin/quality-intelligence/root-cause", tables: ["rca_investigations"] },
  { id: "QIE-006", name: "Recommendation & Improvement", purpose: "Turn intelligence into prioritised, owned actions.", provider: "CAPA actions + improvement objects", href: "/quality-accreditation", tables: ["capa_actions", "improvement_objects"] },
  { id: "QIE-007", name: "Organisational Learning", purpose: "Close the loop back into competency and policy.", provider: "Competency learning links + knowledge objects", href: "/competency-office", tables: ["competency_learning_links", "knowledge_objects"] },
  { id: "QIE-008", name: "Benchmarking", purpose: "Compare against peers and find unwarranted variation.", provider: "pa_benchmarks", href: "/unit-manager/performance", tables: ["pa_benchmarks"] },
  { id: "QIE-009", name: "Executive Intelligence", purpose: "Board-level scorecards and strategic risk.", provider: "Hospital Executive Workspace", href: "/hospital-executive", tables: ["pa_kpi_values"] },
  { id: "QIE-010", name: "AI Quality Copilot", purpose: "Conversational, explainable access to the intelligence.", provider: "AI Services (plat_ai_requests)", href: "/super-admin/ai", tables: ["plat_ai_requests"] },
  // Thresholds are COLUMNS on pa_kpis that already drive live dashboards, so QIE-011 exposes them for
  // no-code editing rather than building a qie_rules table that would be a second set of thresholds for
  // the same indicators. WCE stays separate: it resolves which modules are on for a unit, not what the
  // amber threshold for CLABSI is. Same word, different domain.
  { id: "QIE-011", name: "Rules & Configuration", purpose: "No-code indicators, thresholds and escalation rules.", provider: "Threshold configuration on pa_kpis (WCE governs workspace composition, separately)", href: "/super-admin/quality-intelligence/indicators", tables: ["pa_kpis"] },
  { id: "QIE-012", name: "Explainability, Audit & Governance", purpose: "Every number traceable to the act that produced it.", provider: "audit_log with request trace ids", href: "/super-admin/governance", tables: ["audit_log"] },
];

const NONE = "00000000-0000-0000-0000-000000000000";

/**
 * Resolve each module's real state against the live database.
 *
 * Tenant scoping is best-effort per table: several of these stores are platform-shared and have no
 * hospital_id at all, so a filter is applied only where the column exists. A table that rejects the
 * filter is counted unscoped rather than reported as absent -- "this store has no tenant column" and
 * "this store is missing" are different facts and collapsing them is how a hub lies about its own reach.
 */
export async function resolveState(
  admin: any, tables: string[], hospitalId: string | null, isSuper: boolean,
): Promise<{ state: QieState; count: number; detail: string }> {
  for (const table of tables) {
    // EXISTENCE IS PROBED WITH A NON-HEAD SELECT, and that is not a stylistic choice.
    // PostgREST answers `head: true` on a table that DOES NOT EXIST with 204, no error and a null count
    // -- identical to a table that exists and is empty. A loader built on head counts alone therefore
    // cannot tell "missing" from "empty", its gap branch is unreachable, and an absent store is reported
    // as merely unused. A plain select on the same table returns PGRST205 and says so. (This cost me the
    // first version of the QIE-005 entry: I read a null count as absence and wrote the catalogue around
    // it. The harness compared the claim to the database and caught it.)
    const exists = await admin.from(table).select("id").limit(1);
    if (exists.error) continue;                          // genuinely absent — try the next candidate

    // It is there; now count it. A tenant filter on a store with no hospital_id errors on the COLUMN,
    // which is a different fact from the table being missing, so it falls back to an unscoped count
    // rather than being treated as absence.
    let n = 0;
    if (!isSuper) {
      const scoped = await admin.from(table).select("*", { count: "exact", head: true }).eq("hospital_id", hospitalId ?? NONE);
      if (!scoped.error) n = scoped.count ?? 0;
      else n = (await admin.from(table).select("*", { count: "exact", head: true })).count ?? 0;
    } else {
      n = (await admin.from(table).select("*", { count: "exact", head: true })).count ?? 0;
    }

    return {
      state: n > 0 ? "live" : "empty",
      count: n,
      detail: n > 0 ? `${n.toLocaleString()} row(s) in ${table}` : `${table} exists but has never been written to`,
    };
  }
  return { state: "gap", count: 0, detail: `no store: ${tables.join(", ")}` };
}

export async function loadQieModules(admin: any, hospitalId: string | null, isSuper: boolean): Promise<QieModule[]> {
  return Promise.all(CATALOGUE.map(async (m): Promise<QieModule> => ({
    ...m, ...(await resolveState(admin, m.tables, hospitalId, isSuper)),
  })));
}

export const qieSummary = (mods: QieModule[]) => ({
  live: mods.filter(m => m.state === "live").length,
  empty: mods.filter(m => m.state === "empty").length,
  gap: mods.filter(m => m.state === "gap").length,
  total: mods.length,
});
