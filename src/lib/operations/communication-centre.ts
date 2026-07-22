// Communication Centre (SSW-COM-001) loader — operational messaging, broadcasts,
// escalation & handover communication, announcements and analytics. Composes the
// shift-command aggregate (shift, handover, counts, copilot) with the new
// messaging/broadcast stores (migration 072) and the existing escalation / safety
// / notification tables. Fail-soft: the messaging/broadcast surfaces report
// not-provisioned before 072 runs; everything else stays live.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadShiftCommand } from "@/lib/operations/shift-command";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export const CONTEXT_TYPES = ["team", "patient", "task", "direct", "general"];
export const BROADCAST_PRIORITIES = ["low", "medium", "high", "critical"];

export async function loadCommunicationCentre(admin: any, hid: string | null, isSuper: boolean, userId: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const now = Date.now(), nowIso = new Date().toISOString();

  const [sc, escRes, safetyRes, notifRes, unreadRes, msgRes, bcRes, staffCountRes] = await Promise.all([
    loadShiftCommand(admin, hid, isSuper),
    scope(admin.from("op_escalations").select("id, summary, severity, level, status, created_at, op_patients!patient_id(label), profiles!raised_by(full_name)")).neq("status", "cancelled").order("created_at", { ascending: false }).limit(20),
    scope(admin.from("op_safety_alerts").select("id, category, severity, note, created_at, op_patients!patient_id(label)")).eq("active", true).order("severity", { ascending: false }).limit(20),
    admin.from("notifications").select("title, body, href, created_at, read").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false),
    scope(admin.from("op_messages").select("id, channel, context_type, body, author_name, created_at, op_patients!patient_id(label)")).order("created_at", { ascending: false }).limit(300),
    scope(admin.from("op_broadcasts").select("id, title, body, priority, audience, target_count, emergency, expires_at, author_name, created_at")).order("created_at", { ascending: false }).limit(20),
    scope(admin.from("profiles").select("id", { count: "exact", head: true })),
  ]);

  const shift = (sc as any).ready ? (sc as any).shift : null;
  const o = (sc as any).ready ? (sc as any).overview : { escalations: 0, critical: 0, incidents: 0, handoverStatus: "pending", handoverPct: 0 };
  const staffCount = staffCountRes.error ? 0 : (staffCountRes.count ?? 0);

  // ── Messaging (op_messages) ─────────────────────────────────────────────────
  const messagesProvisioned = !(msgRes.error && missing(msgRes.error));
  const messages = (msgRes.error ? [] : msgRes.data ?? []) as any[];
  const channelMap = new Map<string, { channel: string; context: string; last: string; lastAt: string; n: number; patient: string | null }>();
  for (const m of messages) {
    const cur = channelMap.get(m.channel);
    if (!cur) channelMap.set(m.channel, { channel: m.channel, context: m.context_type, last: m.body, lastAt: m.created_at, n: 1, patient: m.op_patients?.label ?? null });
    else cur.n++;
  }
  const channels = [...channelMap.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 8);
  const messagesSent = messages.length;
  const byChannel: Record<string, number> = {};
  for (const m of messages) byChannel[m.context_type] = (byChannel[m.context_type] ?? 0) + 1;
  const channelDist = Object.entries(byChannel).map(([label, n]) => ({ label, n, pct: messagesSent ? Math.round((n / messagesSent) * 100) : 0 })).sort((a, b) => b.n - a.n);

  // ── Broadcasts (op_broadcasts + acks) ───────────────────────────────────────
  const broadcastsProvisioned = !(bcRes.error && missing(bcRes.error));
  const bcs = (bcRes.error ? [] : bcRes.data ?? []) as any[];
  const bcIds = bcs.map(b => b.id);
  const ackRes = bcIds.length ? await admin.from("op_broadcast_acks").select("broadcast_id, user_id").in("broadcast_id", bcIds) : { data: [], error: null };
  const acks = (ackRes.error ? [] : ackRes.data ?? []) as any[];
  const ackCount = (id: string) => acks.filter(a => a.broadcast_id === id).length;
  const userAcked = (id: string) => acks.some(a => a.broadcast_id === id && a.user_id === userId);
  const active = bcs.filter(b => !b.expires_at || b.expires_at > nowIso);
  const broadcasts = bcs.slice(0, 8).map(b => ({ id: b.id, title: b.title, priority: b.priority, audience: b.audience, target: b.target_count || staffCount, acked: ackCount(b.id), userAcked: userAcked(b.id), emergency: b.emergency, at: b.created_at }));
  const ackRates = broadcasts.map(b => (b.target ? b.acked / b.target : 0));
  const broadcastAckRate = ackRates.length ? Math.round((ackRates.reduce((a, b) => a + b, 0) / ackRates.length) * 100) : null;
  const awaitingAck = broadcasts.filter(b => !b.userAcked && (b.target ? b.acked < b.target : true));

  // ── Escalation communications ───────────────────────────────────────────────
  const esc = (escRes.error ? [] : escRes.data ?? []) as any[];
  const openEsc = esc.filter(e => ["open", "acknowledged"].includes(e.status));
  const escList = esc.slice(0, 6).map(e => ({ summary: e.summary || `Escalation L${e.level}`, patient: e.op_patients?.label ?? null, severity: e.severity, level: e.level, status: e.status, at: e.created_at, by: e.profiles?.full_name ?? null }));

  // ── Priority alerts (safety alerts + rapid escalations) ─────────────────────
  const alerts = (safetyRes.error ? [] : safetyRes.data ?? []) as any[];
  const SEV_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const priorityAlerts = [
    ...esc.filter(e => e.level >= 4).map(e => ({ title: `Rapid response — ${e.op_patients?.label ?? "patient"}`, sub: e.summary ?? "", tone: "high", at: e.created_at, action: "Action required" })),
    ...alerts.map(a => ({ title: `${(a.category ?? "alert").replace(/_/g, " ")} — ${a.op_patients?.label ?? "patient"}`, sub: a.note ?? "", tone: a.severity, at: a.created_at, action: a.severity === "high" ? "Action required" : "Investigate" })),
  ].sort((a, b) => (SEV_RANK[a.tone] ?? 3) - (SEV_RANK[b.tone] ?? 3)).slice(0, 4);

  // ── Notifications / announcements ───────────────────────────────────────────
  const notifs = (notifRes.error ? [] : notifRes.data ?? []) as any[];
  const unread = unreadRes.error ? 0 : (unreadRes.count ?? 0);

  // ── Shift handover ──────────────────────────────────────────────────────────
  const handover = {
    outgoing: shift?.supervisor ?? null, status: o.handoverStatus, pct: o.handoverPct,
    criticalPatients: o.critical, outstandingTasks: (sc as any).ready ? (sc as any).tasks.length : 0,
    openEscalations: o.escalations, followUp: null as number | null, // no follow-up store — honest
  };

  // ── KPI band ────────────────────────────────────────────────────────────────
  const kpis = {
    unreadMessages: unread, activeBroadcasts: active.length, openEscalations: openEsc.length,
    pendingHandoverItems: handover.outstandingTasks + handover.openEscalations,
    alertsRequiringAction: alerts.filter(a => ["high", "medium"].includes(a.severity)).length + esc.filter(e => e.level >= 4).length,
  };

  // ── Operations Hub tiles ────────────────────────────────────────────────────
  const hub = {
    criticalAlerts: alerts.filter(a => a.severity === "high").length + esc.filter(e => e.level >= 4).length,
    escalations: openEsc.length, broadcasts: active.length, handoverItems: kpis.pendingHandoverItems,
    awaitingAck: awaitingAck.length, aiSuggestions: 4,
  };

  // ── AI copilot recommendations (rule-based) ────────────────────────────────
  const aiRecs: { text: string; sub: string; action: string }[] = [];
  if (messagesSent > 0) aiRecs.push({ text: "Summarise shift communications", sub: `${messagesSent} messages across ${channels.length} conversations`, action: "Summarise" });
  if (o.critical > 0) aiRecs.push({ text: "Suggest broadcast", sub: `High patient load / ${o.critical} critical`, action: "Draft" });
  if (openEsc.length > 0) aiRecs.push({ text: "Escalation update", sub: `${openEsc.length} escalation(s) need follow-up`, action: "Review" });
  if (o.handoverStatus !== "accepted") aiRecs.push({ text: "Handover summary", sub: "Generate summary for incoming shift", action: "Generate" });

  return {
    ready: true as const,
    shift, kpis, hub, channels, messagesProvisioned, broadcasts, broadcastsProvisioned,
    escList, priorityAlerts, notifs, unread, handover, aiRecs,
    analytics: { avgResponseMin: null as number | null, broadcastAckRate, messagesSent, channelDist },
    picker: { staffCount },
    generatedAt: new Date().toISOString(),
  };
}
