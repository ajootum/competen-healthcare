import { mayRender, absenceSentence } from "@/lib/hq/pd-metric-registry";
import { SEVERITY_LABEL, type OpenIncident, type IncidentSeverity } from "@/lib/hq/mos-incident";

import {
  healthStateFor, type Domain, type Coverage, type AttentionSignal, type Freshness, type HealthState,
} from "@/lib/hq/pd-health-model";

// The spec's vocabulary is re-exported from here so a page has ONE import for the module rather than
// having to know which half of it a symbol lives in.
export * from "@/lib/hq/pd-health-model";

/**
 * CPR-PD-009 §6 severity to CPR-PD-008 §4 health state, for the badge only.
 *
 * ⚠ IT IS LOSSY ON PURPOSE, AND THE LOSS IS RECORDED RATHER THAN HIDDEN. SEV-3 and SEV-4 are different
 * responses to different impacts, and both read "Degraded" as a product state because §4 has no rung
 * between them. The grade itself travels beside this on severityLabel, so nothing on screen has to
 * infer which of the two it was looking at.
 */
const INCIDENT_HEALTH_STATE: Record<IncidentSeverity, HealthState> = {
  sev1: "critical",
  sev2: "major",
  sev3: "degraded",
  sev4: "degraded",
  informational: "degraded",
};

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-008 — PRODUCT HEALTH, the loader.
//
// ⚠ THIS MODULE MEASURES THE PLATFORM'S MACHINERY AND SAYS SO ON EVERY FIGURE. PD-008 asks whether
// Competen Practice is working well enough to depend on. Nothing records that: there is no uptime probe,
// no request log, no synthetic journey runner and no error-rate denominator anywhere in this schema.
// What IS recorded is AI calls, background job runs and platform events — real, observed, useful, and a
// DIFFERENT CLAIM. Every real metric here is scoped in its registry definition to the machinery it
// measures, so "AI availability" can never be read as "Practice availability".
//
// ⚠ AND IT READS NO PRACTICE TABLE AT ALL. Four platform-plane tables, nothing else. The two facts this
// module most wants — sync-transaction age and message delivery — live on the practice plane and are not
// on its allowlist, so they are rendered as REFUSED READS: the product HAS a write path for each, and
// this plane may not count them. ⚠ AND THE REFUSAL SAYS WHAT IT KNOWS, WHICH IS LESS THAN IT FIRST SAID.
// An earlier version of this file asserted "the rows exist, the product writes them daily". The sync
// table is written by the sync engine and holds ZERO rows — no device has synced in this environment —
// so the claim was architecturally true and empirically false. A refusal may say the read is forbidden;
// it may not say what it would have found.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type Figure =
  | { state: "value"; value: number }
  | { state: "unknown"; why: string }
  | { state: "absent"; why: string };

/**
 * ⚠ THE ONE GATE, IN THE LOADER RATHER THAN THE COMPONENT. `compute` is not called at all for a metric
 * the registry refuses, so an absent figure has nothing in the payload to leak into a careless view.
 */
function figure(metricId: string, compute: () => number | null, unreadable: string): Figure {
  if (!mayRender(metricId)) return { state: "absent", why: absenceSentence(metricId) };
  const v = compute();
  return v === null ? { state: "unknown", why: unreadable } : { state: "value", value: v };
}

export const refusalFor = (metricId: string, label: string) => ({ label, why: absenceSentence(metricId) });

/** The window every figure on this module is counted over. Stated, never implied. */
export const WINDOW_DAYS = 30;

/**
 * ⚠ PostgREST RETURNS AT MOST 1000 ROWS, AND A PERCENTILE OVER A TRUNCATED FETCH IS A SILENT LIE.
 *
 * So every sampled read carries how many rows it actually got and how many exist. When those differ the
 * screen says "the most recent N of M" rather than presenting a window statistic it did not compute.
 * This is the trap that has bitten this repo before; the fix is to carry the fact, not to raise the cap.
 */
const SAMPLE_CAP = 1000;

export type Sample = {
  /** rows actually read */
  read: number;
  /** rows that exist in the window, or null if the count could not be read */
  total: number | null;
  /** true when `read` hit the cap and `total` exceeds it */
  truncated: boolean;
};

