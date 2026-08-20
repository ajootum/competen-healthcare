import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { workspaceClock, zonedDayRange, practiceDayOf } from "@/lib/practice/practice-time";
import { followUpBoard } from "@/lib/practice/follow-ups";
import { taskBoard, listNotifications } from "@/lib/practice/tasks";
import { unreviewedIncoming, unreadThreadCount } from "@/lib/practice/communication";

// CPR-300 OPERATIONS HOME. The daily command centre the v1.0 set puts at the middle of the workspace,
// and the module that supersedes CPR-V2-001's "Practice Command Centre" as the definition of /practice/home.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS PAGE SHOWS WORK, NOT NUMBERS.
//
// Every comp for a screen like this is a wall of large figures -- 2,348 encounters, 86.4 hours saved,
// 99.95% uptime. CPR-BUILD-001 s4 records that every one of those is invented, and they would stay
// invented if we replaced them with real counts, because a large real number is still not something a
// practitioner can act on at 8am.
//
// So the rule here is stricter than "render real data only": EVERY FIGURE ON THIS PAGE IS THE LENGTH OF
// A LIST YOU CAN OPEN. A count with nothing behind it is a dashboard; a count you can click into is a
// worklist. If a number cannot be given a link, it does not belong on this page.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ORDERED BY WHAT IT COSTS TO IGNORE, not by recency and not by module. A person overdue for a review
// outranks an unsigned note, which outranks a draft letter. The order is stated here once, as data, so
// the page cannot quietly re-sort itself into whatever order the queries happened to return.
//
// A ZERO IS EARNED, AND IS NOT THE SAME AS A BLANK. If the caller lacks followup.view, the follow-up
// block is ABSENT, not zero -- "nothing is overdue" and "you cannot see what is overdue" are different
// statements and a home page that conflates them tells a locum their day is clear when it is not.
//
// NO MIGRATION. Everything here already exists somewhere, which is the point: an operations home that
// needed its own tables would be an operations home that was inventing something.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AttentionKind =
  | "followup_overdue" | "encounter_unsigned" | "encounter_live" | "clinic_remaining"
  | "queue_waiting" | "document_unissued" | "followup_due_soon" | "consent_not_recorded"
  | "notification_unread" | "task_overdue" | "task_due" | "task_orphaned"
  | "incoming_unreviewed" | "message_unread";

export type AttentionItem = {
  kind: AttentionKind;
  severity: "critical" | "warning" | "normal";
  count: number;
  title: string;
  /** What the count MEANS, in the words the practitioner would use. Never a target or a benchmark. */
  detail: string;
  href: string;
  /** A few real rows, so the tile is a worklist rather than a figure. */
  sample: { id: string; label: string; note?: string; href?: string }[];
};

/**
 * The order. First entry is the loudest.
 *
 * The reasoning, once, so nobody re-sorts it on aesthetics: a person waiting on a review the practice
 * committed to is the only item here where the cost of ignoring it falls on somebody outside the room.
 * An unsigned encounter is next because it is not yet a record. Live encounters and today's remaining
 * clinic are the work in front of you, which you already know about. Documents and consent gaps are
 * housekeeping.
 */
const ORDER: AttentionKind[] = [
  "followup_overdue",
  // The unreviewed lab result sits with the overdue follow-up, above everything else: both are harms
  // to somebody outside the room, and the result is the one the practice may not even know it owes.
  "incoming_unreviewed",
  "encounter_unsigned",
  "encounter_live",
  "queue_waiting",
  "task_orphaned",
  "task_overdue",
  "clinic_remaining",
  "notification_unread",
  "message_unread",
  "followup_due_soon",
  "task_due",
  "document_unissued",
  "consent_not_recorded",
];

const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / 86400000);

