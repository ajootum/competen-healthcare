// CPR-GROWTH-001 section 8: "every activation milestone emits a reliable event."
//
// ⚠ COUNT-BASED, NOT CALL-COUNTED, AND THAT IS WHAT MAKES THEM RELIABLE. A hook that emitted "first
// booking" because it happened to be invoked on the first booking would be wrong the moment a booking was
// created by a path nobody wired, backfilled, or imported. These hooks COUNT what exists and emit what the
// count justifies, so they are correct however often they run and whatever ran before them.
//
// ⚠ AND THEY ARE NON-BLOCKING BY CONSTRUCTION. Telemetry must never fail a booking. Every function returns
// void, swallows its own errors, and is called without await-ing a result the caller could act on. A
// practitioner losing an appointment because a commercial metric could not be written would be an absurd
// trade, and it is the one this shape makes impossible.
//
// ⚠ A FAILED COUNT EMITS NOTHING. "We could not count the bookings" is not "there is one" -- claiming a
// milestone the data cannot support is worse than missing it, because the customer-success queue would stop
// chasing a practice that never activated.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { emitActivation } from "./activation";

/** Rows of `table` belonging to this workspace, or null when the count could not be established. */
async function countFor(admin: any, table: string, workspaceId: string): Promise<number | null> {
  try {
    // ⚠ NOT head:true. A head+count read returns NO error for a table that does not exist, so the count
    // comes back null and a caller defaulting it to 0 reads a missing table as an empty one. Selecting a
    // row alongside the count makes that a real error.
    const { count, error } = await admin.from(table).select("id", { count: "exact" })
      .eq("workspace_id", workspaceId).limit(1);
    if (error || count == null) return null;
    return count;
  } catch { return null; }
}

/**
 * Appointments: section 2's `booking.first_received` and `booking.tenth_received`.
 *
 * Both are emitted from one count, so a practice that imported eleven bookings at once gets both milestones
 * rather than only the one whose moment a hook happened to observe.
 */
export async function onAppointmentCreated(admin: any, workspaceId: string, actorId?: string | null): Promise<void> {
  try {
    const n = await countFor(admin, "practice_appointment", workspaceId);
    if (n === null) return;
    if (n >= 1) await emitActivation(admin, { workspaceId, eventKey: "booking.first_received", actorId: actorId ?? null });
    if (n >= 10) await emitActivation(admin, { workspaceId, eventKey: "booking.tenth_received", actorId: actorId ?? null });
  } catch { /* telemetry never fails the booking that triggered it */ }
}

export async function onFollowUpCreated(admin: any, workspaceId: string, actorId?: string | null): Promise<void> {
  try {
    const n = await countFor(admin, "practice_follow_up", workspaceId);
    if (n === null || n < 1) return;
    await emitActivation(admin, { workspaceId, eventKey: "followup.first_created", actorId: actorId ?? null });
  } catch { /* non-blocking */ }
}

/**
 * ⚠ "CLOSED" MEANS A PRACTITIONER FINISHED IT, NOT THAT A ROW EXISTS. Section 2 calls this milestone
 * "continuity adoption", so it counts encounters that actually reached a settled status. Counting DRAFTs
 * would fire it for a practice that has never completed a single consultation -- and a capture-later shell
 * is created by one tap, so the milestone would land before any clinical work had been done at all.
 */
export async function onEncounterClosed(admin: any, workspaceId: string, actorId?: string | null): Promise<void> {
  try {
    const { count, error } = await admin.from("practice_encounter").select("id", { count: "exact" })
      .eq("workspace_id", workspaceId).in("status", ["COMPLETED", "SIGNED", "AMENDED"]).limit(1);
    if (error || count == null || count < 1) return;
    await emitActivation(admin, { workspaceId, eventKey: "encounter.first_closed", actorId: actorId ?? null });
  } catch { /* non-blocking */ }
}

