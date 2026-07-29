// COMP-019 Competency Achievement & Readiness State Engine. Resolves every worker's LATEST competency decision
// into exactly one of seven NAMED readiness states — Expired, Remediation Required, Restricted Practice,
// Not Ready, At Risk, Partially Ready, Ready — by a fixed top-down precedence over the real decision outcome
// and expiry. Yields a per-decision distribution and a per-worker worst-state rollup with an attention worklist.
// Read model over competency_decisions (migration 011; hospital_id added 027) — NO migration. States are DERIVED
// on read from outcome + expiry_date, NOT a persisted recompute-on-event lifecycle state (that persisted
// competency_lifecycle_state + event-driven recompute is COMP-017's next-phase migration — flagged in the Foot).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export type ReadinessKey = "expired" | "remediation" | "restricted" | "not_ready" | "at_risk" | "partial" | "ready";

// The seven readiness states in PRECEDENCE order (index 0 = evaluated first = worst). Each carries a distinct
// HEX colour (donut), a Pill tone, its definition and the COMP-019 readiness-index band used to explain it.
export const STATES: { key: ReadinessKey; label: string; color: string; tone: string; band: string; def: string }[] = [
  { key: "expired",     label: "Expired",              color: "#64748b", tone: "slate",   band: "0–9",    def: "Certification lapsed — the expiry date has passed, or the decision was explicitly expired. No current authority to practise." },
  { key: "remediation", label: "Remediation Required", color: "#dc2626", tone: "rose",    band: "10–24",  def: "Assessed not-yet-competent or requiring remediation — a development plan is needed before sign-off." },
  { key: "restricted",  label: "Restricted Practice",  color: "#9333ea", tone: "violet",  band: "25–39",  def: "Practice is actively restricted — the competency decision is suspended pending review." },
  { key: "not_ready",   label: "Not Ready",            color: "#f97316", tone: "amber",   band: "40–59",  def: "Provisionally competent only — a validated, current competent decision is not yet in place." },
  { key: "at_risk",     label: "At Risk",              color: "#f59e0b", tone: "amber",   band: "60–79",  def: "Currently competent but the certification expires within 30 days — reassessment must be scheduled." },
  { key: "partial",     label: "Partially Ready",      color: "#3b82f6", tone: "blue",    band: "80–94",  def: "Competent to practise with conditions attached — cleared, but within defined limitations." },
  { key: "ready",       label: "Ready",                color: "#10b981", tone: "emerald", band: "95–100", def: "Fully competent with a current certification (no expiry, or more than 30 days remaining)." },
];
const IDX: Record<ReadinessKey, number> = STATES.reduce((m, s, i) => { m[s.key] = i; return m; }, {} as Record<ReadinessKey, number>);

// Competency NAME via the framework_competencies FK embed (PostgREST returns object-or-array).
const nameOf = (d: any) => { const f = d?.framework_competencies; const v = Array.isArray(f) ? f[0] : f; return (v?.name ?? null) as string | null; };

// Resolve a single latest decision to exactly one readiness state (top-down, FIRST MATCH WINS).
// RULE CHOICE (documented in the page Foot): competent_with_conditions → Partially Ready (competent, WITH
// conditions), reserving Restricted Practice for `suspended` decisions where practice is actively restricted.
// This keeps all seven states reachable; the alternative (folding conditions into Restricted) would make
// Partially Ready unreachable.
function resolveState(outcome: string, expiry: string | null, today: string, in30: string): ReadinessKey {
  const isExpired = !!expiry && expiry < today;
  if (outcome === "expired" || isExpired) return "expired";
  if (outcome === "requires_remediation" || outcome === "not_yet_competent") return "remediation";
  if (outcome === "suspended") return "restricted";
  if (outcome === "provisionally_competent") return "not_ready";
  if (outcome === "competent" && !!expiry && expiry <= in30) return "at_risk";
  if (outcome === "competent_with_conditions") return "partial";
  if (outcome === "competent") return "ready";
  return "not_ready"; // unknown / other outcome → treated as not ready (safe default)
}

