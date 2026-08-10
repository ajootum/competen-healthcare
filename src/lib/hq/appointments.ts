// Competen HQ — the appointment board: who holds which position in which space, and what that grants.
//
// ⚠ WHY THIS FILE EXISTS. Five HQ spaces, six positions and 37 capability grants have been live since
// migration 264, and until now NOTHING IN THE PRODUCT COULD APPOINT ANYBODY TO ONE OF THEM. The only
// appointment UI that exists (/office-governance/offices) coerces `role` to one of the eight TENANT
// committee roles in APPOINTMENT_ROLES — chair, member, observer and so on — none of which is an
// hq_position code, so an appointment made there resolves through resolveHqPositions() to ZERO
// capabilities. The only way to put a human into Competen HQ was hand-written SQL.
//
// ⚠ IT READS THE SAME TABLES THE GUARD READS, IN THE SAME WAY, AND ADDS NO NEW STORE. ogs_offices,
// ogs_office_appointments, hq_position, hq_position_capability, hq_capability. No migration. The status
// allowlist and the grant time-window are IMPORTED from the modules the guard itself uses
// (appointmentGrantsAccess, activeGrants) rather than restated here, so this screen cannot tell somebody
// their appointment grants access while the guard disagrees.
//
// ⚠ A FAILED READ IS NEVER A ZERO. Every section below is a Read<T>: has data / genuinely empty / could
// not be read. An appointment board that renders "nobody holds this position" because a query errored is
// worse than one that renders nothing at all — it is the sentence somebody removes a control on.
//
// Pure module: type-only import of the admin client, no next/* import, so it is safe in any graph.

import type { createAdminClient } from "@/lib/supabase/server";
import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";
import { HQ_SPACES, activeGrants, hqOfficeType, isHqOfficeType, type HqSpace } from "./spaces";

type Admin = ReturnType<typeof createAdminClient>;

// ── Three states, everywhere ─────────────────────────────────────────────────
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };
export const readOk = <T,>(value: T): Read<T> => ({ ok: true, value });
export const readFail = <T,>(error: string): Read<T> => ({ ok: false, error });

// ── Vocabulary ───────────────────────────────────────────────────────────────
export const SPACE_LABEL: Record<HqSpace, string> = {
  executive: "Executive", platform: "Platform", practice: "Practice",
  learning: "Learning", quality: "Quality",
};

/**
 * The statuses an appointment may be MOVED TO by this screen.
 *
 * ⚠ NONE OF THEM GRANTS ACCESS, AND THAT IS THE POINT. Ending an appointment must never be able to
 * become a way of MAKING one: if a status on this list were ever added to ACCESS_GRANTING_STATUSES, the
 * PATCH handler would have been an appointment path that skipped every check on the POST handler,
 * including the refusal to appoint yourself. The API asserts appointmentGrantsAccess() is false for the
 * requested status at runtime rather than trusting this list to stay correct.
 */
export const HQ_END_STATUSES = ["removed", "expired", "suspended"] as const;
export type HqEndStatus = (typeof HQ_END_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  active: "Active", nominated: "Nominated", suspended: "Suspended",
  expired: "Expired", removed: "Ended",
};
/** What a status means for the door, in one true sentence each. */
export const STATUS_MEANING: Record<string, string> = {
  active: "Opens Competen HQ with everything this position grants.",
  nominated: "A proposal. Grants nothing until somebody makes it active.",
  suspended: "Access stopped. The person is still on the roster.",
  expired: "The term ran out. Grants nothing.",
  removed: "Ended. Kept as the record that the appointment happened.",
};

// ── Row shapes ───────────────────────────────────────────────────────────────
type OfficeRow = { id: string; office_type: string | null; name: string | null; code: string | null; status: string | null; is_active: boolean | null; hospital_id: string | null };
type PositionRow = { code: string; space: string | null; name: string | null; description: string | null; is_active: boolean | null };
type GrantRow = { position_code: string; capability_code: string; effective_from: string | null; effective_to: string | null };
type CapabilityRow = { code: string; label: string | null };
type AppointmentRow = { id: string; office_id: string; person_id: string | null; person_name: string | null; role: string | null; status: string | null; term_start: string | null; term_end: string | null; scope: string | null; appointed_by: string | null; created_at: string | null };

