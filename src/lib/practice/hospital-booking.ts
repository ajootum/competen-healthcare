import type { WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/provisioning";

const nowIso = () => new Date().toISOString();

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// MULTI-HOSPITAL BOOKING -- scheduling a patient to be seen AT A PARTICULAR HOSPITAL.
//
// The pieces were all here and none of them were joined up. practice_appointment.location_id has
// existed since migration 192 and was written unvalidated; practice_location has had type 'hospital'
// since 191 with no way to create one until CPR-360; practice_facility (222) knew which hospital issued
// a patient's MRN but had no idea the practitioner worked there.
//
// WHAT THIS FILE ADDS IS THE JOIN, and one question it lets the screen answer:
//
//     "I am booking this patient into Mulago on Thursday. What is their Mulago number?"
//
// Without it a clerk reads out whichever MRN happens to be on the record, with no way to tell which
// hospital issued it -- and hands the patient a number the receiving hospital does not recognise.
//
// ---- What this file will not claim ------------------------------------------------------------------
//
// NO BED, THEATRE OR ROOM AVAILABILITY. Booking a patient into Mulago here books THE PRACTITIONER'S
// TIME at Mulago. It does not reserve anything inside the hospital, does not know whether a bed exists,
// and cannot: this product holds no feed from any hospital's own system. A screen that showed a green
// "available" against a hospital would be inventing it.
//
// NO ADMISSION. Scheduling somebody to be seen at a hospital is not admitting them to it.
//
// NO TRAVEL TIME THAT WAS MEASURED. The buffer is a number the practitioner typed, not a distance.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** Identifier types that a hospital issues, in the order a clerk would read them out. */
const FACILITY_ISSUED = ["hospital_mrn", "hospital_number", "outpatient_number", "inpatient_number", "clinic_number"];

export const HOSPITAL_BOOKING_REFUSES = [
  { key: "bed_availability", label: "Bed or room availability", detail: "Booking a patient to be seen at a hospital books the practitioner's time there. This product holds no feed from any hospital's own system, so it cannot know whether a bed exists." },
  { key: "admission", label: "Admission", detail: "Scheduling somebody to be seen at a hospital is not admitting them to it." },
  { key: "measured_travel", label: "Measured travel time", detail: "The gap needed between two sites is a number somebody typed, not a distance anything calculated." },
  { key: "hospital_notified", label: "The hospital being told", detail: "Nothing is sent to the receiving hospital. The practitioner arranges their own attendance." },
];

// ── WHERE CAN I BOOK, AND WHAT IS THIS PATIENT'S NUMBER THERE ────────────────────────────────────────

export type BookingLocation = {
  id: string;
  name: string;
  type: string;
  travelBufferMinutes: number;
  /** The institution this place IS, when one has been linked. */
  facility: { id: string; name: string; type: string } | null;
  /**
   * The patient's live identifiers issued BY THAT FACILITY. Empty is meaningful and is not an error:
   * either the patient has never been to this hospital, or nobody has recorded the number.
   */
  patientIdentifiers: { type: string; value: string }[];
  /** Set when a hospital was linked to no facility, so the screen can say why no number is shown. */
  identifierNote: string | null;
};

/**
 * The places a booking can name, with this patient's number at each.
 *
 * Closed locations are excluded -- you cannot book into a site that is shut. Pass a patientId to get
 * the identifiers; without one the shape is the same and every list is empty, so a screen that has not
 * chosen a patient yet still renders.
 */
export async function bookingLocations(
  admin: any, ctx: WorkspaceContext, patientId?: string | null,
): Promise<BookingLocation[]> {
  const { data: locations } = await admin.from("practice_location")
    .select("id, name, type, facility_id, travel_buffer_minutes")
    .eq("workspace_id", ctx.workspaceId).eq("active", true).order("name");
  const rows = (locations ?? []) as any[];
  if (rows.length === 0) return [];

  const facilityIds = [...new Set(rows.map(r => r.facility_id).filter(Boolean))];
  const [{ data: facilities }, { data: identifiers }] = await Promise.all([
    facilityIds.length
      ? admin.from("practice_facility").select("id, name, facility_type, active")
          .eq("workspace_id", ctx.workspaceId).in("id", facilityIds)
      : Promise.resolve({ data: [] }),
    patientId && facilityIds.length
      ? admin.from("practice_patient_identifier")
          .select("identifier_type, value, facility_id")
          .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
          .is("valid_to", null).in("facility_id", facilityIds)
      : Promise.resolve({ data: [] }),
  ]);

  const facilityById = new Map(((facilities ?? []) as any[]).map(f => [f.id, f]));
  const idsByFacility = new Map<string, { type: string; value: string }[]>();
  for (const i of (identifiers ?? []) as any[]) {
    const list = idsByFacility.get(i.facility_id) ?? [];
    list.push({ type: i.identifier_type, value: i.value });
    idsByFacility.set(i.facility_id, list);
  }

  return rows.map(r => {
    const facility = r.facility_id ? facilityById.get(r.facility_id) : null;
    const ids = (r.facility_id ? idsByFacility.get(r.facility_id) ?? [] : [])
      .sort((a, b) => {
        const ai = FACILITY_ISSUED.indexOf(a.type), bi = FACILITY_ISSUED.indexOf(b.type);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
    return {
      id: r.id, name: r.name, type: r.type,
      travelBufferMinutes: r.travel_buffer_minutes ?? 30,
      facility: facility ? { id: facility.id, name: facility.name, type: facility.facility_type } : null,
      patientIdentifiers: ids,
      // Only a hospital is expected to issue numbers; a consulting room issuing none is not a gap.
      identifierNote: !r.facility_id && r.type === "hospital"
        ? "not linked to a facility, so this patient's number here cannot be shown"
        : null,
    };
  });
}

// ── LINKING A PLACE I WORK TO THE INSTITUTION IT IS ──────────────────────────────────────────────────

/**
 * Say that this location IS this facility.
 *
 * Both directions are checked against the caller's workspace, because a location in one practice must
 * never be able to point at another practice's facility -- that would leak the second practice's
 * patient numbering into the first practice's booking screen.
 *
 * Pass facilityId: null to unlink.
 */
export async function linkLocationToFacility(admin: any, ctx: WorkspaceContext, args: {
  locationId: string; facilityId: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ linked: boolean; facilityName: string | null }>> {
  const { data: location } = await admin.from("practice_location")
    .select("id, name, facility_id").eq("id", args.locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!location) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  let facilityName: string | null = null;
  if (args.facilityId) {
    const { data: facility } = await admin.from("practice_facility")
      .select("id, name, active").eq("id", args.facilityId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (!facility) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (!facility.active)
      return { ok: false, status: 422, code: "FACILITY_CLOSED", message: `${facility.name} is closed` };

    // One facility, one location. Two locations claiming to be the same hospital would show the same
    // patient number under two names and there would be no way to tell which was meant.
    const { data: taken } = await admin.from("practice_location")
      .select("id, name").eq("workspace_id", ctx.workspaceId).eq("facility_id", args.facilityId)
      .neq("id", args.locationId).maybeSingle();
    if (taken)
      return { ok: false, status: 409, code: "FACILITY_ALREADY_LINKED", message: `${facility.name} is already linked to ${taken.name}` };

    facilityName = facility.name;
  }

  if ((location.facility_id ?? null) === (args.facilityId ?? null))
    return { ok: false, status: 422, code: "NO_CHANGE", message: "nothing was different" };

  const { error } = await admin.from("practice_location")
    .update({ facility_id: args.facilityId, updated_at: nowIso() }).eq("id", location.id);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId,
    eventType: args.facilityId ? "practice.location_facility_linked" : "practice.location_facility_unlinked",
    payload: { locationId: location.id, facilityId: args.facilityId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { linked: !!args.facilityId, facilityName } };
}

/** How long it takes to get to this place from anywhere else the practitioner works. */
export async function setTravelBuffer(admin: any, ctx: WorkspaceContext, args: {
  locationId: string; minutes: number; actorId: string; correlationId: string;
}): Promise<EngineResult<{ minutes: number }>> {
  if (!Number.isInteger(args.minutes) || args.minutes < 0 || args.minutes > 480)
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "travel time must be a whole number of minutes between 0 and 480" };

  const { data: location } = await admin.from("practice_location")
    .select("id, name").eq("id", args.locationId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!location) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { error } = await admin.from("practice_location")
    .update({ travel_buffer_minutes: args.minutes, updated_at: nowIso() }).eq("id", location.id);
  if (error) return { ok: false, status: 422, code: "REFUSED_BY_DATABASE", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.location_travel_set",
    payload: { locationId: location.id, minutes: args.minutes }, correlationId: args.correlationId,
  });
  return { ok: true, data: { minutes: args.minutes } };
}

// ── THE DAY, SPLIT BY WHERE THE PRACTITIONER HAS TO BE ───────────────────────────────────────────────

export type LocationBlock = {
  locationId: string | null;
  name: string;
  type: string;
  facilityName: string | null;
  firstAt: string;
  lastEndsAt: string;
  appointmentCount: number;
};

export type ImpossibleMove = {
  fromName: string; toName: string;
  gapMinutes: number; neededMinutes: number;
  atIso: string;
};

/**
 * A day the practitioner can read as a route: where they are, in order, and which hops between sites
 * cannot physically be made.
 *
 * IMPOSSIBLE MOVES ARE REPORTED, NOT PREVENTED, HERE. bookAppointment refuses to create one, but a
 * booking made before two sites were linked -- or one deliberately forced through with allowOverlap --
 * still exists, and the practitioner needs to see it rather than discover it on the road.
 */
export async function locationDay(
  admin: any, ctx: WorkspaceContext, startIso: string, endIso: string,
): Promise<{ blocks: LocationBlock[]; impossible: ImpossibleMove[]; unassignedCount: number }> {
  const [{ data: appointments }, { data: locations }] = await Promise.all([
    admin.from("practice_appointment")
      .select("id, scheduled_at, duration_minutes, location_id, status")
      .eq("workspace_id", ctx.workspaceId)
      .not("status", "in", "(CANCELLED,NO_SHOW)")
      .gte("scheduled_at", startIso).lt("scheduled_at", endIso).order("scheduled_at"),
    admin.from("practice_location")
      .select("id, name, type, facility_id, travel_buffer_minutes").eq("workspace_id", ctx.workspaceId),
  ]);

  const rows = (appointments ?? []) as any[];
  const locRows = (locations ?? []) as any[];
  const facilityIds = [...new Set(locRows.map(l => l.facility_id).filter(Boolean))];
  const { data: facilities } = facilityIds.length
    ? await admin.from("practice_facility").select("id, name").eq("workspace_id", ctx.workspaceId).in("id", facilityIds)
    : { data: [] };
  const facilityById = new Map(((facilities ?? []) as any[]).map(f => [f.id, f]));
  const locById = new Map(locRows.map(l => [l.id, l]));

  // Consecutive appointments at the same place are one block; the practitioner is there once.
  const blocks: LocationBlock[] = [];
  let unassignedCount = 0;
  for (const a of rows) {
    if (!a.location_id) { unassignedCount++; continue; }
    const loc = locById.get(a.location_id);
    const endsAt = new Date(Date.parse(a.scheduled_at) + (a.duration_minutes ?? 20) * 60000).toISOString();
    const last = blocks[blocks.length - 1];
    if (last && last.locationId === a.location_id) {
      last.lastEndsAt = endsAt > last.lastEndsAt ? endsAt : last.lastEndsAt;
      last.appointmentCount++;
      continue;
    }
    blocks.push({
      locationId: a.location_id,
      name: loc?.name ?? "a location that no longer exists",
      type: loc?.type ?? "unknown",
      facilityName: loc?.facility_id ? facilityById.get(loc.facility_id)?.name ?? null : null,
      firstAt: a.scheduled_at, lastEndsAt: endsAt, appointmentCount: 1,
    });
  }

  const impossible: ImpossibleMove[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const from = blocks[i - 1], to = blocks[i];
    const needed = locById.get(to.locationId!)?.travel_buffer_minutes ?? 30;
    const gap = (Date.parse(to.firstAt) - Date.parse(from.lastEndsAt)) / 60000;
    if (gap < needed)
      impossible.push({
        fromName: from.name, toName: to.name,
        gapMinutes: Math.round(gap), neededMinutes: needed, atIso: to.firstAt,
      });
  }

  return { blocks, impossible, unassignedCount };
}
