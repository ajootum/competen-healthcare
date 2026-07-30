/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-027 — Organisational Learning & Knowledge Transformation.
// Two layers, deliberately distinguished on the page:
//
//  1. CAUSAL (competency_learning_links, migration 150) — the real closed loop. Each link is a governance
//     assertion that a specific signal caused a specific competency change, carrying a rationale and moving
//     proposed → confirmed → implemented. Because the link records signal_date and implemented_at, "time from
//     event to improvement" (§14 KPI 2) becomes a MEASURED causal duration, and loop closure (§4.2) becomes
//     provable rather than inferred. Fail-soft: if migration 150 isn't applied, linkageReady = false and the
//     page says so plainly instead of pretending.
//
//  2. OPERATIONAL (op_incidents) — signal→action conversion (corrective_action recorded), event cycle time
//     (created_at→closed_at) and recurrence by real incident_type. Real facts about how events are handled,
//     but not proof that competency evolved. Retained because it covers ALL events, linked or not.
//
// Signal→competency-domain correlation stays owned by COMP-028 quality-feedback.

type Admin = any;
const DAY = 86400000;
const label = (s: string) => (s || "other").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const median = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export async function loadOrganisationalLearning(admin: Admin) {
  const [incRes, crRes, linkRes, compRes] = await Promise.all([
    admin.from("op_incidents").select("id, incident_type, severity, near_miss, status, corrective_action, description, created_at, closed_at").order("created_at", { ascending: false }).limit(5000),
    admin.from("change_requests").select("status, change_kind, created_at").limit(2000),
    admin.from("competency_learning_links").select("id, source_type, source_id, source_ref, signal_date, target_type, target_name, link_type, rationale, status, proposed_by_ai, confirmed_by_name, confirmed_at, implemented_at, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("framework_competencies").select("id, name, code").order("name").limit(400),
  ]);

  const incidents = (incRes.error ? [] : incRes.data ?? []) as any[];
  const crs = (crRes.error ? [] : crRes.data ?? []) as any[];
  const linkageReady = !linkRes.error;
  const links = (linkRes.error ? [] : linkRes.data ?? []) as any[];
  const now = Date.now();

  // ── Layer 1: causal linkage ──
  const byStatus: Record<string, number> = { proposed: 0, confirmed: 0, implemented: 0, rejected: 0 };
  for (const l of links) if (l.status in byStatus) byStatus[l.status]++;
  const decided = links.length - byStatus.rejected;
  const closureRate = decided > 0 ? Math.round((byStatus.implemented / decided) * 100) : null;

  // REAL time-to-improvement: signal_date → implemented_at.
  const causalDurations = links
    .filter((l) => l.status === "implemented" && l.signal_date && l.implemented_at)
    .map((l) => Math.max(0, Math.round((new Date(l.implemented_at).getTime() - new Date(l.signal_date).getTime()) / DAY)));
  const causalMedian = median(causalDurations);
  const causalAvg = causalDurations.length ? Math.round(causalDurations.reduce((a, b) => a + b, 0) / causalDurations.length) : null;

  const linkedSourceIds = new Set(links.filter((l) => l.source_id).map((l) => l.source_id));
  const linkCoverage = incidents.length ? Math.round((incidents.filter((i) => linkedSourceIds.has(i.id)).length / incidents.length) * 100) : null;

  const byLinkType = new Map<string, number>();
  for (const l of links) byLinkType.set(l.link_type, (byLinkType.get(l.link_type) ?? 0) + 1);
  const linkTypes = [...byLinkType.entries()].map(([t, count]) => ({ type: t, label: label(t), count })).sort((a, b) => b.count - a.count);

  const register = links.slice(0, 12).map((l) => ({
    id: l.id,
    source: l.source_ref ?? label(l.source_type),
    sourceType: label(l.source_type),
    target: l.target_name ?? label(l.target_type),
    linkType: label(l.link_type),
    rationale: l.rationale,
    status: l.status,
    byAi: l.proposed_by_ai,
    days: l.signal_date && l.implemented_at ? Math.max(0, Math.round((new Date(l.implemented_at).getTime() - new Date(l.signal_date).getTime()) / DAY)) : null,
  }));
  const awaitingReview = links.filter((l) => l.status === "proposed").length;

  // ── Layer 2: operational handling ──
  const total = incidents.length;
  const withAction = incidents.filter((i) => i.corrective_action && String(i.corrective_action).trim().length > 0).length;
  const conversion = total ? Math.round((withAction / total) * 100) : null;

  const closed = incidents.filter((i) => i.closed_at && i.created_at);
  const cycles = closed.map((i) => Math.max(0, Math.round((new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / DAY)));
  const avgCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null;
  const medianCycle = median(cycles);

  const open = incidents.filter((i) => i.status !== "closed");
  const openNoAction = open.filter((i) => !i.corrective_action || !String(i.corrective_action).trim()).length;

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
      const r = recent.get(t) ?? 0, p = prior.get(t) ?? 0;
      return { type: t, label: label(t), recent: r, prior: p, delta: r - p, recurring: r > 0 && p > 0 };
    })
    .sort((a, b) => b.recent - a.recent || b.prior - a.prior)
    .slice(0, 10);
  const recentTotal = [...recent.values()].reduce((a, b) => a + b, 0);
  const priorTotal = [...prior.values()].reduce((a, b) => a + b, 0);
  const recurrenceDelta = priorTotal ? Math.round(((recentTotal - priorTotal) / priorTotal) * 100) : null;

  const evoOpen = crs.filter((c) => c.status === "open").length;
  const evoDone = crs.filter((c) => c.status === "approved" || c.status === "implemented").length;
  const evoKind: Record<string, number> = { major: 0, minor: 0, revision: 0 };
  for (const c of crs) if (c.change_kind in evoKind) evoKind[c.change_kind]++;

  const highCritical = incidents.filter((i) => ["high", "critical"].includes(i.severity)).length;
  // The lifecycle now ends in PROVEN closure when linkage exists.
  const lifecycle = [
    { step: "Signal identified", n: total, note: "quality events captured" },
    { step: "Analysis", n: highCritical, note: "high/critical prioritised" },
    { step: "Action recorded", n: withAction, note: "corrective action captured" },
    { step: "Linked to competency", n: links.length, note: linkageReady ? "governance linkage asserted" : "linkage not enabled" },
    { step: "Loop closed (proven)", n: byStatus.implemented, note: "change implemented from signal" },
  ];

  // Candidates for proposing a link — structured records only, so source_id/target_id are real FKs (the unique
  // edge index and the causal duration both depend on that). Unlinked signals first: those are the open loops.
  const competencies = ((compRes.error ? [] : compRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.code ? `${c.name} (${c.code})` : c.name }));
  const unlinkedSignals = incidents
    .filter((i) => !linkedSourceIds.has(i.id))
    .slice(0, 40)
    .map((i) => ({
      id: i.id,
      label: `${label(i.incident_type)}${i.description ? ` — ${String(i.description).slice(0, 60)}` : ""}`,
      date: i.created_at ? String(i.created_at).slice(0, 10) : null,
      severity: i.severity,
    }));

  return {
    provisioned: total > 0 || crs.length > 0 || links.length > 0,
    candidates: { signals: unlinkedSignals, competencies, unlinkedTotal: incidents.length - linkedSourceIds.size },
    linkage: {
      ready: linkageReady,
      total: links.length,
      byStatus,
      closureRate,
      causalMedian,
      causalAvg,
      causalCount: causalDurations.length,
      coverage: linkCoverage,
      awaitingReview,
      types: linkTypes,
      register,
    },
    kpis: {
      signals: total, withAction, conversion, avgCycle, medianCycle,
      closedCount: closed.length, open: open.length, openNoAction,
      recurringTypes: types.filter((t) => t.recurring).length, recurrenceDelta,
      evoDone, evoOpen,
    },
    types,
    lifecycle,
    evolution: { done: evoDone, open: evoOpen, total: crs.length, byKind: evoKind },
  };
}
