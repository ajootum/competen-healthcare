// COMP-021 Competency Remediation & Development Pathway. A Remediation Command Centre that consolidates the
// real gap SIGNALS (competency_decisions in a non-passing / expired outcome) against the remediation IN FLIGHT
// (interventions — the governed remediation-plan object) and the coaching backing it (support_sessions).
// Read model over existing stores — NO migration. interventions and competency_decisions are not hard-linked by
// a shared key, so the gap↔plan coverage figures are honest heuristics (name-match + count deltas), flagged as
// estimates in the page Foot. An explicit IDP object binding gap→plan→reassessment→closure + automated gap
// sources are the next-phase deepening (would need a remediation_plans migration).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
// competency_decisions.outcome values that signal an OPEN competency gap (per migration 011 check constraint).
const GAP_OUTCOMES = ["requires_remediation", "not_yet_competent", "expired"];
const GAP_LABEL: Record<string, string> = { requires_remediation: "Requires remediation", not_yet_competent: "Not yet competent", expired: "Expired" };
const GAP_COLOR: Record<string, string> = { requires_remediation: "#f59e0b", not_yet_competent: "#f43f5e", expired: "#8b5cf6" };
// interventions.status values (migration 036: planned | in_progress | review | completed). "closed" tolerated defensively.
const STATUS_META: Record<string, { label: string; color: string }> = {
  planned: { label: "Planned", color: "#94a3b8" },
  in_progress: { label: "In progress", color: "#3b82f6" },
  review: { label: "In review", color: "#f59e0b" },
  completed: { label: "Completed", color: "#10b981" },
  closed: { label: "Closed", color: "#14b8a6" },
};
const isActive = (s: string) => s !== "completed" && s !== "closed";
const nameOf = (d: any) => { const f = d?.framework_competencies; const v = Array.isArray(f) ? f[0] : f; return (v?.name ?? null) as string | null; };