export async function loadReadinessStates(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // PRIMARY: the governed competency-decision spine. If this errors the engine is not provisioned.
  const decRes = await scope(
    admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, expiry_date, created_at, framework_competencies(name)")
      .order("created_at", { ascending: false })
      .limit(8000),
  );
  if (decRes.error) return { provisioned: false as const };
  const decisions = (decRes.data ?? []) as any[];

  // LATEST decision per (nurse_id, competency_id) — rows arrive created_at DESC, so first-seen wins.
  const seen = new Set<string>();
  const latest: any[] = [];
  for (const d of decisions) {
    const key = `${d.nurse_id}::${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(d);
  }

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // ── Per-decision state assignment → distribution + per-worker WORST-state rollup ──
  const decCount: Record<ReadinessKey, number> = { expired: 0, remediation: 0, restricted: 0, not_ready: 0, at_risk: 0, partial: 0, ready: 0 };
  const worker = new Map<string, { idx: number; competency: string | null }>();
  for (const d of latest) {
    const st = resolveState(d.outcome, d.expiry_date, today, in30);
    decCount[st]++;
    const idx = IDX[st];
    const prev = worker.get(d.nurse_id);
    if (!prev || idx < prev.idx) worker.set(d.nurse_id, { idx, competency: nameOf(d) }); // lower idx = worse state
  }

  const total = latest.length;
  const workers = worker.size;

  // Workers per state (their single worst state).
  const workerCount: Record<ReadinessKey, number> = { expired: 0, remediation: 0, restricted: 0, not_ready: 0, at_risk: 0, partial: 0, ready: 0 };
  worker.forEach(v => { workerCount[STATES[v.idx].key]++; });

  // Attention = workers whose worst state is NOT Ready / Partially Ready, worst first.
  const OK = new Set<ReadinessKey>(["ready", "partial"]);
  const attention = [...worker.entries()]
    .filter(([, v]) => !OK.has(STATES[v.idx].key))
    .sort((a, b) => a[1].idx - b[1].idx);
  const needAttention = attention.length;

  // Resolve learner names for the top-10 worklist only.
  const attnTop = attention.slice(0, 10);
  const attnIds = [...new Set(attnTop.map(([id]) => id).filter(Boolean))] as string[];
  const nameMap = new Map<string, string>();
  if (attnIds.length) {
    try { const { data } = await admin.from("profiles").select("id, full_name").in("id", attnIds); (data ?? []).forEach((p: any) => nameMap.set(p.id, p.full_name)); } catch { /* names optional */ }
  }
  const worklist = attnTop.map(([id, v]) => ({
    person: (id ? nameMap.get(id) : null) ?? "Worker",
    stateKey: STATES[v.idx].key,
    stateLabel: STATES[v.idx].label,
    tone: STATES[v.idx].tone,
    competency: v.competency ?? "Unspecified competency",
  }));

  // Full seven-state distribution (kept complete — zero-count states are shown for transparency).
  const distribution = STATES.map(s => ({
    key: s.key, label: s.label, color: s.color, tone: s.tone, band: s.band, def: s.def,
    decisions: decCount[s.key], workers: workerCount[s.key],
    pct: total ? Math.round((decCount[s.key] / total) * 100) : 0,
  }));
  const donutSegs = distribution.map(s => ({ n: s.decisions, color: s.color, label: s.label }));

  return {
    provisioned: true as const,
    empty: total === 0,
    kpis: {
      assessed: total,
      workers,
      readyPct: total ? Math.round((decCount.ready / total) * 100) : 0,
      atRisk: decCount.at_risk,
      remediation: decCount.remediation,
      expired: decCount.expired,
      needAttention,
    },
    distribution,
    donutSegs,
    worklist,
  };
}