/**
 * The booking page became LIVE - section 2's "booking link generated / distribution asset".
 *
 * ⚠ LIVE, NOT MERELY EXISTING. A handle is claimed at provisioning and a hidden page has a URL that
 * answers "this page does not exist", so emitting on either would mark a practice as having a
 * distribution asset it cannot give anybody.
 */
export async function onBookingLinkCreated(admin: any, workspaceId: string, actorId?: string | null): Promise<void> {
  try {
    await emitActivation(admin, { workspaceId, eventKey: "booking.link_created", actorId: actorId ?? null });
  } catch { /* non-blocking */ }
}

/**
 * The practitioner took a share action - section 2's "intent to acquire patients".
 *
 * ⚠ THIS RECORDS AN ACTION, NEVER A RECEIPT, AND THE SCREEN ALREADY SAYS SO. The copy button reads
 * "Link copied. Nothing was sent." Competen cannot observe a WhatsApp message being sent or a poster being
 * put on a wall, and it must not pretend otherwise: this fires when somebody copied the link, opened a
 * share window or downloaded the QR. Section 2 names the milestone "intent to acquire patients", which is
 * exactly and only what that evidences.
 *
 * ⚠ SO THE AMBER RULE IT FEEDS IS ABOUT INTENT TOO. "Link shared but no booking after an interval" means
 * the practitioner took a step and no patient came -- which is worth a call. It does NOT mean patients saw
 * the link and ignored it, and a customer-success script that assumed so would be telling them something
 * untrue about their own practice.
 *
 * `via` records WHICH action, so the difference between copying a link and printing a poster stays visible.
 * It is a channel name and carries nothing about any patient.
 */
export async function onBookingLinkShared(
  admin: any, workspaceId: string, actorId?: string | null, via?: string,
): Promise<void> {
  try {
    await emitActivation(admin, {
      workspaceId, eventKey: "booking.link_shared", actorId: actorId ?? null,
      metadata: via ? { via } : {},
    });
  } catch { /* non-blocking */ }
}

/** Provisioning. `practice.created` is the acquisition milestone in section 2. */
export async function onPracticeCreated(admin: any, workspaceId: string, actorId?: string | null): Promise<void> {
  try {
    await emitActivation(admin, { workspaceId, eventKey: "practice.created", actorId: actorId ?? null });
  } catch { /* non-blocking */ }
}

// ⚠ THE MILESTONES WITH NO HOOK, NAMED RATHER THAN QUIETLY ABSENT.
//
// Four of section 2's ten have no reliable write path to hang on yet, and inventing one would produce an
// event that fires when nobody did anything:
//   practice.setup_completed  - "setup complete" has no single definition in this product. CPR-CAP-001's
//                               activation covers capabilities, not the setup steps section 5 lists.
//   booking.link_created      - the booking page row exists, but nothing distinguishes creating a link from
//                               provisioning the practice.
//   booking.link_shared       - nothing in this product observes a share. Section 5 wants a QR and a link
//                               handed out on WhatsApp, which happens outside it entirely.
//   intelligence.first_action - "actioned" needs an insight with an act attached, and the intelligence
//                               surface currently reads.
//
// ⚠ THIS MATTERS FOR THE NORTH STAR. Section 1 defines Activated as setup + link created + link shared +
// first booking, and THREE of those four cannot be emitted today -- so no practice can currently be
// Activated by the definition, however well it is doing. isActivated() is therefore correct and unusable
// until these exist, which is a gap in the product rather than in the rule.
export const UNHOOKED_MILESTONES = [
  { key: "practice.setup_completed", why: "no single definition of setup completion exists in this product" },
  { key: "intelligence.first_action", why: "the intelligence surface reads, so there is no action to record" },
  // ⚠ booking.link_created AND booking.link_shared HAVE MOVED OFF THIS LIST. The reasoning above was that
  // "sharing happens outside this product and nothing observes it" -- true of the SEND, and wrong about the
  // ACT. Competen does observe the practitioner copying the link, opening a share window or downloading the
  // QR, and section 2 calls that milestone "intent to acquire patients", not "patients received it".
];