// ── Views ────────────────────────────────────────────────────────────────────
export type HqCapabilityView = { code: string; label: string | null; effectiveFrom: string | null; effectiveTo: string | null; inWindow: boolean };
export type HqHolderView = {
  appointmentId: string;
  personId: string | null;
  personName: string | null;
  status: string;
  /** Whether THIS row currently opens the door — the guard's own allowlist, not a re-implementation. */
  grantsAccess: boolean;
  termStart: string | null;
  termEnd: string | null;
  appointedBy: string | null;
  createdAt: string | null;
  officeId: string;
};
export type HqPositionView = {
  code: string;
  name: string;
  description: string | null;
  space: HqSpace;
  isActive: boolean;
  capabilities: Read<HqCapabilityView[]>;
  holders: Read<HqHolderView[]>;
};
export type HqSpaceView = {
  space: HqSpace;
  label: string;
  officeId: string | null;
  officeName: string | null;
  officeStatus: string | null;
  /** An office that is dissolved, archived or inactive is invisible to the guard, so it cannot be staffed. */
  officeUsable: boolean;
  officeNote: string | null;
  positions: Read<HqPositionView[]>;
};
/**
 * An appointment sitting in an HQ space whose `role` is not an hq_position code.
 *
 * ⚠ THIS IS NOT A HYPOTHETICAL CATEGORY. It is exactly what /office-governance/offices produces: `role`
 * is coerced to one of the eight tenant committee roles, so the row is a real appointment that grants
 * nothing at all. Rendering it as a holder would be a lie; hiding it would be a different one.
 */
export type HqOrphanView = HqHolderView & { role: string | null; space: HqSpace | null; spaceLabel: string };

export type HqAppointmentBoard = {
  spaces: Read<HqSpaceView[]>;
  orphans: Read<HqOrphanView[]>;
  /** Statements about the data that are true today — each one is shown to the operator verbatim. */
  notes: string[];
};

/**
 * The office that IS a space, resolved from rows rather than from a client-supplied id.
 *
 * ⚠ THE OFFICE ID IS NEVER TAKEN FROM THE CALLER. /api/office-governance/offices/[id]/appointments takes
 * one in the URL, and until it was fixed that let any hospital_admin POST an appointment into an HQ space
 * (the guard read `office.hospital_id &&`, and every HQ office has a null hospital_id). Deriving the
 * office from the POSITION's space closes that shape by construction: there is no id to tamper with.
 */
