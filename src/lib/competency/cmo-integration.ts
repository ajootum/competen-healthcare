// CMO-005 Cross-Workspace Integration Framework — the Competency Office's integration lens over the real
// domain-event backbone (domain_events, migration 102: the transactional outbox / event bus). Event volume,
// the live business-event stream, top flows, delivery-status split and failure alerts are REAL and tenant-scoped.
// The cross-workspace MAP + per-workspace health are STRUCTURAL — derived by routing event_type/subject_type to
// the Competen workspaces CMO integrates with (CMO-000/005); no per-workspace uptime is ever fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

// The real Competen workspaces CMO integrates with (static catalogue — CMO-000/005). Each carries a matcher over
// `${event_type} ${subject_type}` so live event flow can light it up honestly (an event may be relevant to more
// than one workspace — integration is many-to-many).
const WORKSPACES: { name: string; icon: string; re: RegExp }[] = [
  { name: "Competency Studio", icon: "🧬", re: /competency\.(published|retired|version|approved)|framework|blueprint|\bcpu\b/i },
  { name: "Healthcare Worker", icon: "👩‍⚕️", re: /task\.|competency\.(achieved|assigned)|\bworker\b/i },
  { name: "Assessor", icon: "✅", re: /assessment|validation|sign[-_ ]?off/i },
  { name: "Educator", icon: "🎓", re: /learning|course|curriculum|training|educat/i },
  { name: "HR", icon: "🧾", re: /credential|certification|\bhr\b|onboarding|position|contract/i },
  { name: "Quality & Accreditation", icon: "🏅", re: /incident|capa|audit\.|accreditation|quality|survey|\brisk\b/i },
  { name: "Executive", icon: "📈", re: /executive|strategy|\bkpi\b|board|snapshot/i },
  { name: "Unit Manager", icon: "🗂️", re: /staffing|unit\.|roster|capacity|\bbed\b|schedul/i },
  { name: "Shift Supervisor", icon: "🕑", re: /shift\.|handover|supervisor/i },
  { name: "Personal", icon: "🔔", re: /notification|preference|\bpersonal\b|\bmessage/i },
  { name: "Organisation Administration", icon: "⚙️", re: /workspace\.|entitlement|policy|security\.|admin\.|\bconfig/i },
];

// Core business event catalogue (static reference — the CMO-005 event taxonomy competencies emit platform-wide).
const CORE_EVENTS = [
  "Competency Published", "Competency Assigned", "Assessment Scheduled", "Assessment Completed",
  "Competency Achieved", "Credential Expired", "Gap Detected", "Improvement Plan Created",
  "Learning Completed", "Reassessment Due", "Competency Retired",
];

export async function loadCmoIntegration(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const now = Date.now();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const windowStart = new Date(now - 30 * 86400000).toISOString();

  // Provisioning probe — domain_events (migration 102, the transactional event backbone). Missing table → error.
  const probe = await scope(admin.from("domain_events").select("id", { count: "exact", head: true }));
  if (probe.error) return { provisioned: false as const };
  const totalAll = probe.count ?? 0;

  // Exact total in the 30-day window (never capped by the row limit below).
  let totalWindow = 0;
  try {
    const r = await scope(admin.from("domain_events").select("id", { count: "exact", head: true }).gte("occurred_at", windowStart));
    totalWindow = r.count ?? 0;
  } catch { /* window count optional */ }

  // Recent window rows (last 30 days) — drives the stream, flows, delivery split, active types, health + alerts.
  const { data: evRows } = await scope(
    admin.from("domain_events")
      .select("event_type, subject_type, actor_name, occurred_at, created_at, status")
      .gte("occurred_at", windowStart)
      .order("occurred_at", { ascending: false })
      .limit(2000)
  );
  const events = (evRows ?? []) as any[];

  // Delivery-status split over the window (real).
  const by = (s: string) => events.filter(e => e.status === s).length;
  const processed = by("processed"), pending = by("pending"), failed = by("failed"), deadLetter = by("dead_letter");
  const failedTotal = failed + deadLetter;
  const successDenom = processed + failedTotal;                                    // pending is not a terminal outcome
  const successRate = successDenom > 0 ? Math.round((processed / successDenom) * 100) : null;
  const processedToday = events.filter(e => e.status === "processed" && String(e.occurred_at ?? e.created_at ?? "").slice(0, 10) === todayStr).length;
  const statusTotal = processed + pending + failedTotal;

  // Live business-event stream — most-recent 8 (rows already ordered desc).
  const stream = events.slice(0, 8).map(e => ({ type: e.event_type, subject: e.subject_type, actor: e.actor_name, when: e.occurred_at ?? e.created_at, status: e.status }));

  // Top integration flows — grouped by event_type.
  const flowMap = new Map<string, number>();
  events.forEach(e => { const t = e.event_type ?? "unknown"; flowMap.set(t, (flowMap.get(t) ?? 0) + 1); });
  const flows = [...flowMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ label, n }));
  const activeEventTypes = flowMap.size;

  // Delivery-status donut segments (page renders only the non-zero ones).
  const statusDonut = [
    { label: "Processed", value: processed, color: "#22c55e" },
    { label: "Pending", value: pending, color: "#f59e0b" },
    { label: "Failed", value: failed, color: "#ef4444" },
    { label: "Dead letter", value: deadLetter, color: "#9f1239" },
  ];

  // Structural cross-workspace map + health — derived by routing event types/subjects to workspaces (NOT uptime).
  const workspaces = WORKSPACES.map(w => {
    const matched = events.filter(e => w.re.test(`${e.event_type ?? ""} ${e.subject_type ?? ""}`));
    return { name: w.name, icon: w.icon, volume: matched.length, live: matched.length > 0, last: matched[0]?.occurred_at ?? matched[0]?.created_at ?? null };
  });
  const liveWorkspaces = workspaces.filter(w => w.live).length;

  // Recent integration alerts — delivery failures (failed / dead_letter).
  const alerts = events.filter(e => e.status === "failed" || e.status === "dead_letter").slice(0, 6).map(e => ({ type: e.event_type, subject: e.subject_type, when: e.occurred_at ?? e.created_at, status: e.status }));

  return {
    provisioned: true as const,
    kpis: { processedToday, successRate, pending, failedTotal, totalWindow, activeEventTypes },
    totalAll, statusTotal,
    stream, flows, statusDonut, workspaces, liveWorkspaces, alerts,
    coreEvents: CORE_EVENTS,
    empty: totalAll === 0,
  };
}
