/* eslint-disable @typescript-eslint/no-explicit-any */

// ── SQIE MONITORING ── SQIE-COMPLETE-01 (owner GO 31 Oct 2026) ───────────────────────────────────────────────────────────
//
// The Scholar Question Intelligence Engine, measured per format over the last N days, from records that already exist:
// plat_ai_requests (cost, latency), plat_ai_outcomes (600: accepted and rejected counts, reason codes, verification
// attempts) and the codes-only audit rows the engine writes (library reuse, legacy paper rechecks). No new store.
//
// ⚠ AGGREGATES ONLY. No user id, no question, no note, no passage is read: the selects below name no such column.
// ⚠ UNMEASURED IS NOT ZERO. Every figure that has no data is null and rendered "No data yet"; a rate over an empty
// denominator is null. A count is shown as a count only where its source was readable.

export const SQIE_DAYS = 30;

export const FORMAT_LABEL: Record<string, string> = {
  mcq: "Multiple choice", case: "Case question", mrq: "Multiple response", short: "Short answer", flashcard: "Flashcard", match: "Matching",
  sequence: "Sequencing", structured: "Structured", case_blueprint: "Case blueprint", case_reasoning: "Case reasoning", case_steps: "Case steps",
  osce_station: "OSCE station", osce_feedback: "OSCE feedback", evaluate: "Answer evaluation", exam_answer: "Exam answer",
};

/** Pure. The SQIE format an operation belongs to, or null when it is not a Scholar question-engine operation. */
export function formatOf(operation: string | null | undefined): string | null {
  const op = (operation ?? "").replace(/_verify$/, "");
  if (!op.startsWith("individual_scholar_")) return null;
  const rest = op.slice("individual_scholar_".length);
  const f = rest.startsWith("revision_") ? rest.slice("revision_".length) : rest;
  return f in FORMAT_LABEL ? f : null;
}

