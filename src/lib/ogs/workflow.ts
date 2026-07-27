// OGS-007 Notifications, Communications & Workflow Engine. Grounds the surface in the real platform
// backbone: notifications (029, the in-app message store — PRIMARY), notif_deliveries (056, the
// multi-channel delivery log), plat_approval_requests / plat_approval_decisions (057, the approval
// workflow engine) and change_requests (012, governance change workflows). These are platform-GLOBAL
// tables (no hospital_id) — the notification & approval engines run platform-wide, so every metric
// aggregates across all tenants (labelled). Escalations are DERIVED honestly from approval age (>14d).
// A visual workflow designer, configurable escalation rules / SLAs and office messaging / announcements
// are the next-phase OGS-007 engine.
/* eslint-disable @typescript-eslint/no-explicit-any */

const CHANNEL_LABEL: Record<string, string> = { in_app: "In-app", email: "Email", sms: "SMS", webhook: "Webhook", teams: "Teams", slack: "Slack" };
const WF_TONES = ["teal", "blue", "indigo", "violet", "amber", "rose", "emerald", "slate"];

export async function loadOgsWorkflow(admin: any, hid: string | null, isSuper: boolean) {
  // notifications / notif_deliveries / plat_approval_* / change_requests have no hospital_id — the
  // notification & approval engines are platform-global, so metrics aggregate across all tenants. The
  // caller's tenant scope is surfaced honestly so a hospital-scoped viewer knows these span the backbone.
  const scopeNote = isSuper && !hid ? "platform-wide · all tenants" : "platform backbone · all tenants";

  // PRIMARY read + provisioning probe — head count on notifications.
  const probe = await admin.from("notifications").select("id", { count: "exact", head: true });
  if (probe.error) return { provisioned: false as const };

  const now = Date.now();
  const since = new Date(now - 30 * 86400000).toISOString();   // recent 30-day window
  const ageDays = (iso: any) => (iso ? Math.floor((now - Date.parse(iso)) / 86400000) : 0);

  // ── notifications (recent window) ───────────────────────────────────────────
  const { data: notifRows } = await admin.from("notifications").select("type, title, read, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
  const notifs = (notifRows ?? []) as any[];
  const total = notifs.length;
  const unread = notifs.filter(n => !n.read).length;
  const notifList = notifs.slice(0, 9).map(n => ({ title: n.title ?? "—", type: n.type ?? "—", when: n.created_at, read: !!n.read }));

  // ── notif_deliveries (recent window, multi-channel) ─────────────────────────
  let deliveries: any[] = [];
  try { const { data } = await admin.from("notif_deliveries").select("channel, status, created_at").gte("created_at", since).limit(20000); deliveries = (data ?? []) as any[]; } catch { /* optional */ }
  const dBy = (s: string) => deliveries.filter(d => d.status === s).length;
  const sent = dBy("sent"), queued = dBy("queued"), failed = dBy("failed"), skipped = dBy("skipped");
  const deliverySuccess = (sent + failed) ? Math.round((sent / (sent + failed)) * 100) : null;

  const chMap = new Map<string, number>();
  deliveries.forEach(d => chMap.set(d.channel, (chMap.get(d.channel) ?? 0) + 1));
  const chEntries = [...chMap.entries()].sort((a, b) => b[1] - a[1]);
  const maxCh = chEntries.length ? chEntries[0][1] : 1;   // sorted desc ⇒ first is the max
  const channelBars = chEntries.map(([ch, n]) => ({ label: CHANNEL_LABEL[ch] ?? ch, pct: Math.round((n / maxCh) * 100), value: n, tone: "blue" }));
  const statusDonut = [
    { label: "Sent", value: sent, tone: "emerald" },
    { label: "Queued", value: queued, tone: "amber" },
    { label: "Failed", value: failed, tone: "rose" },
    { label: "Skipped", value: skipped, tone: "slate" },
  ].filter(s => s.value > 0);

  // ── plat_approval_requests (approval workflow engine — all-time; pending needs full history) ─
  let approvals: any[] = [];
  try { const { data } = await admin.from("plat_approval_requests").select("workflow_key, entity_name, status, current_step, total_steps, requested_by_name, created_at, decided_at").order("created_at", { ascending: false }).limit(5000); approvals = (data ?? []) as any[]; } catch { /* optional */ }
  const pending = approvals.filter(a => a.status === "pending");
  const pendingApprovals = pending.length;
  const overdue = pending.filter(a => ageDays(a.created_at) > 14);
  const overdueCount = overdue.length;

  // Workflow overview — requests grouped by workflow_key (type), '_' → space.
  const wfMap = new Map<string, number>();
  approvals.forEach(a => { const key = a.workflow_key ?? "unknown"; wfMap.set(key, (wfMap.get(key) ?? 0) + 1); });
  const workflowDonut = [...wfMap.entries()].sort((a, b) => b[1] - a[1]).map(([key, v], i) => ({ label: key.replace(/_/g, " "), value: v, tone: WF_TONES[i % WF_TONES.length] }));

  // Pending approvals table (oldest first — closest to / past SLA).
  const pendingRows = [...pending].sort((a, b) => ageDays(b.created_at) - ageDays(a.created_at)).slice(0, 12).map(a => ({
    entity: a.entity_name ?? "—",
    workflow: (a.workflow_key ?? "—").replace(/_/g, " "),
    step: `${Number(a.current_step ?? 0)}/${Number(a.total_steps ?? 1)}`,
    requestedBy: a.requested_by_name ?? "—",
    age: ageDays(a.created_at),
    overdue: ageDays(a.created_at) > 14,
  }));

  // Escalations — pending older than 14 days (DERIVED from approval age).
  const escalations = [...overdue].sort((a, b) => ageDays(b.created_at) - ageDays(a.created_at)).slice(0, 8).map(a => ({
    entity: a.entity_name ?? "—",
    workflow: (a.workflow_key ?? "—").replace(/_/g, " "),
    requestedBy: a.requested_by_name ?? "—",
    age: ageDays(a.created_at),
  }));

  // Workflow performance (DERIVED SLA buckets from real request → decision timestamps, 14-day threshold).
  const cycleDays = (a: any) => ((a.created_at && a.decided_at) ? Math.floor((Date.parse(a.decided_at) - Date.parse(a.created_at)) / 86400000) : null);
  const decided = approvals.filter(a => a.decided_at);
  const onTime = decided.filter(a => { const c = cycleDays(a); return c != null && c <= 14; }).length;
  const pendingInSla = pending.filter(a => ageDays(a.created_at) <= 14).length;
  const denom = Math.max(1, approvals.length);
  const slaBars = [
    { label: "On-time decisions (≤14d)", pct: Math.round((onTime / denom) * 100), value: onTime, tone: "emerald" },
    { label: "Pending in SLA (≤14d)", pct: Math.round((pendingInSla / denom) * 100), value: pendingInSla, tone: "amber" },
    { label: "Overdue (>14d)", pct: Math.round((overdueCount / denom) * 100), value: overdueCount, tone: "rose" },
  ];

  // ── change_requests (governance change workflows — global register) ─────────
  let openChanges = 0;
  try { const { data } = await admin.from("change_requests").select("status").limit(5000); openChanges = ((data ?? []) as any[]).filter(c => c.status === "open").length; } catch { /* optional */ }

  const inFlight = openChanges + pendingApprovals;

  return {
    provisioned: true as const,
    scopeNote,
    empty: total === 0 && approvals.length === 0 && deliveries.length === 0,
    kpis: { unread, total, pendingApprovals, inFlight, overdue: overdueCount, deliverySuccess },
    notifList, workflowDonut, pendingRows, channelBars, statusDonut, escalations, slaBars,
  };
}
