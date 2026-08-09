import { audit } from "@/lib/practice/audit";
import type { EngineResult } from "@/lib/practice/encounters";
import { type WorkspaceContext } from "@/lib/practice/access";
import { practiceToday, workspaceClock, zonedDayRange } from "@/lib/practice/practice-time";
import { ageFrom, MAJORITY_AGE } from "@/lib/practice/relationships";
import { resolveTemplate } from "@/lib/practice/registration-config";

// CPR-REG-002 v4 -- the Patient Registration workspace.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ALMOST ALL OF THIS IS COMPOSED, NOT BUILT. Search and duplicate detection, multiple hospital
// identifiers, guardians, configurable fields, name parts, register-and-book, the diary and the waiting
// queue all already exist. What this module adds is the OPERATIONAL PICTURE beside the form -- and two
// actions the comp leads with that had nowhere to go: queue a walk-in, and keep a draft.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/**
 * What the comp draws down the right-hand side, and what is refused.
 *
 * THE ONE FIGURE THAT GOES IS "82% UTILISATION". Every other number in that panel is a count of a list
 * somebody can open -- 18 appointments, 6 remaining, 2 walk-ins -- and those survive exactly as drawn.
 * A utilisation percentage needs a denominator nobody set: capacity is not recorded anywhere, so 82%
 * would be eighteen divided by a number this product invented. Same position CPR-330 took on rates and
 * CPR-360 took on "92% configured".
 */
export const REFUSED_ON_THIS_SCREEN = [
  {
    key: "utilisation",
    label: "Utilisation as a percentage",
    detail: "The design shows 82% with a progress bar. Utilisation is appointments divided by capacity, and capacity is not recorded anywhere in this product -- so the figure would be a real number over an invented one. The counts either side of it are real and are shown.",
  },
  {
    key: "photo",
    label: "Patient photograph",
    detail: "The design offers Take Photo and Upload Photo, and the specification lists Patient Photo as an entity. There is no file storage in this product -- CPR-320 declined it and named why, and a photograph of a patient is the most identifying file a practice could hold. It is not stubbed behind a button that fails.",
  },
  {
    key: "scan_id",
    label: "Scan ID",
    detail: "Reading a national ID or passport needs a camera and a document parser, neither of which exists here. Every identifier the scan would produce can be typed, and the search already covers all of them.",
  },
  {
    key: "encryption_claim",
    label: "\"Your data is secure and encrypted\"",
    detail: "That is a claim about a deployment this application does not inspect. The same position CPR-240 took on \"verified\" and CPR-370 on compliance badges: a reassurance nobody checked is worth less than an honest silence.",
  },
  {
    key: "ai_suggestions",
    label: "AI suggestions about a patient's care",
    detail: "The design's assistant offers \"Consider asking about new MRI results\". That originates a clinical suggestion, which is the line CPR-210 draws. The other two lines it shows -- whether a duplicate was found, and who has an overdue follow-up -- are computed from the record and are shown, without a model.",
  },
] as const;

/**
 * The operational panel.
 *
 * COUNTS, EACH THE LENGTH OF A LIST YOU CAN OPEN -- CPR-300's rule, which is why the utilisation bar
 * has nothing to replace it with rather than a substitute figure.
 */