/** Pure. Nearest-rank percentile of numbers; null when there are none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export type SqieRequest = { operation: string | null; cost_usd: number | string | null; latency_ms: number | null; action_id: string | null };
export type SqieOutcome = { action_id: string; operation: string | null; activity: string; outcome: string; accepted_count: number; rejected_count: number; rejection_reasons: string[] | null; verify_attempts: number };
export type SqieAudit = { action: string; new_value: Record<string, unknown> | null; created_at: string };

export type FormatRow = {
  format: string; label: string; actions: number;
  accepted: number | null; rejected: number | null; rejectionRate: number | null; topReasons: { reason: string; n: number }[];
  verified: number | null; verificationFailures: number | null; verificationFailureRate: number | null;
  calls: number; p50: number | null; p90: number | null; cost: number | null; costPerAccepted: number | null;
};
export type SqieSummary = {
  days: number; outcomesMeasured: boolean; requestsReadable: boolean; truncated: boolean;
  formats: FormatRow[];
  library: { sessions: number; offered: number; picked: number; copied: number; reused: number } | null;
  legacy: { checked: number | null; redirected: number } | null;
};

const money = (n: number) => +n.toFixed(4);
const VERIFY_FAIL = ["failed_verification", "verification_unavailable"];

/** Pure. The per-format table and the two audit-derived blocks. `null` fields mean "no data", never zero. */
export function summariseSqie(input: { requests: readonly SqieRequest[] | null; outcomes: readonly SqieOutcome[] | null; audits: readonly SqieAudit[] | null; days: number; truncated?: boolean }): SqieSummary {
  const { requests, outcomes, audits } = input;
  const spendByAction = new Map<string, number>();
  for (const r of requests ?? []) if (r.action_id) spendByAction.set(r.action_id, (spendByAction.get(r.action_id) ?? 0) + (Number(r.cost_usd ?? 0) || 0));

  const keys = new Set<string>();
  for (const r of requests ?? []) { const f = formatOf(r.operation); if (f) keys.add(f); }
  for (const o of outcomes ?? []) { const f = formatOf(o.operation ?? `individual_scholar_${o.activity}`); if (f) keys.add(f); }

  const formats: FormatRow[] = [...keys].map(format => {
    const reqs = (requests ?? []).filter(r => formatOf(r.operation) === format);
    const gen = reqs.filter(r => !(r.operation ?? "").endsWith("_verify"));
    const outs = (outcomes ?? []).filter(o => formatOf(o.operation ?? `individual_scholar_${o.activity}`) === format && o.outcome !== "redirected");
    const accepted = outs.filter(o => o.outcome === "accepted" || o.outcome === "partial").reduce((n, o) => n + (o.accepted_count ?? 0), 0);
    const rejected = outs.reduce((n, o) => n + (o.rejected_count ?? 0), 0);
    const reasons = new Map<string, number>();
    for (const o of outs) for (const r of o.rejection_reasons ?? []) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    const verified = outs.filter(o => (o.verify_attempts ?? 0) > 0);
    const vFail = verified.filter(o => (o.rejection_reasons ?? []).some(r => VERIFY_FAIL.includes(r)));
    const lat = gen.map(r => r.latency_ms).filter((x): x is number => typeof x === "number");
    const spend = outs.reduce((n, o) => n + (spendByAction.get(o.action_id) ?? 0), 0);
    const measured = outcomes !== null;
    return {
      format, label: FORMAT_LABEL[format] ?? format, actions: outs.length,
      accepted: measured && outs.length ? accepted : null, rejected: measured && outs.length ? rejected : null,
      rejectionRate: measured && accepted + rejected > 0 ? Math.round((rejected / (accepted + rejected)) * 100) : null,
      topReasons: [...reasons.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)).slice(0, 3),
      verified: measured && outs.length ? verified.length : null,
      verificationFailures: measured && verified.length ? vFail.length : null,
      verificationFailureRate: measured && verified.length ? Math.round((vFail.length / verified.length) * 100) : null,
      calls: reqs.length, p50: percentile(lat, 50), p90: percentile(lat, 90),
      cost: requests !== null && reqs.length ? money(reqs.reduce((n, r) => n + (Number(r.cost_usd ?? 0) || 0), 0)) : null,
      costPerAccepted: measured && accepted > 0 ? money(spend / accepted) : null,
    };
  }).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || a.label.localeCompare(b.label));

  const lib = (audits ?? []).filter(a => a.action === "individual_scholar_revision_library");
  const n = (a: SqieAudit, k: string) => { const v = Number(a.new_value?.[k]); return Number.isFinite(v) ? v : 0; };
  const checked = (audits ?? []).filter(a => a.action === "individual_scholar_exam_paper_legacy_checked");
  const redirectedChecked = checked.filter(a => a.new_value?.result === "redirected").length;
  const redirectedAll = (audits ?? []).filter(a => a.action === "individual_scholar_exam_paper_legacy_redirected").length;
  return {
    days: input.days, outcomesMeasured: outcomes !== null, requestsReadable: requests !== null, truncated: !!input.truncated, formats,
    library: audits !== null && lib.length ? { sessions: lib.length, offered: lib.reduce((s, a) => s + n(a, "offered"), 0), picked: lib.reduce((s, a) => s + n(a, "picked"), 0), copied: lib.reduce((s, a) => s + n(a, "copied"), 0), reused: lib.reduce((s, a) => s + n(a, "reused"), 0) } : null,
    // Coverage is measurable only from the release that writes "checked" rows. Before it, only redirects were recorded:
    // those are shown as redirected with checked null ("not recorded"), never as a zero number of checks.
    legacy: audits === null ? null : checked.length ? { checked: checked.length, redirected: redirectedChecked } : redirectedAll ? { checked: null, redirected: redirectedAll } : null,
  };
}

/** Reads the window and summarises it. A table that cannot be read gives null (not measured), never an empty list. */
export async function loadSqieMonitoring(admin: any, days = SQIE_DAYS): Promise<SqieSummary> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const LIMIT = 50000;
  const [req, out, aud] = await Promise.all([
    admin.from("plat_ai_requests").select("operation, cost_usd, latency_ms, action_id").like("operation", "individual_scholar_%").gte("created_at", since).limit(LIMIT),
    admin.from("plat_ai_outcomes").select("action_id, operation, activity, outcome, accepted_count, rejected_count, rejection_reasons, verify_attempts").like("operation", "individual_scholar_%").gte("created_at", since).limit(LIMIT),
    admin.from("audit_log").select("action, new_value, created_at")
      .in("action", ["individual_scholar_revision_library", "individual_scholar_exam_paper_legacy_checked", "individual_scholar_exam_paper_legacy_redirected"]).gte("created_at", since).limit(LIMIT),
  ]);
  return summariseSqie({
    requests: req.error ? null : req.data ?? [], outcomes: out.error ? null : out.data ?? [], audits: aud.error ? null : aud.data ?? [], days,
    truncated: [req, out, aud].some(r => (r.data?.length ?? 0) >= LIMIT),
  });
}