export async function operationsHome(admin: any, ctx: WorkspaceContext) {
  const { timezone, today } = await workspaceClock(admin, ctx.workspaceId);
  const { startIso, endIso } = zonedDayRange(today, timezone);
  const now = Date.now();

  const can = (c: string) => hasCapability(ctx, c);

  // Loaded in parallel and only where the caller may see it. A block the caller cannot see is absent
  // from `attention` entirely, and `blindSpots` says so by name.
  const [
    appointments, queueCount, encounters, followUps, documents, procedureConsent, practice, events,
    tasks, notifications, incoming, unreadThreads,
  ] = await Promise.all([
    can("practice.calendar.view")
      ? admin.from("practice_appointment")
        .select("id, patient_id, patient_name, scheduled_at, appointment_type, status")
        .eq("workspace_id", ctx.workspaceId).gte("scheduled_at", startIso).lt("scheduled_at", endIso)
        .order("scheduled_at")
      : Promise.resolve({ data: null }),
    can("practice.calendar.view")
      ? admin.from("practice_queue_entry").select("id, patient_name, status, entered_at")
        .eq("workspace_id", ctx.workspaceId).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"])
      : Promise.resolve({ data: null }),
    can("encounter.list")
      ? admin.from("practice_encounter")
        .select("id, patient_id, status, reason_for_visit, started_at, completed_at")
        .eq("workspace_id", ctx.workspaceId).in("status", ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"])
        .order("started_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: null }),
    can("followup.view") ? followUpBoard(admin, ctx.workspaceId) : Promise.resolve(null),
    can("document.view")
      ? admin.from("practice_clinical_document")
        .select("id, patient_id, title, status, created_at")
        .eq("workspace_id", ctx.workspaceId).in("status", ["DRAFT", "FINAL"])
        .order("created_at", { ascending: false }).limit(25)
      : Promise.resolve({ data: null }),
    can("encounter.list")
      ? admin.from("practice_procedure")
        .select("id, patient_id, label, performed_at")
        .eq("workspace_id", ctx.workspaceId).eq("consent_status", "not_recorded")
        .order("performed_at", { ascending: false }).limit(25)
      : Promise.resolve({ data: null }),
    Promise.all([
      admin.from("practice_location").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("active", true),
      admin.from("practice_membership").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("status", "active"),
      admin.from("practice_entitlement").select("plan_code, status, ends_at").eq("workspace_id", ctx.workspaceId).in("status", ["active", "trial"]).limit(1).maybeSingle(),
    ]),
    admin.from("practice_audit_event").select("event_type, occurred_at")
      .eq("workspace_id", ctx.workspaceId).order("occurred_at", { ascending: false }).limit(8),
    can("task.view") ? taskBoard(admin, ctx.workspaceId, ctx.userId) : Promise.resolve(null),
    // NO CAPABILITY GATE. These are the caller's own rows -- see the notifications route for why.
    listNotifications(admin, ctx.workspaceId, ctx.userId, { limit: 20 }),
    can("inbox.record") ? unreviewedIncoming(admin, ctx.workspaceId) : Promise.resolve(null),
    can("message.use") ? unreadThreadCount(admin, ctx.workspaceId, ctx.userId) : Promise.resolve(null),
  ]);

  // Patient names in one query for every list that needs them, rather than one per row.
  const encRows = ((encounters as any).data ?? []) as any[];
  const docRows = ((documents as any).data ?? []) as any[];
  const procRows = ((procedureConsent as any).data ?? []) as any[];
  const patientIds = [...new Set([
    ...encRows.map(e => e.patient_id), ...docRows.map(d => d.patient_id), ...procRows.map(p => p.patient_id),
  ].filter(Boolean))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name").eq("workspace_id", ctx.workspaceId).in("id", patientIds)
    : { data: [] };
  const nameOf = (id: string) => (((patients ?? []) as any[]).find(p => p.id === id)?.display_name) ?? "Unknown patient";

  const items: Partial<Record<AttentionKind, AttentionItem>> = {};

  if (followUps) {
    if (followUps.overdue.length > 0) {
      items.followup_overdue = {
        kind: "followup_overdue", severity: "critical", count: followUps.overdue.length,
        title: "Overdue follow-ups",
        detail: "Past their due date with nothing booked. Somebody outside this room is waiting on each of these.",
        href: "/practice/follow-ups",
        sample: followUps.overdue.slice(0, 5).map((f: any) => ({
          id: f.id, label: f.patient_name ?? "Unknown patient",
          note: `${Math.abs(f.dueInDays)}d overdue — ${f.reason}`,
          href: `/practice/patients/${f.patient_id}`,
        })),
      };
    }
    if (followUps.dueSoon.length > 0) {
      items.followup_due_soon = {
        kind: "followup_due_soon", severity: "normal", count: followUps.dueSoon.length,
        title: "Follow-ups due soon",
        detail: `Due within ${followUps.horizonDays} days and not yet booked.`,
        href: "/practice/follow-ups",
        sample: followUps.dueSoon.slice(0, 4).map((f: any) => ({
          id: f.id, label: f.patient_name ?? "Unknown patient",
          note: `due ${f.due_on} — ${f.reason}`, href: `/practice/patients/${f.patient_id}`,
        })),
      };
    }
  }

  // UNSIGNED IS SEPARATED FROM LIVE, deliberately. A consultation still in progress is work you are
  // doing; a completed one that was never signed is work you think you finished and did not -- and
  // "how long has it been sitting" is the fact that makes the difference visible.
  const unsigned = encRows.filter(e => e.status === "COMPLETED");
  if (unsigned.length > 0) {
    const stale = unsigned.filter(e => daysSince(e.completed_at ?? e.started_at, now) >= 1).length;
    items.encounter_unsigned = {
      kind: "encounter_unsigned", severity: stale > 0 ? "critical" : "warning", count: unsigned.length,
      title: "Encounters awaiting your signature",
      detail: stale > 0
        ? `${stale} of these have been unsigned for a day or more. Until it is signed it is a draft, not a record.`
        : "Completed but not signed. Until it is signed it is a draft, not a record.",
      href: "/practice/encounters",
      sample: unsigned.slice(0, 5).map(e => ({
        id: e.id, label: nameOf(e.patient_id),
        note: `${daysSince(e.completed_at ?? e.started_at, now)}d — ${e.reason_for_visit ?? "no reason recorded"}`,
        href: `/practice/encounters/${e.id}`,
      })),
    };
  }

  const live = encRows.filter(e => e.status !== "COMPLETED");
  if (live.length > 0) {
    items.encounter_live = {
      kind: "encounter_live", severity: "warning", count: live.length,
      title: "Consultations in progress",
      detail: "Open encounters. Resuming one picks up exactly where it was left.",
      href: "/practice/encounters",
      sample: live.slice(0, 5).map(e => ({
        id: e.id, label: nameOf(e.patient_id),
        note: `${e.status.toLowerCase()} — ${e.reason_for_visit ?? "no reason recorded"}`,
        href: `/practice/encounters/${e.id}`,
      })),
    };
  }

  const queueRows = ((queueCount as any).data ?? []) as any[];
  if (queueRows.length > 0) {
    items.queue_waiting = {
      kind: "queue_waiting", severity: "warning", count: queueRows.length,
      title: "In the waiting room",
      detail: "Checked in and not yet finished.",
      href: "/practice/calendar",
      sample: queueRows.slice(0, 5).map(q => ({
        id: q.id, label: q.patient_name ?? "Unknown patient", note: q.status.toLowerCase().replace(/_/g, " "),
      })),
    };
  }

  const apptRows = ((appointments as any).data ?? []) as any[];
  // "Remaining" is the ones not yet finished, not the whole day: a home page that still says "8 today"
  // at 5pm is describing the morning.
  const remaining = apptRows.filter(a => ["REQUESTED", "CONFIRMED"].includes(a.status));
  if (apptRows.length > 0) {
    items.clinic_remaining = {
      kind: "clinic_remaining", severity: "normal", count: remaining.length,
      title: "Still to come today",
      detail: remaining.length === 0
        ? `All ${apptRows.length} of today's appointments have been seen, cancelled or marked away.`
        : `Booked and not yet arrived, of ${apptRows.length} today.`,
      href: "/practice/calendar",
      sample: remaining.slice(0, 5).map(a => ({
        id: a.id, label: a.patient_name,
        note: `${new Date(a.scheduled_at).toISOString().slice(11, 16)} — ${String(a.appointment_type).replace(/_/g, " ")}`,
      })),
    };
  }

  if (docRows.length > 0) {
    items.document_unissued = {
      kind: "document_unissued", severity: "normal", count: docRows.length,
      title: "Documents not yet issued",
      detail: "Drafted or marked ready, but unsigned. Nobody has received these.",
      href: "/practice/documents",
      sample: docRows.slice(0, 4).map(d => ({
        id: d.id, label: d.title, note: `${nameOf(d.patient_id)} — ${d.status.toLowerCase()}`,
        href: `/practice/documents/${d.id}`,
      })),
    };
  }

  if (procRows.length > 0) {
    items.consent_not_recorded = {
      kind: "consent_not_recorded", severity: "normal", count: procRows.length,
      title: "Procedures with no consent recorded",
      detail: "A gap in the record, not an allegation about the consultation. Where consent was required the engine already refused; these are the ones where it was not.",
      href: "/practice/encounters",
      sample: procRows.slice(0, 4).map(p => ({
        // The date a practitioner reads beside a name, so it is the day THEY performed it. The workspace
        // clock is already resolved at the top of this function, for exactly this class of reason.
        id: p.id, label: p.label,
        note: `${nameOf(p.patient_id)} — ${practiceDayOf(timezone, p.performed_at) ?? "date not recorded"}`,
      })),
    };
  }

  // CPR-340. Tasks are the caller's OWN, not the practice's: an operations home that showed everybody's
  // work would be a management report, and the person opening it is trying to start their own day.
  // Orphaned tasks are the exception and rank higher than anything else operational, because work
  // assigned to somebody who can no longer sign in is work that nobody is doing and nobody can see.
  if (tasks) {
    const board = tasks as any;
    if (board.orphaned.length > 0) {
      items.task_orphaned = {
        kind: "task_orphaned", severity: "critical", count: board.orphaned.length,
        title: "Tasks nobody can see",
        detail: "Assigned to a person whose access has since been removed. Nobody is doing these and nobody has been told.",
        href: "/practice/tasks",
        sample: board.orphaned.slice(0, 4).map((t: any) => ({ id: t.id, label: t.title, note: t.due_on ? `due ${t.due_on}` : "no date" })),
      };
    }
    if (board.mineOverdue.length > 0) {
      items.task_overdue = {
        kind: "task_overdue", severity: "warning", count: board.mineOverdue.length,
        title: "Your overdue tasks",
        detail: "Assigned to you and past their date.",
        href: "/practice/tasks",
        sample: board.mineOverdue.slice(0, 4).map((t: any) => ({
          id: t.id, label: t.title, note: `${Math.abs(t.dueInDays)}d overdue`,
        })),
      };
    }
    // Only the ones whose reminder date has arrived. A task due in three weeks is not today's business,
    // and a home page that lists it anyway teaches people to skim the page.
    const dueNow = board.mineDue.filter((t: any) => t.reminderDue || (t.dueInDays !== null && t.dueInDays <= 7));
    if (dueNow.length > 0) {
      items.task_due = {
        kind: "task_due", severity: "normal", count: dueNow.length,
        title: "Your tasks coming up",
        detail: "Due within a week, or their reminder date has arrived.",
        href: "/practice/tasks",
        sample: dueNow.slice(0, 4).map((t: any) => ({
          id: t.id, label: t.title, note: t.due_on ? `due ${t.due_on}` : "reminder due",
        })),
      };
    }
  }

  // CPR-320. The unreviewed incoming result is the missed-result harm, and it escalates on urgency:
  // an assistant marked something urgent at the desk, and nobody with the clinical capability has
  // looked at it yet.
  if (incoming !== null && (incoming as any).rows.length > 0) {
    const inc = incoming as any;
    items.incoming_unreviewed = {
      kind: "incoming_unreviewed", severity: inc.anyUrgent ? "critical" : "warning", count: inc.rows.length,
      title: "Received documents awaiting review",
      detail: inc.anyUrgent
        ? "Results and letters nobody has reviewed — at least one was flagged urgent at the desk."
        : "Results and letters that arrived and have not been reviewed. A result nobody looks at is the classic harm by omission.",
      href: "/practice/inbox",
      sample: inc.rows.slice(0, 5).map((d: any) => ({
        id: d.id, label: d.title,
        note: [d.patient_name, d.source, d.priority === "urgent" ? "URGENT" : null].filter(Boolean).join(" · "),
      })),
    };
  }

  if (typeof unreadThreads === "number" && unreadThreads > 0) {
    items.message_unread = {
      kind: "message_unread", severity: "normal", count: unreadThreads,
      title: "Conversations with something new",
      detail: "Threads where a colleague said something you have not seen. In-practice only.",
      href: "/practice/messages",
      sample: [{ id: "threads", label: "Open messages", href: "/practice/messages" }],
    };
  }

  const unread = (notifications ?? []) as any[];
  if (unread.length > 0) {
    items.notification_unread = {
      kind: "notification_unread", severity: "normal", count: unread.length,
      title: "New for you",
      detail: "Things that happened while you were away and cannot be worked out from the record. In-app only; nothing was sent anywhere.",
      href: "/practice/tasks",
      sample: unread.slice(0, 4).map(n => ({ id: n.id, label: n.title, note: n.label, href: n.href })),
    };
  }

  const attention = ORDER.map(k => items[k]).filter(Boolean) as AttentionItem[];

  // NAMED, NOT SILENT. A block the caller cannot see is reported as a blind spot rather than simply
  // missing, so an empty-looking home page can say WHY it is empty.
  const blindSpots: string[] = [];
  if (!can("followup.view")) blindSpots.push("follow-ups");
  if (!can("encounter.list")) blindSpots.push("encounters and procedures");
  if (!can("document.view")) blindSpots.push("documents");
  if (!can("practice.calendar.view")) blindSpots.push("the diary and waiting room");
  if (!can("task.view")) blindSpots.push("tasks");
  if (!can("inbox.record")) blindSpots.push("the incoming-document register");
  if (!can("message.use")) blindSpots.push("messages");

  const [{ count: locations }, { count: members }, { data: entitlement }] = practice as any;
  const trialDaysLeft = entitlement?.ends_at
    ? Math.max(0, Math.ceil((Date.parse(entitlement.ends_at) - now) / 86400000))
    : null;

  // ── THE COMP'S KPI STRIP (CPR-300) ──────────────────────────────────────────────────────────────────
  //
  // Six tiles, in the comp's order. Each carries a SUB-DETAIL rather than a trend: the design shows
  // "↑25% vs yesterday" under two of them, and nothing in this product has recorded a baseline to
  // compare against, so those read as "18 completed · 10 remaining" instead -- the same shape of
  // information, from data that exists.
  //
  // PROCEDURES PLANNED comes from practice_treatment, not practice_procedure, and that is the
  // intention-versus-act split CPR-150 was built on: a treatment row of type `procedure` is a plan, a
  // procedure row is a thing that happened. The tile can therefore say "4 done, 2 to go" honestly.
  const doneAppts = apptRows.filter(a => ["ARRIVED", "COMPLETED"].includes(a.status)).length;
  const liveTasks = tasks ? [...(tasks as any).mineOverdue, ...(tasks as any).mineDue, ...(tasks as any).mineLater] : [];
  const tasksDueToday = liveTasks.filter((t: any) => t.due_on === today || t.overdue).length;

  const [{ count: newPatients }, { data: plannedToday }, { data: doneToday }] = await Promise.all([
    can("patient.list")
      ? admin.from("practice_patient").select("*", { count: "exact", head: true })
        .eq("workspace_id", ctx.workspaceId).gte("created_at", startIso).lt("created_at", endIso)
      : Promise.resolve({ count: null }),
    can("encounter.list")
      ? admin.from("practice_treatment").select("id").eq("workspace_id", ctx.workspaceId)
        .eq("treatment_type", "procedure").gte("created_at", startIso).lt("created_at", endIso)
      : Promise.resolve({ data: null }),
    can("encounter.list")
      ? admin.from("practice_procedure").select("id").eq("workspace_id", ctx.workspaceId)
        .gte("performed_at", startIso).lt("performed_at", endIso)
      : Promise.resolve({ data: null }),
  ]);

  const planned = ((plannedToday as any)?.data ?? plannedToday ?? []) as any[];
  const performed = ((doneToday as any)?.data ?? doneToday ?? []) as any[];

  type Kpi = { key: string; label: string; value: number | null; detail: string; href: string; available: boolean };
  const kpis: Kpi[] = [
    {
      key: "appointments", label: "Today's appointments", value: can("practice.calendar.view") ? apptRows.length : null,
      detail: `${doneAppts} seen · ${remaining.length} to come`, href: "/practice/calendar",
      available: can("practice.calendar.view"),
    },
    {
      key: "new_patients", label: "New patients", value: newPatients ?? null,
      detail: "registered today", href: "/practice/patients", available: can("patient.list"),
    },
    {
      key: "procedures", label: "Procedures", value: can("encounter.list") ? planned.length : null,
      detail: `${performed.length} performed · ${Math.max(0, planned.length - performed.length)} planned`,
      href: "/practice/encounters", available: can("encounter.list"),
    },
    {
      key: "followups", label: "Follow-ups due", value: followUps ? (followUps.overdue.length + followUps.dueSoon.length) : null,
      detail: followUps ? `${followUps.overdue.length} overdue` : "", href: "/practice/follow-ups",
      available: !!followUps,
    },
    {
      key: "messages", label: "Unread messages", value: typeof unreadThreads === "number" ? unreadThreads : null,
      detail: "conversations with something new", href: "/practice/messages",
      available: typeof unreadThreads === "number",
    },
    {
      key: "tasks", label: "Tasks due today", value: tasks ? tasksDueToday : null,
      detail: tasks ? `${(tasks as any).mineOverdue.length} overdue` : "", href: "/practice/tasks",
      available: !!tasks,
    },
  ];

  // ── PRACTICE HEALTH (CPR-300) ───────────────────────────────────────────────────────────────────────
  //
  // THE TILES THIS PRODUCT CANNOT FILL RENDER IN THEIR DESIGNED POSITION AND SAY WHY. The comp asks for
  // patient satisfaction, revenue and a collection rate; there is no survey capability and no billing
  // module, so those would be invented figures. Omitting them silently was the earlier mistake -- a
  // reader cannot tell an absent tile from an unbuilt one. An empty state in the right place can.
  //
  // The ones that CAN be filled are counts with denominators, never rates (CPR-330's rule).
  const cancelledToday = apptRows.filter(a => a.status === "CANCELLED").length;
  const noShowToday = apptRows.filter(a => a.status === "NO_SHOW").length;

  const health = [
    {
      key: "cancellations", label: "Cancelled today", value: `${cancelledToday}`, of: apptRows.length,
      available: can("practice.calendar.view"), reason: null as string | null,
    },
    {
      key: "no_shows", label: "Did not attend", value: `${noShowToday}`, of: apptRows.length,
      available: can("practice.calendar.view"), reason: null,
    },
    {
      key: "overdue_followups", label: "Overdue follow-ups", value: followUps ? `${followUps.overdue.length}` : "",
      of: followUps ? followUps.overdue.length + followUps.dueSoon.length + followUps.scheduled.length + followUps.later.length : null,
      available: !!followUps, reason: null,
    },
    {
      key: "satisfaction", label: "Patient satisfaction", value: null, of: null,
      available: false, reason: "No survey capability is built, so there is nothing to measure this from.",
    },
    {
      key: "revenue", label: "Revenue", value: null, of: null,
      available: false, reason: "Billing exists now (CPR-PAY-001) but this platform-side tile is not wired to it; the practice reads its own figures in Payments.",
    },
    {
      key: "collection", label: "Collection", value: null, of: null,
      available: false, reason: "Billing exists now (CPR-PAY-001) but this platform-side tile is not wired to it; the practice reads its own figures in Payments.",
    },
  ];

  // ── QUICK ACTIONS (CPR-300) ─────────────────────────────────────────────────────────────────────────
  //
  // Nine in the comp; eight here. The ninth is "AI Assistant", which would open a capability CPR-210 has
  // not built -- a button that leads nowhere is the thing the navigation catalogue has refused since
  // Phase 0, and it does not become acceptable because a comp draws it.
  const quickActions = [
    { key: "appointment", label: "New appointment", href: "/practice/calendar", capability: "appointment.manage" },
    { key: "patient", label: "Add patient", href: "/practice/patients", capability: "patient.create" },
    { key: "encounter", label: "Clinical note", href: "/practice/encounters", capability: "encounter.create" },
    { key: "procedure", label: "New procedure", href: "/practice/encounters", capability: "procedure.record" },
    { key: "document", label: "Letter or report", href: "/practice/documents", capability: "document.author" },
    { key: "message", label: "Send message", href: "/practice/messages", capability: "message.use" },
    { key: "incoming", label: "Record a document", href: "/practice/inbox", capability: "inbox.record" },
    { key: "task", label: "Create task", href: "/practice/tasks", capability: "task.manage" },
  ].filter(a => can(a.capability));

  // The location switcher the comp puts in the header. Real since CPR-360 made locations creatable.
  const { data: locationRows } = await admin.from("practice_location")
    .select("id, name, active").eq("workspace_id", ctx.workspaceId).eq("active", true).order("name");

  // ⚠ THIS FILE DID NOT CONTAIN THE WORD "error" ANYWHERE. Every one of the reads above destructured
  // `{ data }` and dropped the rest, so a failed query became an empty list, an empty list became no
  // attention items, and the brief said "Nothing is waiting on you." A database hiccup rendered as calm.
  //
  // Named rather than counted: a screen can say WHICH part it could not read, which is the difference
  // between a warning somebody can act on and a shrug.
  const READS: [string, unknown][] = [
    ["the diary", appointments], ["the waiting room", queueCount], ["encounters", encounters],
    ["follow-ups", followUps], ["documents", documents], ["procedure consent", procedureConsent],
    ["the practice record", events], ["tasks", tasks], ["notifications", notifications],
    ["the incoming register", incoming], ["messages", unreadThreads],
  ];
  const unreadable = READS.filter(([, r]) => (r as { error?: unknown } | null)?.error).map(([n]) => n);

  return {
    today, timezone,
    attention,
    blindSpots,
    /**
     * The reads that FAILED, by name. Distinct from `blindSpots`, which are the domains the caller is not
     * permitted to see -- "you may not look" and "I could not look" are different sentences and only one
     * of them is about permissions.
     */
    unreadable,
    /** Nothing owed AND nothing hidden. The two together are what makes "you are clear" honest. */
    allClear: attention.length === 0 && blindSpots.length === 0 && unreadable.length === 0,
    appointments: apptRows,
    kpis,
    health,
    quickActions,
    locations: (locationRows ?? []) as any[],
    unreadNotifications: unread.length,
    practice: {
      locations: locations ?? 0, members: members ?? 0,
      plan: entitlement?.plan_code ?? null, entitlementStatus: entitlement?.status ?? null,
      trialDaysLeft, workspaceStatus: ctx.workspaceStatus,
    },
    recentActivity: ((events as any).data ?? []) as any[],
  };
}
