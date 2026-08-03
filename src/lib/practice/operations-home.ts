import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
import { followUpBoard } from "@/lib/practice/follow-ups";

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
  | "queue_waiting" | "document_unissued" | "followup_due_soon" | "consent_not_recorded";

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
  "encounter_unsigned",
  "encounter_live",
  "queue_waiting",
  "clinic_remaining",
  "followup_due_soon",
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
  ]);

  // Patient names in one query for every list that needs them, rather than one per row.
  const encRows = ((encounters as any).data ?? []) as any[];
  const docRows = ((documents as any).data ?? []) as any[];
  const procRows = ((procedureConsent as any).data ?? []) as any[];
  const patientIds = [...new Set([
    ...encRows.map(e => e.patient_id), ...docRows.map(d => d.patient_id), ...procRows.map(p => p.patient_id),
  ].filter(Boolean))];
  const { data: patients } = patientIds.length
    ? await admin.from("practice_patient").select("id, display_name").in("id", patientIds)
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
        id: p.id, label: p.label, note: `${nameOf(p.patient_id)} — ${String(p.performed_at).slice(0, 10)}`,
      })),
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

  const [{ count: locations }, { count: members }, { data: entitlement }] = practice as any;
  const trialDaysLeft = entitlement?.ends_at
    ? Math.max(0, Math.ceil((Date.parse(entitlement.ends_at) - now) / 86400000))
    : null;

  return {
    today, timezone,
    attention,
    blindSpots,
    /** Nothing owed AND nothing hidden. The two together are what makes "you are clear" honest. */
    allClear: attention.length === 0 && blindSpots.length === 0,
    appointments: apptRows,
    practice: {
      locations: locations ?? 0, members: members ?? 0,
      plan: entitlement?.plan_code ?? null, entitlementStatus: entitlement?.status ?? null,
      trialDaysLeft, workspaceStatus: ctx.workspaceStatus,
    },
    recentActivity: ((events as any).data ?? []) as any[],
  };
}