export async function registrationWorkspace(admin: any, ctx: WorkspaceContext) {
  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);
  const { startIso, endIso } = zonedDayRange(today, timezone);

  // ⚠ EVERY READ BELOW USED TO DISCARD ITS ERROR, so a failed query rendered as an empty list and a
  // confident 0. The errors are captured and reported through `unavailable` -- a caller cannot tell
  // "nobody is waiting" from "the queue could not be read" without it, and the first is the answer a
  // screen will show.
  const [
    { data: appointments, error: apptErr }, { data: queue, error: queueErr },
    { data: recent, error: recentErr },
    { count: totalPatients, error: totalErr },
    { count: registeredTodayCount, error: regTodayErr },
    { data: followUps, error: followErr }, template,
  ] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, patient_id, patient_name, scheduled_at, status, appointment_type, reason")
      .eq("workspace_id", ctx.workspaceId).gte("scheduled_at", startIso).lt("scheduled_at", endIso)
      .order("scheduled_at"),
    admin.from("practice_queue_entry")
      .select("id, patient_id, patient_name, status, entered_at")
      .eq("workspace_id", ctx.workspaceId).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"])
      .order("entered_at"),
    admin.from("practice_patient")
      .select("id, display_name, created_at, status")
      .eq("workspace_id", ctx.workspaceId).neq("status", "merged")
      .order("created_at", { ascending: false }).limit(6),
    admin.from("practice_patient").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).neq("status", "merged"),
    // ⚠ "REGISTERED TODAY" HAS ITS OWN COUNT NOW, AND THAT IS THE WHOLE FIX. It used to be computed by
    // filtering `recent` -- which is `.limit(6)` -- so a practice that registered ten patients in a
    // morning was told six. Not a missing number: a WRONG one, quietly, in the direction that flatters
    // a slow morning and understates a busy one. `count: exact, head: true` is what the total directly
    // above already does; the two now differ only in their filter.
    admin.from("practice_patient").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).neq("status", "merged")
      .gte("created_at", startIso).lt("created_at", endIso),
    admin.from("practice_follow_up")
      .select("id, patient_id, due_on, status")
      .eq("workspace_id", ctx.workspaceId).eq("status", "OPEN").lte("due_on", today).limit(200),
    resolveTemplate(admin, ctx, {}),
  ]);

  const appts = (appointments ?? []) as any[];
  const queueRows = (queue ?? []) as any[];
  const recentRows = (recent ?? []) as any[];
  const overdue = (followUps ?? []) as any[];

  // Null rather than 0 when the count could not be read -- "nobody registered today" is a claim, and it
  // is the one a quiet-looking desk would be reassured by.
  const registeredToday = regTodayErr ? null : (registeredTodayCount ?? 0);
  const walkInsToday = appts.filter(a => a.appointment_type === "walk_in" || a.appointment_type === "emergency").length;
  const remaining = appts.filter(a => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)).length;

  return {
    today,
    timezone,
    clinic: {
      // THE COMP'S FOUR TILES, THREE OF WHICH SURVIVE UNCHANGED.
      appointments: appts.length,
      remaining,
      walkIns: walkInsToday,
      // The fourth is refused rather than replaced -- see REFUSED_ON_THIS_SCREEN.
      utilisationComputed: false,
      next: appts.find(a => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)) ?? null,
    },
    // ⚠ EVERY COUNT HERE IS `number | null`, AND NULL MEANS THE READ FAILED. It used to be `number`
    // throughout, which forced a failed query to be reported as 0 -- there was no other value to give.
    // A screen must render these as three states (a number / "could not be read" / absent), never as a
    // zero it was handed because something went wrong upstream.
    counts: {
      walkInsToday: apptErr ? null : walkInsToday,
      registeredToday,
      followUpsDueToday: followErr ? null : overdue.length,
      totalPatients: totalErr ? null : (totalPatients ?? 0),
    },
    /** Which reads failed, so a caller can say WHICH figure it cannot show rather than blanking them all. */
    unavailable: {
      appointments: !!apptErr,
      queue: !!queueErr,
      recent: !!recentErr,
      totalPatients: !!totalErr,
      registeredToday: !!regTodayErr,
      followUps: !!followErr,
      detail: [apptErr, queueErr, recentErr, totalErr, regTodayErr, followErr]
        .filter(Boolean).map(e => (e as { message: string }).message).join("; ") || null,
    },
    queue: queueRows.map(q => ({
      id: q.id, patientId: q.patient_id, name: q.patient_name, status: q.status,
      enteredAt: q.entered_at,
      // A QUEUE ENTRY WITHOUT A PATIENT CANNOT BE OPENED, and saying so beats a link that goes nowhere.
      href: q.patient_id ? `/practice/patients/${q.patient_id}` : null,
    })),
    recent: recentRows.map(r => ({
      id: r.id, name: r.display_name, at: r.created_at,
      href: `/practice/patients/${r.id}`,
    })),
    // THE COMP'S "AI ASSISTANT", WITHOUT THE AI. Two of its three lines are arithmetic over the record;
    // the third originated a clinical suggestion and is refused.
    observations: [
      overdue.length > 0
        ? { key: "followups", text: `${overdue.length} follow-up${overdue.length === 1 ? "" : "s"} due today or overdue`, href: "/practice/follow-ups" }
        : { key: "followups", text: "No follow-up is overdue", href: "/practice/follow-ups" },
      { key: "queue", text: queueRows.length === 0 ? "Nobody is waiting" : `${queueRows.length} waiting`, href: "/practice/calendar" },
      { key: "today", text: `${registeredToday} registered today`, href: null },
    ],
    template: template?.template ?? null,
    fields: template?.fields ?? [],
    majorityAge: MAJORITY_AGE,
    refused: REFUSED_ON_THIS_SCREEN,
  };
}

/**
 * Put a walk-in into today's queue.
 *
 * SEPARATE FROM BOOKING. An appointment is a promise about a time; a queue entry is a statement that
 * somebody is in the building now. Conflating them would put a walk-in on the diary at a made-up time.
 */
