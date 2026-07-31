// Notifications, Communications & Collaboration (UMW-TLS-004) — the Unit Manager's communication hub.
//
// Built almost entirely on stores that already existed. The one addition is migration 163's
// op_message_reads, because op_messages is a CHANNEL store with no recipient or read column — a gap that
// forced the global header's message badge onto `notifications` earlier today rather than inventing a count.
//
// PRIORITY IS NOT RE-DERIVED HERE. It is read from the notification row, where migration 161 made it a
// first-class property, and the behaviour that follows (does this need acknowledgement? when does it
// escalate?) comes from @/lib/notifications/framework. A second opinion about severity living in a unit
// dashboard is exactly the drift that framework exists to stop.
//
// Every section reports its row count, so an empty store reads as "nothing recorded" rather than as a quiet
// unit with nothing to say.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { escalationDue, isOutstanding, CATEGORIES, PRIORITY_ORDER, type Category } from "@/lib/notifications/framework";

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

export async function loadUnitCommunications(
  admin: any, hid: string | null, isSuper: boolean, userId: string,
  opts: { windowDays?: number; now?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? 30;
  const since = new Date(now - windowDays * DAY).toISOString();
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: null, error: true }));

  // notif_deliveries has NO hospital_id — it is keyed to a person, not a tenant. So unit delivery health has
  // to be resolved through the staff list, or the section would silently report platform-wide delivery on a
  // page labelled "this unit". Rows with no user_id are excluded rather than attributed to whoever is looking.
  const staffRes = isSuper ? { data: null } : await admin.from("profiles").select("id").eq("hospital_id", hid ?? NONE).limit(2000);
  const staffIds: string[] = ((staffRes as any)?.data ?? []).map((p: any) => p.id);

  const [notifRes, msgRes, readRes, castRes, ackRes, delivRes, escRes, taskRes, prefRes] = await Promise.all([
    // Notifications are per-USER, so the unit view is this manager's own inbox plus what it reveals about
    // unanswered alerts. There is no hospital-wide notification feed to aggregate — and pretending there
    // were would mean showing a manager other people's private notifications.
    soft(admin.from("notifications")
      .select("id, type, title, body, href, category, priority, state, read, requires_ack, escalate_after_min, acknowledged_at, created_at")
      .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(300)),
    soft(scope(admin.from("op_messages")
      .select("id, channel, context_type, body, author_id, author_name, patient_id, created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(500))),
    soft(admin.from("op_message_reads").select("message_id, user_id, read_at").limit(5000)),
    soft(scope(admin.from("op_broadcasts")
      .select("id, title, body, priority, audience, target_count, emergency, expires_at, author_name, created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(100))),
    soft(admin.from("op_broadcast_acks").select("broadcast_id, user_id, user_name, acked_at").limit(5000)),
    soft((isSuper
      ? admin.from("notif_deliveries").select("id, notification_id, user_id, channel, status, provider, created_at")
      : admin.from("notif_deliveries").select("id, notification_id, user_id, channel, status, provider, created_at")
          .in("user_id", staffIds.length ? staffIds : [NONE])
    ).gte("created_at", since).limit(2000)),
    soft(scope(admin.from("op_escalations")
      .select("id, summary, severity, level, status, escalation_type, created_at, resolved_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(200))),
    soft(scope(admin.from("op_tasks")
      .select("id, description, task_type, priority, status, assigned_to, due_at, created_at, completed_at")
      .gte("created_at", since).limit(500))),
    soft(admin.from("notification_preferences").select("user_id, in_app, email, sms, push, quiet_from, quiet_to, min_priority, muted_categories")
      .eq("user_id", userId).maybeSingle()),
  ]);

  const notifs = (notifRes.data ?? []) as any[];
  const messages = (msgRes.data ?? []) as any[];
  const reads = (readRes.data ?? []) as any[];
  const casts = (castRes.data ?? []) as any[];
  const acks = (ackRes.data ?? []) as any[];
  const deliveries = (delivRes.data ?? []) as any[];
  const escalations = (escRes.data ?? []) as any[];
  const tasks = (taskRes.data ?? []) as any[];

  // Migration 161 columns present? If not, priority/state are absent and this says so rather than
  // silently treating every notification as medium.
  const frameworkReady = notifs.length === 0 || notifs.some(n => n.priority != null);
  const readsReady = !readRes.error;

  // ── Notification centre ──
  const unread = notifs.filter(n => !n.read);
  const outstanding = notifs.filter(n => isOutstanding(n));
  const byPriority = PRIORITY_ORDER.map(p => ({ priority: p, n: notifs.filter(x => x.priority === p).length }));
  const byCategory = (Object.keys(CATEGORIES) as Category[]).map(c => ({
    category: c, label: CATEGORIES[c].label, icon: CATEGORIES[c].icon,
    n: notifs.filter(x => x.category === c).length,
    unread: notifs.filter(x => x.category === c && !x.read).length,
  })).filter(c => c.n > 0);

  // THE SPEC'S SHARPEST REQUIREMENT: "detect unanswered critical alerts". This is a real query rather than
  // a heuristic, because 161 stores requires_ack and escalate_after_min on the row itself.
  const unanswered = notifs
    .filter(n => n.requires_ack && isOutstanding(n))
    .map(n => ({ ...n, overdue: escalationDue(n, now), ageMin: Math.round((now - new Date(n.created_at).getTime()) / 60000) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.ageMin - a.ageMin);

  // ── Messaging + read receipts ──
  const readsByMsg = new Map<string, any[]>();
  for (const r of reads) {
    if (!readsByMsg.has(r.message_id)) readsByMsg.set(r.message_id, []);
    readsByMsg.get(r.message_id)!.push(r);
  }
  const myReads = new Set(reads.filter(r => r.user_id === userId).map(r => r.message_id));
  const channels = [...new Set(messages.map(m => m.channel))].map(ch => {
    const inCh = messages.filter(m => m.channel === ch);
    return {
      channel: ch as string,
      total: inCh.length,
      // Never counts the manager's OWN messages as unread — a person has read what they wrote.
      unread: inCh.filter(m => m.author_id !== userId && !myReads.has(m.id)).length,
      participants: new Set(inCh.map(m => m.author_id).filter(Boolean)).size,
      lastAt: inCh[0]?.created_at ?? null,
      contextType: inCh[0]?.context_type ?? "general",
    };
  }).sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));

  const recentMessages = messages.slice(0, 25).map(m => ({
    ...m,
    readBy: (readsByMsg.get(m.id) ?? []).length,
    readByMe: myReads.has(m.id) || m.author_id === userId,
  }));

  // ── Broadcasts + acknowledgement rate ──
  const acksByCast = new Map<string, any[]>();
  for (const a of acks) {
    if (!acksByCast.has(a.broadcast_id)) acksByCast.set(a.broadcast_id, []);
    acksByCast.get(a.broadcast_id)!.push(a);
  }
  const broadcasts = casts.map(c => {
    const got = (acksByCast.get(c.id) ?? []).length;
    return {
      ...c, acked: got,
      // A rate needs a denominator. Without target_count there is no rate — reported as null, not 0%.
      ackRate: c.target_count ? Math.round((got / c.target_count) * 100) : null,
      expired: !!c.expires_at && new Date(c.expires_at).getTime() < now,
      ackedByMe: (acksByCast.get(c.id) ?? []).some(a => a.user_id === userId),
    };
  });

  // ── Delivery health (which channels actually carried anything) ──
  const byChannel = [...new Set(deliveries.map(d => d.channel))].map(ch => {
    const rows = deliveries.filter(d => d.channel === ch);
    const sent = rows.filter(d => d.status === "sent").length;
    return {
      channel: ch as string, attempts: rows.length, sent,
      failed: rows.filter(d => d.status === "failed").length,
      skipped: rows.filter(d => d.status === "skipped").length,
      rate: rows.length ? Math.round((sent / rows.length) * 100) : null,
    };
  }).sort((a, b) => b.attempts - a.attempts);

  // ── Communication timeline: one merged, ordered stream ──
  const timeline = [
    ...notifs.slice(0, 40).map(n => ({ at: n.created_at, kind: "notification" as const, title: n.title, detail: n.body, tone: n.priority ?? "medium" })),
    ...messages.slice(0, 40).map(m => ({ at: m.created_at, kind: "message" as const, title: `${m.author_name ?? "Someone"} in ${m.channel}`, detail: m.body, tone: "low" })),
    ...casts.map(c => ({ at: c.created_at, kind: "broadcast" as const, title: c.title, detail: c.body, tone: c.emergency ? "critical" : c.priority ?? "medium" })),
    ...escalations.slice(0, 30).map(e => ({ at: e.created_at, kind: "escalation" as const, title: e.summary, detail: `Level ${e.level} - ${e.status}`, tone: e.severity ?? "high" })),
  ].filter(x => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);

  // ── Task acknowledgements ──
  const OPEN_TASK = ["created", "assigned", "accepted", "in_progress"];
  const taskAck = {
    recorded: tasks.length,
    pending: tasks.filter(t => OPEN_TASK.includes(t.status)).length,
    unassigned: tasks.filter(t => OPEN_TASK.includes(t.status) && !t.assigned_to).length,
    overdue: tasks.filter(t => OPEN_TASK.includes(t.status) && t.due_at && new Date(t.due_at).getTime() < now).length,
    completed: tasks.filter(t => ["completed", "verified"].includes(t.status)).length,
  };

  const openEsc = escalations.filter(e => !["resolved", "cancelled"].includes(e.status));

  const signals: { severity: "high" | "medium"; text: string }[] = [];
  const overdueAck = unanswered.filter(n => n.overdue);
  if (overdueAck.length) signals.push({ severity: "high", text: `${overdueAck.length} alert(s) requiring acknowledgement are past their escalation window.` });
  else if (unanswered.length) signals.push({ severity: "medium", text: `${unanswered.length} alert(s) awaiting your acknowledgement.` });
  const failedCh = byChannel.filter(c => c.rate != null && c.rate < 80 && c.attempts >= 3);
  for (const c of failedCh) signals.push({ severity: "medium", text: `${c.channel} delivery succeeded on only ${c.rate}% of ${c.attempts} attempts.` });
  if (taskAck.unassigned) signals.push({ severity: "medium", text: `${taskAck.unassigned} open task(s) have no assignee.` });
  const staleCast = broadcasts.filter(b => b.ackRate != null && b.ackRate < 60 && !b.expired);
  for (const b of staleCast) signals.push({ severity: "medium", text: `"${b.title}" has been acknowledged by only ${b.ackRate}% of its audience.` });

  return {
    frameworkReady, readsReady,
    window: { days: windowDays, from: since.slice(0, 10) },
    kpis: {
      unread: unread.length,
      outstanding: outstanding.length,
      unanswered: unanswered.length,
      unansweredOverdue: overdueAck.length,
      messages: messages.length,
      unreadMessages: readsReady ? channels.reduce((n, c) => n + c.unread, 0) : null,
      broadcasts: casts.length,
      openEscalations: openEsc.length,
    },
    notifications: { recorded: notifs.length, unread, byPriority, byCategory, unanswered },
    messaging: { recorded: messages.length, channels, recent: recentMessages },
    broadcasts: { recorded: casts.length, items: broadcasts },
    delivery: { recorded: deliveries.length, byChannel },
    escalations: { recorded: escalations.length, open: openEsc },
    taskAck, timeline, signals,
    preferences: (prefRes as any)?.data ?? null,
  };
}