export async function loadRemediationCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // PRIMARY: interventions = the real, governed remediation-plan object. If this errors the module is not provisioned.
  const ivRes = await scope(
    admin.from("interventions")
      .select("nurse_id, competency_name, reason, objectives, review_date, status, outcome, outcome_note, created_by_name, created_at, completed_at")
      .order("created_at", { ascending: false }).limit(4000),
  );
  if (ivRes.error) return { provisioned: false as const };
  const interventions = (ivRes.data ?? []) as any[];

  // GAP SIGNAL: competency_decisions whose outcome is a non-passing / expired state. Competency name via FK embed.
  let decisions: any[] = [];
  try {
    const { data } = await scope(
      admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, effective_date, expiry_date, created_at, framework_competencies(name)")
        .in("outcome", GAP_OUTCOMES).order("created_at", { ascending: false }).limit(8000),
    );
    decisions = (data ?? []) as any[];
  } catch { /* optional — the decision spine may not be provisioned */ }

  // Coaching / mentorship in support of remediation (optional enrichment).
  let sessions: any[] = [];
  try { const { data } = await scope(admin.from("support_sessions").select("session_type, status").limit(4000)); sessions = (data ?? []) as any[]; } catch { /* optional */ }

  const DAY = 86400000;
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 14 * DAY);

  // ── Gap signals ─────────────────────────────────────────────
  const openGaps = decisions.length;
  const gapByOutcome = GAP_OUTCOMES.map(o => ({ outcome: o, label: GAP_LABEL[o], n: decisions.filter(d => d.outcome === o).length, color: GAP_COLOR[o] })).filter(g => g.n > 0);
  const namedGaps = decisions.filter(d => nameOf(d)).length;

  // ── Remediation in flight ───────────────────────────────────
  const active = interventions.filter(iv => isActive(iv.status));
  const completed = interventions.filter(iv => !isActive(iv.status));
  const activeCount = active.length;
  const planned = interventions.filter(iv => iv.status === "planned").length;
  const inProgress = interventions.filter(iv => iv.status === "in_progress").length;
  const inReview = interventions.filter(iv => iv.status === "review").length;

  // Unaddressed gaps = open gap signals in excess of active remediation (heuristic — no shared key).
  const unaddressed = Math.max(0, openGaps - activeCount);

  // Reassessment-due = active interventions with a review_date on or before today+14d (includes overdue).
  const reassessDue = active.filter(iv => iv.review_date && new Date(iv.review_date) <= horizon);
  const overdueReassess = reassessDue.filter(iv => new Date(iv.review_date) < today).length;

  // Success rate = completed interventions with a 'successful' outcome / all completed.
  const successful = completed.filter(iv => iv.outcome === "successful").length;
  const partiallySuccessful = completed.filter(iv => iv.outcome === "partially_successful").length;
  const successRate = completed.length ? Math.round((successful / completed.length) * 100) : null;

  // Avg days open across active interventions (from created_at).
  const durations = active.filter(iv => iv.created_at).map(iv => (now - new Date(iv.created_at).getTime()) / DAY);
  const avgDaysOpen = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // ── Interventions by status (donut) ─────────────────────────
  const statusCounts = new Map<string, number>();
  interventions.forEach(iv => { const s = iv.status ?? "planned"; statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1); });
  const statusDonut = [...statusCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => ({ n, color: STATUS_META[s]?.color ?? "#94a3b8", label: STATUS_META[s]?.label ?? s.replace(/_/g, " ") }));

  // ── Active remediation by competency (bars) ─────────────────
  const compCounts = new Map<string, number>();
  active.forEach(iv => { const key = (iv.competency_name || iv.reason || "Unspecified").trim().slice(0, 60); compCounts.set(key, (compCounts.get(key) ?? 0) + 1); });
  const byCompetency = [...compCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([label, n]) => ({ label, n }));

  // ── Coaching sessions backing remediation ───────────────────
  const scheduledSessions = sessions.filter(s => s.status === "scheduled").length;
  const completedSessions = sessions.filter(s => s.status === "completed").length;

  // ── 9-step remediation & development pathway (stage occupancy from live signals) ──
  const pathway = [
    { step: "1", label: "Detect gap", n: openGaps },
    { step: "2", label: "Analyse & attribute", n: namedGaps },
    { step: "3", label: "Plan remediation", n: planned },
    { step: "4", label: "Assign to learner", n: activeCount },
    { step: "5", label: "Practise & coach", n: inProgress },
    { step: "6", label: "Reassess", n: inReview },
    { step: "7", label: "Close plan", n: completed.length },
    { step: "8", label: "Update record", n: successful },
    { step: "9", label: "Monitor & sustain", n: scheduledSessions },
  ];

  // ── Reassessment-due worklist ───────────────────────────────
  const reassessList = [...reassessDue]
    .sort((a, b) => new Date(a.review_date).getTime() - new Date(b.review_date).getTime())
    .slice(0, 12)
    .map(iv => ({ nurse_id: iv.nurse_id as string | null, competency: iv.competency_name || "General competency", review_date: iv.review_date as string, status: iv.status as string, overdue: new Date(iv.review_date) < today }));

  // ── Recent remediation stream ───────────────────────────────
  const stream = interventions.slice(0, 10).map(iv => ({
    nurse_id: iv.nurse_id as string | null,
    competency: iv.competency_name || "General competency",
    reason: (iv.reason ?? "").slice(0, 80),
    status: iv.status as string,
    outcome: (iv.outcome ?? null) as string | null,
    when: iv.created_at as string,
    by: (iv.created_by_name ?? null) as string | null,
  }));

  // ── Rule-based priority actions (competencies with many gaps and little remediation) ──
  const gapByComp = new Map<string, number>();
  decisions.forEach(d => { const n = nameOf(d); if (n) gapByComp.set(n, (gapByComp.get(n) ?? 0) + 1); });
  const activeCompNames = active.map(iv => (iv.competency_name || "").toLowerCase().trim()).filter(Boolean);
  const hasRemediation = (comp: string) => { const c = comp.toLowerCase().trim(); return activeCompNames.some(a => a === c || a.includes(c) || c.includes(a)); };
  const priorities = [...gapByComp.entries()]
    .map(([comp, gaps]) => ({ comp, gaps, remediated: hasRemediation(comp) }))
    .filter(p => !p.remediated || p.gaps >= 3)
    .sort((a, b) => Number(a.remediated) - Number(b.remediated) || b.gaps - a.gaps)
    .slice(0, 6)
    .map(p => ({
      competency: p.comp,
      gaps: p.gaps,
      priority: (!p.remediated && p.gaps >= 2) ? "high" : "medium",
      text: p.remediated
        ? `${p.gaps} open gap signal${p.gaps === 1 ? "" : "s"} with remediation in flight — verify coverage and reassessment cadence.`
        : `${p.gaps} open gap signal${p.gaps === 1 ? "" : "s"} with no matching remediation plan — assign a targeted ${p.comp} remediation.`,
    }));
  const unattributedGaps = openGaps - namedGaps;

  // ── Resolve learner names for the worklist + stream ─────────
  const nurseIds = [...new Set([...reassessList, ...stream].map(x => x.nurse_id).filter(Boolean))] as string[];
  const nameMap = new Map<string, string>();
  if (nurseIds.length) {
    try { const { data } = await admin.from("profiles").select("id, full_name").in("id", nurseIds); (data ?? []).forEach((p: any) => nameMap.set(p.id, p.full_name)); } catch { /* names optional */ }
  }
  const personOf = (id: string | null) => (id ? (nameMap.get(id) ?? "Learner") : "Learner");
  const reassessRows = reassessList.map(r => ({ ...r, person: personOf(r.nurse_id) }));
  const streamRows = stream.map(s => ({ ...s, person: personOf(s.nurse_id) }));

  return {
    provisioned: true as const,
    empty: interventions.length === 0 && openGaps === 0,
    kpis: {
      openGaps,
      activeRemediation: activeCount,
      unaddressed,
      reassessDue: reassessDue.length,
      overdueReassess,
      successRate,
      successful,
      completedTotal: completed.length,
      avgDaysOpen,
    },
    gapByOutcome,
    statusDonut,
    byCompetency,
    pathway,
    reassessRows,
    streamRows,
    priorities,
    unattributedGaps,
    coaching: { scheduled: scheduledSessions, completed: completedSessions, partiallySuccessful },
  };
}
