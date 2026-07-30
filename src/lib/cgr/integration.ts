/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-013 — Competency Governance Interoperability & Integration.
// "How does governance information move between systems while preserving accuracy, security and accountability?"
// The LIVE substance is the event-driven integration backbone (PW-014) — no surface monitors its health today:
//   • domain_events (mig 102) — the governance event bus: event_type, subject_type, processing status
//     (pending / processed / failed / dead_letter), attempts, trace_id, aggregate_version.
// From it: event processing health (§14 event-processing success / integration reliability), the retry/dead-letter
// backlog, event flow by type (§10), the internal-platform data-flow map (§5, event families → CST/CAP/CDP/COMP/
// CMO/…), and traceability (§4.1 — trace_id + aggregate_version). The stated integration architecture (which
// platforms exchange what) is rendered as labelled reference. Config/workspace-links stay owned by CMO. No migration.

type Admin = any;
const DAY = 86400000;

function platformOf(eventType: string, subjectType: string): string {
  const s = `${eventType || ""} ${subjectType || ""}`.toLowerCase();
  if (/(approval|change_request|governance)/.test(s)) return "Governance";
  if (/(assessment|competency_decision|competency_lifecycle|cycle|validation)/.test(s)) return "Assessment (COMP)";
  if (/(framework|competency|domain|cpu|standard|mapping)/.test(s)) return "Studio (CST)";
  if (/(knowledge|evidence|asset|document|simulation)/.test(s)) return "Assets (CAP)";
  if (/(learning|delivery|campaign|pathway|reinforcement|reminder)/.test(s)) return "Delivery (CDP)";
  if (/(program|assignment|workforce|readiness|remediation|recert)/.test(s)) return "Office (CMO)";
  if (/(shift|roster|operation|bed|incident|patient)/.test(s)) return "Operations";
  return "Other";
}

export async function loadIntegrationHealth(admin: Admin) {
  const { data, error } = await admin
    .from("domain_events")
    .select("event_type, subject_type, status, attempts, occurred_at, trace_id, aggregate_version")
    .order("occurred_at", { ascending: false })
    .limit(6000);

  const evs = (error ? [] : data ?? []) as any[];
  const now = Date.now();

  const byStatus: Record<string, number> = { processed: 0, pending: 0, failed: 0, dead_letter: 0 };
  const byType = new Map<string, number>();
  const byPlatform = new Map<string, number>();
  let withTrace = 0, withVersion = 0, retryBacklog = 0;
  const failing: any[] = [];
  for (const e of evs) {
    if (e.status in byStatus) byStatus[e.status]++;
    byType.set(e.event_type || "unknown", (byType.get(e.event_type || "unknown") ?? 0) + 1);
    const p = platformOf(e.event_type, e.subject_type);
    byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
    if (e.trace_id) withTrace++;
    if (e.aggregate_version != null) withVersion++;
    if ((e.attempts ?? 0) > 0 && e.status !== "processed") retryBacklog++;
    if ((e.status === "failed" || e.status === "dead_letter") && failing.length < 12) {
      failing.push({ type: e.event_type ?? "—", subject: e.subject_type ?? "—", status: e.status, attempts: e.attempts ?? 0, at: e.occurred_at });
    }
  }

  const total = evs.length;
  const terminal = byStatus.processed + byStatus.failed + byStatus.dead_letter;
  const successRate = terminal ? Math.round((byStatus.processed / terminal) * 100) : null;
  const last7 = evs.filter((e) => now - new Date(e.occurred_at).getTime() <= 7 * DAY).length;
  const last30 = evs.filter((e) => now - new Date(e.occurred_at).getTime() <= 30 * DAY).length;

  const types = [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  const platforms = [...byPlatform.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count);

  return {
    provisioned: total > 0,
    kpis: {
      total,
      last7,
      last30,
      successRate,
      processed: byStatus.processed,
      pending: byStatus.pending,
      failed: byStatus.failed,
      deadLetter: byStatus.dead_letter,
      retryBacklog,
      tracePct: total ? Math.round((withTrace / total) * 100) : 0,
      versionPct: total ? Math.round((withVersion / total) * 100) : 0,
    },
    byStatus,
    types,
    platforms,
    failing,
  };
}