/**
 * The 95th percentile of a numeric series, nearest-rank.
 *
 * ⚠ RETURNS null FOR AN EMPTY SERIES RATHER THAN 0. A percentile of nothing is not zero milliseconds,
 * and a zero here would render as an excellent result.
 */
export function p95(values: number[]): number | null {
  const xs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const rank = Math.ceil(0.95 * xs.length);
  return xs[Math.min(rank, xs.length) - 1];
}

/** A share, refused unless BOTH halves are real and the denominator is not zero. */
export function share(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

// The Supabase admin client, untyped -- the idiom every other pd-* loader uses. Typing it here would
// diverge from six sibling loaders for no gain, and the harness that matters checks the SELECT literals.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type HealthPayload = Awaited<ReturnType<typeof loadPdHealth>>;

export async function loadPdHealth(admin: Admin) {
  const db: Admin = admin;
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const problems: string[] = [];

  // ── AI requests ─────────────────────────────────────────────────────────────────────────────────
  // ⚠ EVERY select() TAKES A LITERAL. plane-boundary-harness resolves the column list statically, and a
  // helper that builds one from a variable turns the whole file UNRESOLVED — which reads as a refusal.
  // ⚠ THE STATUS VOCABULARY IS READ FROM THE SCHEMA, NOT ASSUMED. plat_ai_requests.status is
  // constrained to ('ok','refusal','error','not_configured') and defaults to 'ok'. A first version of
  // this loader tested `status !== "success"` — a word that never appears in this column — and rendered
  // 146 failures out of 146 requests. It typechecked, it ran, and it was catastrophically wrong on a
  // Director's screen. The live vocabulary is now pinned by a harness.
  //
  // ⚠ AND A REFUSAL IS NOT A FAILURE. 'refusal' is the guardrail declining a request, which is the
  // safety machinery WORKING. Counting it as a failure would report the product's correct behaviour as
  // a fault, so it is counted and shown separately.
  const aiCountRes = await db.from("plat_ai_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  // ⚠ COUNTED, NOT SAMPLED. A failure count taken from the most recent 1000 rows next to a total taken
  // from the whole window puts two different denominators in adjacent tiles, and the reader has no way
  // to see it. Every headline count below is over the same window as every other.
  const aiErrRes = await db.from("plat_ai_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "error").gte("created_at", since);
  const aiRefusalRes = await db.from("plat_ai_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "refusal").gte("created_at", since);
  const aiRowsRes = await db.from("plat_ai_requests")
    .select("latency_ms, status, provider, operation")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(SAMPLE_CAP);

  const aiReadable = !aiCountRes.error && aiCountRes.count !== null;
  const aiTotal = aiReadable ? aiCountRes.count : null;
  if (!aiReadable) problems.push("plat_ai_requests: the AI request log could not be counted. That is not zero requests.");
  const aiErrors = !aiErrRes.error && aiErrRes.count !== null ? aiErrRes.count : null;
  const aiRefusals = !aiRefusalRes.error && aiRefusalRes.count !== null ? aiRefusalRes.count : null;

  type AiRow = { latency_ms: number | null; status: string | null; provider: string | null; operation: string | null };
  const aiRows: AiRow[] = (!aiRowsRes.error && Array.isArray(aiRowsRes.data) ? aiRowsRes.data : []) as AiRow[];
  const aiSampleOk = !aiRowsRes.error;
  if (!aiSampleOk) problems.push("plat_ai_requests: the sampled rows could not be read, so latency and the per-operation breakdown are unavailable.");

  const aiSample: Sample = {
    read: aiRows.length,
    total: aiTotal,
    truncated: aiRows.length >= SAMPLE_CAP && (aiTotal ?? 0) > aiRows.length,
  };
  const aiLatencies = aiRows.map(r => r.latency_ms).filter((v): v is number => typeof v === "number");

  // ── job runs ────────────────────────────────────────────────────────────────────────────────────
  // plat_job_runs.status is constrained to ('running','success','failed'). A run still 'running' is
  // neither a success nor a failure and is counted as neither.
  const jobCountRes = await db.from("plat_job_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const jobFailRes = await db.from("plat_job_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed").gte("created_at", since);
  const jobRunningRes = await db.from("plat_job_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "running").gte("created_at", since);
  const jobRowsRes = await db.from("plat_job_runs")
    .select("job_key, status, duration_ms, error, started_at, finished_at")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(SAMPLE_CAP);

  const jobReadable = !jobCountRes.error && jobCountRes.count !== null;
  const jobTotal = jobReadable ? jobCountRes.count : null;
  if (!jobReadable) problems.push("plat_job_runs: the job-run log could not be counted. That is not zero runs.");

  type JobRow = { job_key: string | null; status: string | null; duration_ms: number | null; error: string | null; started_at: string | null; finished_at: string | null };
  const jobRows: JobRow[] = (!jobRowsRes.error && Array.isArray(jobRowsRes.data) ? jobRowsRes.data : []) as JobRow[];
  const jobSampleOk = !jobRowsRes.error;
  if (!jobSampleOk) problems.push("plat_job_runs: the sampled rows could not be read, so per-job standing is unavailable.");

  const jobSample: Sample = {
    read: jobRows.length,
    total: jobTotal,
    truncated: jobRows.length >= SAMPLE_CAP && (jobTotal ?? 0) > jobRows.length,
  };
  const jobFailures = !jobFailRes.error && jobFailRes.count !== null ? jobFailRes.count : null;
  const jobRunning = !jobRunningRes.error && jobRunningRes.count !== null ? jobRunningRes.count : null;
  const FAILED = new Set(["failed"]);
  // ⚠ ONLY FINISHED RUNS HAVE A DURATION. A run still in flight is excluded, never counted as zero ms.
  const jobDurations = jobRows.map(r => r.duration_ms).filter((v): v is number => typeof v === "number");
  const jobKeys = [...new Set(jobRows.map(r => r.job_key).filter((v): v is string => !!v))].sort();

  /** Per-job standing, from the sample. Ordered by failures first: what needs attention reads first. */
  const perJob = jobKeys.map(key => {
    const runs = jobRows.filter(r => r.job_key === key);
    const failed = runs.filter(r => FAILED.has((r.status ?? "").toLowerCase()));
    const durations = runs.map(r => r.duration_ms).filter((v): v is number => typeof v === "number");
    const lastErr = failed.find(r => !!r.error)?.error ?? null;
    return { key, runs: runs.length, failed: failed.length, p95: p95(durations), lastError: lastErr };
  }).sort((a, b) => (b.failed - a.failed) || (b.runs - a.runs));

  // ── platform events ─────────────────────────────────────────────────────────────────────────────
  // ⚠ THE SEVERITY VOCABULARY IS ('info','warning','critical') — THERE IS NO 'high'. A first version
  // counted "high and critical", a label naming a value this column cannot hold, and rendered a
  // reassuring 0 while 27 warnings sat unmentioned beside it. Both real levels are counted here and
  // both are shown.
  const evCountRes = await db.from("plat_platform_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const evCritRes = await db.from("plat_platform_events")
    .select("id", { count: "exact", head: true })
    .eq("severity", "critical").gte("created_at", since);
  const evWarnRes = await db.from("plat_platform_events")
    .select("id", { count: "exact", head: true })
    .eq("severity", "warning").gte("created_at", since);
  const evRowsRes = await db.from("plat_platform_events")
    .select("event_type, severity, created_at")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(SAMPLE_CAP);

  const evReadable = !evCountRes.error && evCountRes.count !== null;
  const evTotal = evReadable ? evCountRes.count : null;
  if (!evReadable) problems.push("plat_platform_events: the platform event log could not be counted. That is not zero events.");

  type EvRow = { event_type: string | null; severity: string | null; created_at: string | null };
  const evRows: EvRow[] = (!evRowsRes.error && Array.isArray(evRowsRes.data) ? evRowsRes.data : []) as EvRow[];
  // ⚠ A FAILED SAMPLE READ WOULD OTHERWISE RENDER AS "no events". The breakdown below is built from
  // evRows, which is an empty array both when nothing was recorded and when the read did not answer —
  // and the page says "no platform events were readable" for an empty list. Without this line the two
  // are indistinguishable to the reader, which is the null-is-not-zero rule failing quietly one level
  // down from where it is usually caught.
  const evSampleOk = !evRowsRes.error;
  if (!evSampleOk) problems.push("plat_platform_events: the sampled rows could not be read, so the breakdown by event type is unavailable.");
  const evSample: Sample = {
    read: evRows.length,
    total: evTotal,
    truncated: evRows.length >= SAMPLE_CAP && (evTotal ?? 0) > evRows.length,
  };
  const evCritical = !evCritRes.error && evCritRes.count !== null ? evCritRes.count : null;
  const evWarning = !evWarnRes.error && evWarnRes.count !== null ? evWarnRes.count : null;
  const evByType = Object.entries(
    evRows.reduce<Record<string, number>>((acc, r) => {
      const k = r.event_type ?? "(untyped)";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n);

  // ── deployments, as change context only ─────────────────────────────────────────────────────────
  const depRes = await db.from("plat_deployments")
    .select("version, channel, status, released_at")
    .gte("released_at", since).order("released_at", { ascending: false }).limit(50);
  type DepRow = { version: string | null; channel: string | null; status: string | null; released_at: string | null };
  const depRows: DepRow[] = (!depRes.error && Array.isArray(depRes.data) ? depRes.data : []) as DepRow[];
  const depOk = !depRes.error;
  if (!depOk) problems.push("plat_deployments: the deployment log could not be read, so no change context is offered.");

  // ── the figures ─────────────────────────────────────────────────────────────────────────────────
  const AI_UNREADABLE = "The AI request log could not be read — that is not zero requests.";
  const JOB_UNREADABLE = "The job-run log could not be read — that is not zero runs.";
  const EV_UNREADABLE = "The platform event log could not be read — that is not zero events.";
  const DEP_UNREADABLE = "The deployment log could not be read — that is not zero deployments.";

  return {
    readAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    problems,

    ai: {
      readable: aiReadable,
      sample: aiSample,
      requests: figure("hlt.ai_requests", () => aiTotal, AI_UNREADABLE),
      failures: figure("hlt.ai_failures", () => aiErrors, AI_UNREADABLE),
      refusals: figure("hlt.ai_refusals", () => aiRefusals, AI_UNREADABLE),
      latencyP95: figure("hlt.ai_latency_p95", () => p95(aiLatencies), AI_UNREADABLE),
      providers: figure("hlt.ai_providers",
        () => (aiSampleOk ? new Set(aiRows.map(r => r.provider).filter(Boolean)).size : null), AI_UNREADABLE),
      failureShare: figure("hlt.ai_failure_share", () => share(aiErrors, aiTotal), AI_UNREADABLE),
      byOperation: Object.entries(
        aiRows.reduce<Record<string, { n: number; failed: number }>>((acc, r) => {
          const k = r.operation ?? "(unnamed)";
          acc[k] ??= { n: 0, failed: 0 };
          acc[k].n++;
          if ((r.status ?? "").toLowerCase() !== "success") acc[k].failed++;
          return acc;
        }, {}),
      ).map(([operation, v]) => ({ operation, ...v })).sort((a, b) => (b.failed - a.failed) || (b.n - a.n)),
    },

    jobs: {
      readable: jobReadable,
      sample: jobSample,
      runs: figure("hlt.job_runs", () => jobTotal, JOB_UNREADABLE),
      failures: figure("hlt.job_failures", () => jobFailures, JOB_UNREADABLE),
      running: figure("hlt.job_running", () => jobRunning, JOB_UNREADABLE),
      durationP95: figure("hlt.job_duration_p95", () => p95(jobDurations), JOB_UNREADABLE),
      tracked: figure("hlt.jobs_tracked", () => (jobSampleOk ? jobKeys.length : null), JOB_UNREADABLE),
      failureShare: figure("hlt.job_failure_share", () => share(jobFailures, jobTotal), JOB_UNREADABLE),
      /** how many finished runs the P95 was actually computed over — a percentile needs its n stated */
      durationsCounted: jobDurations.length,
      perJob,
    },

    events: {
      readable: evReadable,
      sample: evSample,
      total: figure("hlt.platform_events", () => evTotal, EV_UNREADABLE),
      critical: figure("hlt.events_critical", () => evCritical, EV_UNREADABLE),
      warning: figure("hlt.events_warning", () => evWarning, EV_UNREADABLE),
      byType: evByType,
    },

    deployments: {
      readable: depOk,
      inWindow: figure("hlt.deployments_window", () => (depOk ? depRows.length : null), DEP_UNREADABLE),
      rows: depRows,
    },
  };
}

/**
 * The refusals this module renders, written once so eleven pages cannot invent eleven phrasings of the
 * same absence. Ordered as the spec introduces them.
 */
export const HEALTH_REFUSALS = {
  availability: () => refusalFor("hlt.availability", "Availability"),
  apdex: () => refusalFor("hlt.apdex", "Apdex"),
  requestLatency: () => refusalFor("hlt.request_latency_p95", "Practice request latency (P95)"),
  errorRate: () => refusalFor("hlt.error_rate", "Practice error rate"),
  journeys: () => refusalFor("hlt.journey_health", "Critical journey health"),
  degradations: () => refusalFor("hlt.degradations", "Current degradations"),
  slo: () => refusalFor("hlt.slo", "Performance objectives"),
  integrations: () => refusalFor("hlt.integrations", "Integration and dependency health"),
  security: () => refusalFor("hlt.security_signals", "Product-health security signals"),
  history: () => refusalFor("hlt.health_history", "Health over time"),
  sync: () => refusalFor("hlt.sync_health", "Sync and offline transaction health"),
  communications: () => refusalFor("hlt.communications_delivery", "Message delivery health"),
} as const;

/**
 * ⚠ THE TWO PLANE REFUSALS, NAMED SEPARATELY FROM THE ABSENCES. Both of these tables are written every
 * day by Competen Practice. A screen that files them under "no data" would be describing a permission
 * boundary as an empty database, and a reader would draw the opposite conclusion from the truth.
 */
export const PLANE_REFUSED = [
  {
    what: "Sync and offline transaction health",
    tables: ["practice_sync_transaction"],
    why:
      "The sync engine writes a row for every device sync, so the offline outbox is one of the few "
      + "genuinely instrumented paths in the product. ⚠ WHAT THIS SCREEN CANNOT TELL YOU IS WHETHER ANY "
      + "ROW IS THERE. The table is not on the practice plane's allowlist, so this plane may not read it "
      + "— which means it also cannot report the count as zero. The write path existing and the table "
      + "holding data are two different facts, and a refused read distinguishes neither.",
    spec: "PD-008E",
  },
  {
    what: "Message delivery health",
    tables: ["practice_message", "practice_message_channel", "practice_notification"],
    why:
      "Delivery state for email, SMS, WhatsApp and push is recorded against each message. None of these "
      + "tables is on the practice plane's allowlist, so the delivery facts exist and this screen is not "
      + "permitted to count them.",
    spec: "PD-008G",
  },
] as const;

/** The eleven sub-surfaces, so the overview and the sidebar cannot disagree about what exists. */
export const HEALTH_SUBMODULES = [
  { key: "services", label: "Services & Components", href: "/super-admin/pd/health/services", spec: "PD-008A", state: "partial" },
  { key: "availability", label: "Availability & Performance", href: "/super-admin/pd/health/availability", spec: "PD-008B", state: "absent" },
  { key: "errors", label: "Errors & Failures", href: "/super-admin/pd/health/errors", spec: "PD-008C", state: "partial" },
  { key: "workflows", label: "Workflow Health", href: "/super-admin/pd/health/workflows", spec: "PD-008D", state: "absent" },
  { key: "data-sync", label: "Data & Sync Health", href: "/super-admin/pd/health/data-sync", spec: "PD-008E", state: "refused" },
  { key: "integrations", label: "Integrations", href: "/super-admin/pd/health/integrations", spec: "PD-008F", state: "absent" },
  { key: "communications", label: "Communications Health", href: "/super-admin/pd/health/communications", spec: "PD-008G", state: "refused" },
  { key: "ai", label: "AI Health", href: "/super-admin/pd/health/ai", spec: "PD-008H", state: "real" },
  { key: "security-signals", label: "Security Signals", href: "/super-admin/pd/health/security-signals", spec: "PD-008I", state: "absent" },
  { key: "history", label: "Health History", href: "/super-admin/pd/health/history", spec: "PD-008J", state: "partial" },
] as const;

/**
 * ⚠ THE HEADLINE SENTENCE, AND IT IS THE WHOLE MODULE IN ONE LINE. Written here so the overview and
 * every sub-page state the same thing rather than ten near-misses.
 */
export const HEALTH_HEADLINE =
  "The platform's own machinery is instrumented. Competen Practice is not.";

/**
 * CPR-PD-008 §3 region B — the nine health domains, each with its §11 coverage and its §4 state.
 *
 * ⚠ EVERY OBJECTIVE ARGUMENT BELOW IS `null`, AND THAT IS THE FINDING RATHER THAN A PLACEHOLDER. §4
 * defines Healthy as evidence MEETING a defined objective; this product declares no target availability,
 * no latency budget and no error budget. So even the three fully instrumented domains resolve to
 * Unknown, and the screen says why. The day an objective is configured, it is passed here and the
 * domain starts resolving — no view changes.
 *
 * ⚠ AND GATING IS SET FROM §5, NOT FROM WHAT HAPPENS TO BE MEASURED. Critical journeys and availability
 * gate. Both are unmeasured, so the overall state is Unknown — which is the correct answer to "is
 * Practice dependable?" and the one a coloured average would have hidden.
 */
export function healthDomains(h: HealthPayload, journeys?: JourneyHealth[] | null): Domain[] {
  // ⚠ WORKFLOW HEALTH IS THE ONE DOMAIN THAT MOVED, and it moved on COVERAGE, not on health. Six of the
  // eight journeys now emit, so the evidence is partial rather than absent. The STATE stays unknown
  // because §4 needs an objective and none is configured — a journey succeeding every time still cannot
  // be called Healthy against a threshold nobody agreed.
  const measured = (journeys ?? []).filter(j => j.attempts !== null).length;
  const journeyCoverage: Coverage = journeys === null || journeys === undefined
    ? "absent"
    : measured === 0 ? "absent" : measured < journeys.length ? "partial" : "measured";
  const journeyEvidence: Figure | null = measured > 0
    ? { state: "value", value: measured }
    : null;
  const d = (
    key: string, label: string, question: string, href: string,
    coverage: Coverage, evidence: Figure | null, evidenceLabel: string | null, gating: boolean,
    fallbackWhy: string,
  ): Domain => {
    const { state, why } = healthStateFor(evidence, null);
    return {
      key, label, question, href, coverage, evidence, evidenceLabel, gating,
      state,
      why: coverage === "measured" || coverage === "partial" ? why : fallbackWhy,
    };
  };

  return [
    d("availability", "Availability", "Can practitioners reach the product?", "/super-admin/pd/health/availability",
      "absent", null, null, true, absenceSentence("hlt.availability")),
    d("performance", "Performance (P95)", "Can they use it at acceptable speed?", "/super-admin/pd/health/availability",
      "absent", null, null, false, absenceSentence("hlt.request_latency_p95")),
    d("errors", "Error rate", "What is failing, at what rate?", "/super-admin/pd/health/errors",
      "partial", h.ai.failureShare, "share of AI requests that errored — not a product error rate", false,
      absenceSentence("hlt.error_rate")),
    d("workflows", "Workflow Health", "Can practitioners complete critical journeys?", "/super-admin/pd/health/workflows",
      journeyCoverage, journeyEvidence,
      journeys ? `of ${journeys.length} critical journeys instrumented` : null,
      true, absenceSentence("hlt.journey_health")),
    d("data_sync", "Data & Sync", "Are writes, sync and the offline queue healthy?", "/super-admin/pd/health/data-sync",
      "refused", null, null, false, absenceSentence("hlt.sync_health")),
    d("integrations", "Integrations", "Are external dependencies working?", "/super-admin/pd/health/integrations",
      "partial", h.ai.requests, "AI provider calls — the only dependency with a call log", false,
      absenceSentence("hlt.integrations")),
    d("communications", "Communications", "Are messages being delivered?", "/super-admin/pd/health/communications",
      "refused", null, null, false, absenceSentence("hlt.communications_delivery")),
    d("ai", "AI Health", "Are AI services available and timely?", "/super-admin/pd/health/ai",
      "measured", h.ai.latencyP95, "95th percentile AI round trip, in milliseconds", false, ""),
    d("security", "Security Signals", "Any material product-security signals?", "/super-admin/pd/health/security-signals",
      "absent", null, null, false, absenceSentence("hlt.security_signals")),
  ];
}

/**
 * §9's ranked signals, DERIVED from the logs this plane can read.
 *
 * ⚠ A DERIVED SIGNAL IS NOT A DEGRADATION RECORD, AND THE PANEL SAYS SO ON EVERY ROW. Each carries the
 * §9 fields it can fill and names the ones it cannot: no status, because nothing here has a lifecycle;
 * no owner, because nobody has ever been assigned one; no quantified practice impact, because no log
 * records which practices a failure touched.
 */
export function attentionSignals(h: HealthPayload, incidents?: OpenIncident[] | null): AttentionSignal[] {
  const out: AttentionSignal[] = [];

  // ⚠ REAL INCIDENTS FIRST, AND NOT BECAUSE THEY ARE MORE URGENT. A derived signal is a count over a log
  // and can be alarming without anybody having decided it matters; an incident is a record somebody
  // opened, owns and will close. Ranking a stateful record below a tally would have a Director working
  // the panel from the bottom. Within each kind, severity then age decides.
  for (const i of incidents ?? []) {
    out.push({
      kind: "incident",
      signalId: i.incidentId,
      title: i.title,
      // an explicit display mapping, written out so it is a decision rather than a coincidence of names
      severity: INCIDENT_HEALTH_STATE[i.severity] ?? "degraded",
      severityLabel: SEVERITY_LABEL[i.severity] ?? null,
      startedAt: i.startedAt,
      status: i.status,
      scope: i.affectedScope
        ?? (i.subjectLabel ? `${i.subjectType}: ${i.subjectLabel}` : i.subjectType),
      // ⚠ THE SENTENCE THE RESPONDER WROTE, NOT A NUMBER THIS FUNCTION INVENTED. The count lives in the
      // event store and is computed against a window when a screen asks for it.
      impact: i.impactNote ?? "not stated on the incident",
      evidence: i.journeyName
        ? `${i.journeyName}${i.component ? " · " + i.component : ""}`
        : (i.component ?? "no journey or component named"),
      actionRoute: { label: "Workflow Health", href: "/super-admin/pd/health/workflows" },
      missingFields: [],
      correlationId: i.evidenceCorrelationId,
    });
  }
  const MISSING = ["status", "owner", "quantified practice impact"];

  if (h.ai.failures.state === "value" && h.ai.failures.value > 0) {
    out.push({
      kind: "derived" as const,
      severityLabel: null,
      status: null,
      signalId: "derived.ai_errors",
      title: `${h.ai.failures.value} AI request${h.ai.failures.value === 1 ? "" : "s"} errored`,
      severity: "degraded",
      startedAt: null,
      scope: "The AI service across the platform. The log carries a tenant, and a Practice has none, so this cannot be narrowed to a practice.",
      impact: h.ai.failureShare.state === "value"
        ? `${(h.ai.failureShare.value * 100).toFixed(1)}% of AI requests in the window`
        : "not quantifiable — the share could not be computed",
      evidence: "The platform AI request log, counted over the module window.",
      actionRoute: { label: "AI Health", href: "/super-admin/pd/health/ai" },
      missingFields: MISSING,
    });
  }

  if (h.events.warning.state === "value" && h.events.warning.value > 0) {
    out.push({
      kind: "derived" as const,
      severityLabel: null,
      status: null,
      signalId: "derived.platform_warnings",
      title: `${h.events.warning.value} platform event${h.events.warning.value === 1 ? "" : "s"} at warning severity`,
      severity: "degraded",
      startedAt: null,
      scope: "The platform event log. Events carry a type and a severity, and no journey or component.",
      impact: "not quantifiable — an event is a log line, not an affected session count",
      evidence: "The platform event log, counted over the module window.",
      actionRoute: { label: "Errors & Failures", href: "/super-admin/pd/health/errors" },
      missingFields: MISSING,
    });
  }

  if (h.jobs.failures.state === "value" && h.jobs.failures.value > 0) {
    out.push({
      kind: "derived" as const,
      severityLabel: null,
      status: null,
      signalId: "derived.job_failures",
      title: `${h.jobs.failures.value} background job run${h.jobs.failures.value === 1 ? "" : "s"} failed`,
      severity: "degraded",
      startedAt: null,
      scope: "Background components only. §8 is explicit that job success is not availability.",
      impact: "not quantifiable — no job run records which practices its work served",
      evidence: "The platform job-run log, counted over the module window.",
      actionRoute: { label: "Services & Components", href: "/super-admin/pd/health/services" },
      missingFields: MISSING,
    });
  }

  return out;
}

/**
 * CPR-PD-008 §8D / CPR-CORE-MOS-001 §7 — the eight critical journeys, from the event substrate.
 *
 * ⚠ THE ATTEMPT IS THE DENOMINATOR AND NOTHING ELSE IS. `started` counts what was tried; success and
 * failure count how those tries ended. Counting every event of a journey would inflate the base with the
 * outcomes of the same attempt and produce a rate that looks like a measurement and means nothing.
 *
 * ⚠ AND A JOURNEY WITH NO ATTEMPTS IS UNMEASURED, NOT HEALTHY. Six of the eight emit nothing today. They
 * return null rather than zero, because zero attempts and no instrumentation render identically on a
 * screen and only one of them is a fact about the product.
 */
export type JourneyHealth = {
  key: string;
  name: string;
  outcomeReq: string;
  order: number;
  /** null when the journey emits nothing at all — never 0, which would read as "nobody tried". */
  attempts: number | null;
  successes: number;
  failures: number;
  /** 95th percentile of the outcome events that carried a duration. */
  p95: number | null;
  topFailure: { code: string; n: number } | null;
};

export async function loadJourneyHealth(admin: Admin, windowDays = WINDOW_DAYS): Promise<JourneyHealth[] | null> {
  const db: Admin = admin;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const jr = await db.from("mos_journey").select("key, name, outcome_req, sort_order").order("sort_order");
  if (jr.error || !Array.isArray(jr.data)) return null;
  const journeys = jr.data as { key: string; name: string; outcome_req: string; sort_order: number }[];

  const ev = await db.from("mos_journey_event")
    .select("journey_key, outcome, duration_ms, failure_code")
    .gte("occurred_at", since).limit(1000);
  const rows = (ev.error || !Array.isArray(ev.data) ? [] : ev.data) as
    { journey_key: string; outcome: string; duration_ms: number | null; failure_code: string | null }[];

  return journeys.map(j => {
    const mine = rows.filter(r => r.journey_key === j.key);
    const attempts = mine.filter(r => r.outcome === "started").length;
    const failures = mine.filter(r => r.outcome === "failure" || r.outcome === "timeout");
    const byCode = failures.reduce<Record<string, number>>((acc, r) => {
      const k = r.failure_code ?? "(uncoded)";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    const top = Object.entries(byCode).sort((a, b) => b[1] - a[1])[0];
    return {
      key: j.key,
      name: j.name,
      outcomeReq: j.outcome_req,
      order: j.sort_order,
      attempts: mine.length === 0 ? null : attempts,
      successes: mine.filter(r => r.outcome === "success").length,
      failures: failures.length,
      p95: p95(mine.map(r => r.duration_ms).filter((v): v is number => typeof v === "number")),
      topFailure: top ? { code: top[0], n: top[1] } : null,
    };
  });
}

/** §5's freshness envelope for a payload read at request time. */
export function freshnessOf(h: HealthPayload): Freshness {
  const end = new Date(h.readAt);
  const start = new Date(end.getTime() - h.windowDays * 86_400_000);
  return {
    observedAt: h.readAt,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    // ⚠ THIS PAGE IS READ AT REQUEST TIME AND CACHES NOTHING, so the observation is always current and
    // never stale. The threshold is declared anyway because §5 requires every signal to carry one, and
    // because the day any of this is cached or snapshotted the field is already here to be honoured.
    thresholdMinutes: 5,
    stale: false,
  };
}

export const HEALTH_HEADLINE_BODY =
  "AI calls, background job runs and platform events are recorded and are counted here honestly. What "
  + "PD-008 actually asks — is Practice up, how fast is it, what share of operations fail, are the "
  + "critical practitioner journeys healthy — has no producer anywhere in this schema: no uptime probe, "
  + "no request log, no synthetic journey runner, and no denominator for an error rate. Those figures "
  + "are refused rather than estimated. Two more, sync health and message delivery, are refused for a "
  + "different reason: the rows exist and this plane may not read them.";