export function officeForSpace(offices: OfficeRow[], space: HqSpace): { office: OfficeRow | null; note: string | null } {
  const wanted = hqOfficeType(space);
  const matches = offices.filter(o => o.office_type === wanted);
  if (matches.length === 0)
    return { office: null, note: `No ogs_offices row of type ${wanted} exists, so this space cannot be staffed.` };
  const usable = matches.filter(o => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  if (usable.length === 0)
    return { office: matches[0], note: `The ${wanted} office is ${matches[0].status ?? "inactive"}, so the guard cannot see it and an appointment into it would grant nothing.` };
  if (usable.length > 1)
    return { office: usable[0], note: `${usable.length} office rows carry the type ${wanted}. Holders are listed from all of them; a new appointment is written to "${usable[0].name ?? usable[0].id}".` };
  return { office: usable[0], note: null };
}

export const officeIsUsable = (o: OfficeRow | null): boolean =>
  !!o && o.is_active !== false && o.status !== "dissolved" && o.status !== "archived";

const toHolder = (a: AppointmentRow): HqHolderView => ({
  appointmentId: a.id,
  personId: a.person_id,
  personName: a.person_name,
  status: a.status ?? "unknown",
  grantsAccess: appointmentGrantsAccess(a.status),
  termStart: a.term_start,
  termEnd: a.term_end,
  appointedBy: a.appointed_by,
  createdAt: a.created_at,
  officeId: a.office_id,
});

/** Every HQ office row, read once. Shared by the loader and by the write handlers. */
export async function readHqOffices(admin: Admin): Promise<Read<OfficeRow[]>> {
  const { data, error } = await admin
    .from("ogs_offices")
    .select("id, office_type, name, code, status, is_active, hospital_id")
    .limit(500);
  if (error) return readFail(error.message);
  return readOk((data as OfficeRow[]).filter(o => isHqOfficeType(o.office_type)));
}

/**
 * The whole board.
 *
 * ⚠ EVERY READ IS SEPARATELY FALLIBLE. The offices read failing means the board cannot be drawn at all;
 * the grants read failing means capability lists are unreadable but holders are still shown; the
 * appointments read failing means holders are unreadable but positions and their grants are still shown.
 * Nothing collapses into an empty array on the way.
 */
export async function loadHqAppointmentBoard(admin: Admin): Promise<HqAppointmentBoard> {
  const notes: string[] = [];

  const officesRead = await readHqOffices(admin);
  if (!officesRead.ok)
    return {
      spaces: readFail(officesRead.error),
      orphans: readFail(officesRead.error),
      notes: ["The HQ spaces could not be read, so nothing below is a count of anything."],
    };
  const offices = officesRead.value;
  const officeIds = offices.map(o => o.id);

  const [posRes, grantRes, capRes, apptRes] = await Promise.all([
    admin.from("hq_position").select("code, space, name, description, is_active").limit(500),
    admin.from("hq_position_capability").select("position_code, capability_code, effective_from, effective_to").limit(5000),
    admin.from("hq_capability").select("code, label").limit(500),
    officeIds.length
      ? admin.from("ogs_office_appointments")
          .select("id, office_id, person_id, person_name, role, status, term_start, term_end, scope, appointed_by, created_at")
          .in("office_id", officeIds).limit(2000)
      : Promise.resolve({ data: [] as AppointmentRow[], error: null }),
  ]);

  const positions: Read<PositionRow[]> = posRes.error ? readFail(posRes.error.message) : readOk((posRes.data ?? []) as PositionRow[]);
  const grants: Read<GrantRow[]> = grantRes.error ? readFail(grantRes.error.message) : readOk((grantRes.data ?? []) as GrantRow[]);
  const appts: Read<AppointmentRow[]> = apptRes.error ? readFail(apptRes.error.message) : readOk((apptRes.data ?? []) as AppointmentRow[]);
  // A missing label is cosmetic, so a failed catalogue read degrades to "no label" rather than to an
  // unreadable capability list — the CODE is the thing that grants, and it comes from the grants read.
  const capLabels = new Map<string, string | null>(
    capRes.error ? [] : ((capRes.data ?? []) as CapabilityRow[]).map(c => [c.code, c.label]),
  );
  if (capRes.error) notes.push(`Capability names could not be read (${capRes.error.message}), so codes are shown without their labels.`);

  const spaces: HqSpaceView[] = HQ_SPACES.map(space => {
    const { office, note } = officeForSpace(offices, space);
    const spaceOfficeIds = offices.filter(o => o.office_type === hqOfficeType(space)).map(o => o.id);

    const positionsForSpace: Read<HqPositionView[]> = positions.ok
      ? readOk(positions.value.filter(p => p.space === space).map(p => {
          const caps: Read<HqCapabilityView[]> = grants.ok
            ? readOk(grants.value.filter(g => g.position_code === p.code).map(g => ({
                code: g.capability_code,
                label: capLabels.get(g.capability_code) ?? null,
                effectiveFrom: g.effective_from,
                effectiveTo: g.effective_to,
                inWindow: activeGrants([g]).length === 1,
              })).sort((a, b) => a.code.localeCompare(b.code)))
            : readFail<HqCapabilityView[]>(grants.error);
          const holders: Read<HqHolderView[]> = appts.ok
            ? readOk(appts.value
                .filter(a => spaceOfficeIds.includes(a.office_id) && a.role === p.code)
                .map(toHolder)
                .sort((a, b) => Number(b.grantsAccess) - Number(a.grantsAccess) || (a.personName ?? "").localeCompare(b.personName ?? "")))
            : readFail<HqHolderView[]>(appts.error);
          return {
            code: p.code,
            name: p.name ?? p.code,
            description: p.description,
            space,
            isActive: p.is_active !== false,
            capabilities: caps,
            holders,
          };
        }).sort((a, b) => a.name.localeCompare(b.name)))
      : readFail<HqPositionView[]>(positions.error);

    return {
      space,
      label: SPACE_LABEL[space],
      officeId: office?.id ?? null,
      officeName: office?.name ?? null,
      officeStatus: office?.status ?? null,
      officeUsable: officeIsUsable(office),
      officeNote: note,
      positions: positionsForSpace,
    };
  });

  // ⚠ Appointments in an HQ space whose role is not a position code. Classifying them needs the position
  // list; without it the answer is "unreadable", never "none".
  const orphans: Read<HqOrphanView[]> = !appts.ok
    ? readFail<HqOrphanView[]>(appts.error)
    : !positions.ok
      ? readFail<HqOrphanView[]>(`Positions could not be read (${positions.error}), so appointments cannot be matched to positions.`)
      : readOk(appts.value
          .filter(a => !positions.value.some(p => p.code === a.role))
          .map(a => {
            const office = offices.find(o => o.id === a.office_id);
            const space = HQ_SPACES.find(s => hqOfficeType(s) === office?.office_type) ?? null;
            return { ...toHolder(a), role: a.role, space, spaceLabel: space ? SPACE_LABEL[space] : (office?.name ?? "Unknown space") };
          }));

  if (positions.ok && positions.value.length === 0) notes.push("hq_position has no rows, so there is nothing to appoint anybody to.");
  if (appts.ok && appts.value.length === 0) notes.push("No appointment has ever been made into an HQ space. Nobody holds a position.");

  return { spaces: readOk(spaces), orphans, notes };
}

// ── Counting, for the summary line ───────────────────────────────────────────
// ⚠ A COUNT OVER AN UNREADABLE SECTION IS NULL, NOT 0. Rendering 0 for "could not be read" is the exact
// bug the three-state rule exists to prevent, and a summary line is where it hides best.
export function countHolders(board: HqAppointmentBoard, predicate: (h: HqHolderView) => boolean): number | null {
  if (!board.spaces.ok) return null;
  let n = 0;
  for (const s of board.spaces.value) {
    if (!s.positions.ok) return null;
    for (const p of s.positions.value) {
      if (!p.holders.ok) return null;
      n += p.holders.value.filter(predicate).length;
    }
  }
  return n;
}