export async function queueWalkIn(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; alreadyWaiting: boolean }>> {
  if (!ctx.capabilities.includes("patient.create"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.create is required" };

  const { data: patient } = await admin.from("practice_patient")
    .select("id, display_name, status").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status === "merged")
    return { ok: false, status: 422, code: "MERGED", message: "this record has been merged into another" };

  // QUEUEING SOMEBODY TWICE IS A CLICK, NOT AN INTENTION -- and a duplicate entry makes the waiting list
  // lie about how many people are in the room.
  const { data: existing } = await admin.from("practice_queue_entry")
    .select("id").eq("workspace_id", ctx.workspaceId).eq("patient_id", args.patientId)
    .in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"]).maybeSingle();
  if (existing) return { ok: true, data: { id: existing.id as string, alreadyWaiting: true } };

  const { data, error } = await admin.from("practice_queue_entry").insert({
    workspace_id: ctx.workspaceId, patient_id: patient.id,
    // THE REGISTRY'S NAME, never a caller's spelling -- the rule migration 193 set for appointments.
    patient_name: patient.display_name, status: "WAITING",
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.walk_in_queued",
    payload: { queueId: data.id, patientId: patient.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string, alreadyWaiting: false } };
}

// ── DRAFTS ───────────────────────────────────────────────────────────────────────────────────────────

export async function saveDraft(admin: any, ctx: WorkspaceContext, args: {
  id?: string | null; payload: Record<string, unknown>; label?: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!ctx.capabilities.includes("patient.create"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "patient.create is required" };

  const label = args.label?.trim()
    || [args.payload.givenName, args.payload.familyName].filter(Boolean).join(" ").trim()
    || "Unnamed";

  if (args.id) {
    const { data: updated, error } = await admin.from("practice_registration_draft")
      .update({ payload: args.payload, label, updated_at: nowIso() })
      .eq("id", args.id).eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
      .select("id");
    if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
    // A DRAFT IS ITS AUTHOR'S. An update that matched nothing means it was somebody else's, or gone.
    if (!updated || updated.length === 0)
      return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    return { ok: true, data: { id: args.id } };
  }

  const { data, error } = await admin.from("practice_registration_draft").insert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId, payload: args.payload, label,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  return { ok: true, data: { id: data.id as string } };
}

/**
 * The caller's own drafts, with their age, because an old one is somebody's details nobody is minding.
 *
 * ⚠ THROWS ON A FAILED READ RATHER THAN RETURNING AN EMPTY LIST, and that choice is deliberate.
 *
 * The error used to be discarded, so a failed query looked like "you have no drafts" -- and the harm is
 * specific: a draft holds a half-registered person's details, and somebody told they have none stops
 * looking for the one they left. This is the same silent zero fixed in listFollowUps and
 * registerPatient.
 *
 * The two engines answer it differently ON PURPOSE. listFollowUps returns a result object because its
 * board must still RENDER while saying it cannot see. This has four callers -- one API route and three
 * harness assertions -- and every one of them treats the return as a plain array whose LENGTH is the
 * answer. A result object here would be shape churn across all four to express a state the API can just
 * as well surface as a 500. Where a caller must degrade, return the failure; where it should stop,
 * throw.
 */
export async function listDrafts(admin: any, ctx: WorkspaceContext) {
  const { data, error } = await admin.from("practice_registration_draft")
    .select("id, label, payload, created_at, updated_at")
    .eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .order("updated_at", { ascending: false }).limit(20);
  if (error) throw new Error(`drafts could not be read: ${error.message}`);

  const { timezone } = await workspaceClock(admin, ctx.workspaceId);
  const today = practiceToday(timezone);
  return ((data ?? []) as any[]).map(d => ({
    ...d,
    // DERIVED, like everything else clock-dependent here.
    daysOld: Math.max(0, Math.round(
      (Date.parse(`${today}T12:00:00Z`) - Date.parse(String(d.updated_at))) / 86400_000)),
  }));
}

export async function discardDraft(admin: any, ctx: WorkspaceContext, args: {
  id: string;
}): Promise<EngineResult<{ discarded: true }>> {
  const { data: deleted, error } = await admin.from("practice_registration_draft")
    .delete().eq("id", args.id).eq("workspace_id", ctx.workspaceId).eq("user_id", ctx.userId)
    .select("id");
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!deleted || deleted.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  return { ok: true, data: { discarded: true } };
}

/** The stepper. Which steps exist depends on the mode, and one depends on the patient's age. */
export function steps(mode: "quick" | "full", birthDate?: string | null, today?: string) {
  const age = birthDate && today ? ageFrom(birthDate, today) : null;
  const minor = age ? age.years < MAJORITY_AGE : null;

  return [
    { key: "search", label: "Search patient", always: true },
    { key: "identity", label: "Register patient", always: true },
    {
      key: "identifiers", label: "Hospital identifiers",
      // QUICK REGISTRATION IS THE COMP'S OWN PROMISE: "minimum information, complete later". Hospital
      // numbers are exactly what gets completed later.
      always: mode === "full",
    },
    {
      key: "contacts",
      // THE LABEL CHANGES WITH THE AGE, because the two are different obligations: a guardian has legal
      // authority, a next of kin is somebody to ring.
      label: minor === true ? "Guardian" : minor === false ? "Next of kin" : "Guardian or next of kin",
      always: true,
      required: minor === true,
    },
    { key: "visit", label: "Visit details", always: true },
  ].filter(s => s.always);
}
