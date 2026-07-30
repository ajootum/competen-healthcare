/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-027 — Organisational Learning & Knowledge Transformation.
// The LOOP-CLOSURE PERFORMANCE lens (§14 KPIs), distinct from COMP-028 quality-feedback (which correlates events
// to competency DOMAINS by heuristic and shows risk). This measures whether the learning loop actually closes,
// using real op_incidents columns that exist but nothing renders today:
//   • corrective_action — "learning signals transformed into actions" (§14 KPI 1): the conversion rate.
//   • created_at → closed_at — "time from event to improvement" (§14 KPI 2): real cycle time.
//   • recurrence by incident_type — "recurrence reduction" (§14 KPI 3): last 90d vs prior 90d, per type.
//     Grouped by the REAL incident_type column (no regex heuristic).
//   • change_requests — competency evolution actually enacted (§7), counted as the transformation OUTPUT.
// HONESTY: there is no persistent incident↔competency linkage table, so evolution is counted alongside, NOT
// causally attributed to, specific events. Signal→domain correlation stays owned by COMP-028. No migration.

type Admin = any;
const DAY = 86400000;
const label = (s: string) => (s || "other").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function loadOrganisationalLearning(admin: Admin) {
  const [incRes, crRes] = await Promise.all([
    admin.from("op_incidents").select("incident_type, severity, near_miss, status, corrective_action, created_at, closed_at").order("created_at", { ascending: false }).limit(5000),
    admin.from("change_requests").select("status, change_kind, created_at").limit(2000),
  ]);

  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];
  const crs = (crRes.error ? [] : crRes.data ?? []) as any[];
  const now = Date.now();

  const total = incidents.length;
  const withAction = incidents.filter((i) => i.corrective_action && String(i.corrective_action).trim().length > 0).length;
  const conversion = total ? Math.round((withAction / total) * 100) : null;

  const closed = incidents.filter((i) => i.closed_at && i.created_at);
  const cycles = closed
    .map((i) => Math.max(0, Math.round((new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / DAY)))
    .sort((a, b) => a - b);
  const avgCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null;
  const medianCycle = cycles.length ? cycles[Math.floor(cycles.length / 2)] : null;

  const open = incidents.filter((i) => i.status !== "closed");
  const openNoAction = open.filter((i) => !i.corrective_action || !String(i.corrective_action).trim()).length;
  const oldestOpen = open.length
    ? Math.max(...open.map((i) => Math.round((now - new Date(i.created_at).getTime()) / DAY)))
    : 0;

  // Recurrence by real incident_type — last 90d vs prior 90d.
  const recent = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const i of incidents) {
    const age = now - new Date(i.created_at).getTime();
    const t = i.incident_type || "other";
    if (age <= 90 * DAY) recent.set(t, (recent.get(t) ?? 0) + 1);
    else if (age <= 180 * DAY) prior.set(t, (prior.get(t) ?? 0) + 1);
  }
  const types = [...new Set([...recent.keys(), ...prior.keys()])]
    .map((t) => {
      const r = recent.get(t) ?? 0;
      const p = prior.get(t) ?? 0;
      return { type: t, label: label(t), recent: r, prior: p, delta: r - p, recurring: r > 0 && p > 0 };
    })
    .sort((a, b) => b.recent - a.recent || b.prior - a.prior)
    .slice(0, 10);
  const recentTotal = [...recent.values()].reduce((a, b) => a + b, 0);
  const priorTotal = [...prior.values()].reduce((a, b) => a + b, 0);
  const recurrenceDelta = priorTotal ? Math.round(((recentTotal - priorTotal) / priorTotal) * 100) : null;
  const recurringTypes = types.filter((t) => t.recurring).length;

  // Competency evolution enacted (§7) — the transformation output.
  const evoOpen = crs.filter((c) => c.status === "open").length;
  const evoDone = crs.filter((c) => c.status === "approved" || c.status === "implemented").length;
  const evoKind: Record<string, number> = { major: 0, minor: 0, revision: 0 };
  for (const c of crs) if (c.change_kind in evoKind) evoKind[c.change_kind]++;

  // Learning lifecycle (§6) with the counts that are genuinely derivable.
  const highCritical = incidents.filter((i) => ["high", "critical"].includes(i.severity)).length;
  const lifecycle = [
    { step: "Signal identified", n: total, note: "quality events captured" },
    { step: "Analysis", n: highCritical, note: "high/critical prioritised" },
    { step: "Action recorded", n: withAction, note: "corrective action captured" },
    { step: "Loop closed", n: closed.length, note: "event closed out" },
    { step: "Competency evolution", n: evoDone, note: "changes enacted" },
  ];

  return {
    provisioned: total > 0 || crs.length > 0,
    kpis: {
      signals: total,
      withAction,
      conversion,
      avgCycle,
      medianCycle,
      closedCount: closed.length,
      open: open.length,
      openNoAction,
      oldestOpen,
      recurringTypes,
      recurrenceDelta,
      evoDone,
      evoOpen,
    },
    types,
    lifecycle,
    evolution: { done: evoDone, open: evoOpen, total: crs.length, byKind: evoKind },
  };
}
