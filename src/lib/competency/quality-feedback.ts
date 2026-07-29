// COMP-028 Competency-to-Quality Feedback Loop. Closes the loop between quality signals and competency
// management: real quality events (op_incidents — typed + severity + near-miss) are correlated to the
// competency DOMAIN whose gap they most likely signal, then matched against the remediation in flight
// (interventions), yielding quality-linked competency risks + recommended review. Read model over existing
// stores — NO migration. A persistent incident↔competency linkage table + M&M / audit / patient-feedback
// signal sources are the next-phase deepening (flagged in the page Foot).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Map an incident type/description to the competency domain whose gap it most likely signals.
const DOMAINS: { domain: string; color: string; re: RegExp }[] = [
  { domain: "Medication Safety", color: "#ef4444", re: /medicat|drug|dose|infusion|insulin|anticoag|prescrib|omitted med/i },
  { domain: "Falls Prevention", color: "#f59e0b", re: /fall|slip|trip|mobilit/i },
  { domain: "Clinical Assessment & Escalation", color: "#3b82f6", re: /deteriorat|pews|\bews\b|escalat|sepsis|arrest|observation|vital|acuit/i },
  { domain: "Infection Prevention & Control", color: "#10b981", re: /infect|\bipc\b|hygiene|isolation|sterile|\bhai\b|clabsi|cauti|outbreak/i },
  { domain: "Pressure & Skin Care", color: "#8b5cf6", re: /pressure|skin|ulcer|wound|tissue/i },
  { domain: "Documentation & Records", color: "#14b8a6", re: /document|record|chart|consent|handover|sbar|omission/i },
  { domain: "Equipment & Devices", color: "#ec4899", re: /equipment|device|pump|monitor|ventilat|alarm/i },
  { domain: "Safeguarding & Restraint", color: "#6366f1", re: /restraint|safeguard|abuse|abscond|violence|aggress/i },
];
const OTHER = { domain: "General Clinical Practice", color: "#94a3b8" };
const domainOf = (incidentType: string, text: string) => DOMAINS.find(d => d.re.test(`${incidentType ?? ""} ${text ?? ""}`))?.domain ?? OTHER.domain;
const colorOf = (domain: string) => DOMAINS.find(d => d.domain === domain)?.color ?? OTHER.color;

export async function loadQualityFeedback(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const incRes = await scope(admin.from("op_incidents").select("incident_type, severity, near_miss, status, description, corrective_action, created_at, closed_at").order("created_at", { ascending: false }).limit(4000));
  if (incRes.error) return { provisioned: false as const };
  const incidents = (incRes.data ?? []) as any[];

  // Remediation in flight = competency intervention plans.
  let interventions: any[] = [];
  try { const { data } = await scope(admin.from("interventions").select("competency_name, reason, status, created_at").limit(4000)); interventions = (data ?? []) as any[]; } catch { /* optional */ }

  // Per-domain correlation of quality events.
  const dmap = new Map<string, { events: number; highCritical: number; nearMiss: number; open: number }>();
  incidents.forEach(i => {
    const d = domainOf(i.incident_type, i.description);
    const r = dmap.get(d) ?? { events: 0, highCritical: 0, nearMiss: 0, open: 0 };
    r.events++;
    if (["high", "critical"].includes(i.severity)) r.highCritical++;
    if (i.near_miss) r.nearMiss++;
    if (i.status !== "closed") r.open++;
    dmap.set(d, r);
  });
  const remBy = new Map<string, number>();
  interventions.forEach(iv => { const d = domainOf(iv.competency_name ?? "", iv.reason ?? ""); remBy.set(d, (remBy.get(d) ?? 0) + 1); });

  const domains = [...dmap.entries()].map(([domain, r]) => {
    const rem = remBy.get(domain) ?? 0;
    const gap = Math.max(0, r.highCritical - rem);
    const risk = r.highCritical >= 3 && rem === 0 ? "rose" : r.highCritical > rem ? "amber" : "emerald";
    return { domain, ...r, interventions: rem, gap, risk };
  }).sort((a, b) => b.highCritical - a.highCritical || b.events - a.events);

  const totalEvents = incidents.length;
  const highCritical = incidents.filter(i => ["high", "critical"].includes(i.severity)).length;
  const nearMiss = incidents.filter(i => i.near_miss).length;
  const openInterventions = interventions.filter(iv => iv.status !== "completed" && iv.status !== "closed").length;
  const closedInterventions = interventions.filter(iv => iv.status === "completed" || iv.status === "closed").length;
  const unaddressed = domains.filter(d => d.risk === "rose").length;

  const domainDonut = domains.slice(0, 6).map(d => ({ n: d.events, color: colorOf(d.domain), label: d.domain }));

  const monthAgg = new Map<string, number>();
  incidents.forEach(i => { const k = String(i.created_at ?? "").slice(0, 7); if (k) monthAgg.set(k, (monthAgg.get(k) ?? 0) + 1); });
  const trend = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));

  // The closed loop (COMP-028 §2, 7 steps) with derivable counts.
  const loop = [
    { step: "1", label: "Capture", n: totalEvents },
    { step: "2", label: "Analyse & prioritise", n: highCritical },
    { step: "3", label: "Link to competency", n: domains.length },
    { step: "4", label: "Root cause", n: domains.filter(d => d.highCritical > 0).length },
    { step: "5", label: "Remediate & learn", n: openInterventions },
    { step: "6", label: "Reassess & validate", n: closedInterventions },
    { step: "7", label: "Measure impact", n: trend.length >= 2 ? trend[trend.length - 2].value - trend[trend.length - 1].value : 0 },
  ];

  const recommendations = domains.filter(d => d.risk !== "emerald").slice(0, 5).map(d => ({
    domain: d.domain,
    priority: d.risk === "rose" ? "high" : "medium",
    text: d.interventions === 0
      ? `${d.highCritical} high/critical ${d.domain} event${d.highCritical === 1 ? "" : "s"} with no remediation in flight — assign a targeted ${d.domain} competency review.`
      : `${d.highCritical} high/critical events vs ${d.interventions} active remediation${d.interventions === 1 ? "" : "s"} — verify coverage and schedule reassessment.`,
  }));

  const stream = incidents.slice(0, 10).map(i => ({ type: (i.incident_type ?? "other").replace(/_/g, " "), domain: domainOf(i.incident_type, i.description), severity: i.severity, when: i.created_at, status: i.status, nearMiss: i.near_miss }));

  return {
    provisioned: true as const,
    empty: totalEvents === 0,
    kpis: { events: totalEvents, highCritical, nearMiss, domainsImpacted: domains.length, remediationOpen: openInterventions, unaddressed },
    loop, domains, domainDonut, trend, recommendations, stream,
  };
}
