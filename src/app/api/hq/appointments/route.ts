import { NextResponse } from "next/server";
import { resolveHqContext } from "@/lib/hq/context";
import { appointmentGrantsAccess } from "@/lib/ogs/lifecycle";
import { currentTraceId } from "@/lib/trace";
import { HQ_SPACES, type HqSpace } from "@/lib/hq/spaces";
import {
  loadHqAppointmentBoard, officeForSpace, officeIsUsable, readHqOffices,
  HQ_END_STATUSES,
} from "@/lib/hq/appointments";

/**
 * /api/hq/appointments — the write path for Competen HQ appointments.
 *
 * GET    the whole board (spaces -> positions -> holders -> what each position grants)
 * POST   appoint a person to a position          { person_id, position_code, term_end? }
 * PATCH  end an appointment                      { appointment_id, status }
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ THE FIVE THINGS THIS HANDLER REFUSES TO TAKE FROM THE CLIENT, AND WHY EACH ONE IS A HOLE ELSEWHERE.
 *
 * 1. THE OFFICE. The caller sends a POSITION code; the office is derived server-side from that position's
 *    `space`. /api/office-governance/offices/[id]/appointments takes the office id in the URL, and until
 *    it was fixed its scope guard read `office.hospital_id && ...` — which meant an office belonging to NO
 *    hospital was in everybody's scope, and every HQ space has hospital_id null by construction. There is
 *    no id here to tamper with.
 *
 * 2. THE CAPABILITY. Nothing in the request names one. Capabilities come only from hq_position_capability,
 *    which this route never writes. Appointing somebody can therefore never grant more than the position
 *    already grants, whatever the request body says.
 *
 * 3. THE SUBJECT'S OWN IDENTITY AS AUTHORITY. `person_id` is the subject of the write, never its
 *    authoriser. Authority comes from the session.
 *
 * 4. AN ACCESS-GRANTING STATUS ON PATCH. PATCH is the END verb. If it accepted `active` it would be a
 *    second appointment path — one that skips every check on POST, including the refusal below to appoint
 *    yourself. It asks appointmentGrantsAccess() at runtime rather than trusting a hard-coded list, so
 *    adding a status to the allowlist in ogs/lifecycle cannot quietly turn this into an appoint route.
 *
 * 5. DELETION. There is no DELETE verb. Ending an appointment SETS status; the row is the record that the
 *    appointment happened, and a governance plane that forgets is not a governance plane.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SELF-APPOINTMENT IS REFUSED OUTRIGHT, INCLUDING FOR AN OWNER.
 *
 * Writing here requires platform ownership (super_admin or platform_owner), which is the same predicate
 * the /super-admin door uses. An owner already reaches everything — decideHq short-circuits on ownership
 * before any HQ table is read — so an owner appointing THEMSELVES gains no access they did not have, and
 * refusing it costs them nothing they cannot get by asking the other owner. What it buys is that there is
 * no request in this product whose effect is "give me more than I was given". A second owner appoints you;
 * you never appoint yourself.
 *
 * ⚠ AND THE READ GATE IS THE ORDINARY ONE. GET runs through resolveHqContext("hq.platform.users.view") —
 * an EXISTING code from the 29 in the catalogue (migration 264 §8: "Platform-wide user administration"),
 * not a new one. In OBSERVE mode, which is what hq_config ships with, a person holding any HQ position
 * whose position does not hold that capability is RECORDED and let through; that is what observe mode is,
 * it is platform-wide, and this route does not invent a private exception to it. Writes are unaffected:
 * they require ownership in both modes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const READ_CAPABILITY = "hq.platform.users.view";
const today = () => new Date().toISOString().slice(0, 10);
const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

type Ctx = Awaited<ReturnType<typeof resolveHqContext>>;
type OkCtx = Extract<Ctx, { ok: true }>["ctx"];

/** Authenticate + capability-gate. Returns a NextResponse on refusal. */
async function gate(): Promise<OkCtx | NextResponse> {
  const res = await resolveHqContext(READ_CAPABILITY);
  if (!res.ok)
    return NextResponse.json(
      { error: res.redirectTo === "/login" ? "Not signed in" : "You do not hold a position that opens Competen HQ" },
      { status: res.redirectTo === "/login" ? 401 : 403 },
    );
  return res.ctx;
}

/**
 * ⚠ THE WRITE GATE IS OWNERSHIP, NOT THE READ CAPABILITY.
 *
 * hq.platform.users.view is held today by the Platform Director position. Letting that capability WRITE
 * here would mean a Platform Director could appoint themselves Chief Executive — the escalation this
 * whole model exists to prevent, arriving through the screen built to administer it. Appointing is an act
 * of ownership; reading the board is administration.
 */
const OWNER_ONLY = "Appointing to Competen HQ requires platform ownership. You can see the board but not change it.";

async function auditOrNull(ctx: OkCtx, row: Record<string, unknown>): Promise<string | null> {
  try {
    const { error } = await ctx.admin.from("audit_log").insert(row);
    return error ? error.message : null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

// ── GET: the board ───────────────────────────────────────────────────────────
export async function GET() {
  const ctx = await gate();
  if (ctx instanceof NextResponse) return ctx;
  const board = await loadHqAppointmentBoard(ctx.admin);
  return NextResponse.json({ board, canAppoint: ctx.isOwner });
}

// ── POST: appoint ────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const ctx = await gate();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isOwner) return NextResponse.json({ error: OWNER_ONLY }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const personId = b?.person_id;
  const positionCode = typeof b?.position_code === "string" ? b.position_code.trim() : "";
  const termEnd = typeof b?.term_end === "string" && b.term_end.trim() ? b.term_end.trim() : null;

  if (!isUuid(personId)) return NextResponse.json({ error: "person_id must be a profile id" }, { status: 400 });
  if (!positionCode) return NextResponse.json({ error: "position_code is required" }, { status: 400 });
  if (termEnd && !/^\d{4}-\d{2}-\d{2}$/.test(termEnd))
    return NextResponse.json({ error: "term_end must be a date, YYYY-MM-DD" }, { status: 400 });
  if (termEnd && termEnd < today())
    return NextResponse.json({ error: "term_end is in the past" }, { status: 400 });

  // ⚠ SELF-APPOINTMENT. See the header. Tested before anything is read, so the refusal cannot depend on
  // the state of any table.
  if (personId === ctx.userId)
    return NextResponse.json({ error: "You cannot appoint yourself to an HQ position. Another platform owner has to do it." }, { status: 403 });

  // The position, from the database — never a code the client invented.
  const { data: position, error: posErr } = await ctx.admin
    .from("hq_position").select("code, space, name, is_active").eq("code", positionCode).maybeSingle();
  if (posErr) return NextResponse.json({ error: `Positions could not be read: ${posErr.message}` }, { status: 500 });
  if (!position) return NextResponse.json({ error: "No such HQ position" }, { status: 404 });
  if ((position as any).is_active === false)
    return NextResponse.json({ error: `${(position as any).name ?? positionCode} is deactivated. It grants nothing, so appointing to it would be a door onto nothing.` }, { status: 409 });
  const space = (position as any).space as HqSpace;
  if (!(HQ_SPACES as readonly string[]).includes(space))
    return NextResponse.json({ error: `Position ${positionCode} names the space "${space}", which is not one of the five HQ spaces.` }, { status: 409 });

  // The subject must be a real person.
  const { data: person, error: personErr } = await ctx.admin
    .from("profiles").select("id, full_name").eq("id", personId).maybeSingle();
  if (personErr) return NextResponse.json({ error: `Profiles could not be read: ${personErr.message}` }, { status: 500 });
  if (!person) return NextResponse.json({ error: "No such person" }, { status: 404 });

  // The office is DERIVED, not supplied.
  const offices = await readHqOffices(ctx.admin);
  if (!offices.ok) return NextResponse.json({ error: `HQ spaces could not be read: ${offices.error}` }, { status: 500 });
  const { office } = officeForSpace(offices.value, space);
  if (!office || !officeIsUsable(office))
    return NextResponse.json({ error: `The HQ ${space} space is not available to be staffed${office ? ` (its office is ${office.status ?? "inactive"})` : ""}.` }, { status: 409 });

  // One live appointment per person + position. Reported, not silently upserted: the operator asked to
  // create something that already exists and should be told so.
  const { data: existing, error: exErr } = await ctx.admin
    .from("ogs_office_appointments").select("id, status")
    .eq("office_id", office.id).eq("person_id", personId).eq("role", positionCode).eq("status", "active").limit(1);
  if (exErr) return NextResponse.json({ error: `Existing appointments could not be read: ${exErr.message}` }, { status: 500 });
  if ((existing ?? []).length)
    return NextResponse.json({ error: `${(person as any).full_name ?? "That person"} already holds ${(position as any).name ?? positionCode}.`, id: (existing as any[])[0].id }, { status: 409 });

  // ⚠ NEVER DISCARD THE INSERT'S ERROR. A discarded write error is the bug class this codebase has been
  // bitten by twice — a partial index that could not be an ON CONFLICT target, failing silently.
  const { data: ins, error: insErr } = await ctx.admin.from("ogs_office_appointments").insert({
    office_id: office.id,
    person_id: personId,
    person_name: (person as any).full_name ?? null,
    // The hq_position CODE, which is what resolveHqPositions() reads. This is the whole difference
    // between this route and /office-governance, which coerces role to a tenant committee role.
    role: positionCode,
    term_start: today(),
    term_end: termEnd,
    scope: "enterprise",
    status: "active",
    appointed_by: ctx.fullName ?? ctx.userId,
  }).select("id").single();
  if (insErr || !ins) return NextResponse.json({ error: `The appointment was not written: ${insErr?.message ?? "no row returned"}` }, { status: 500 });

  const auditError = await auditOrNull(ctx, {
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `hq_appoint_${positionCode}`, entity_type: "ogs_office_appointment", entity_id: ins.id,
    entity_name: (person as any).full_name ?? personId, hospital_id: null,
    new_value: { position: positionCode, space, office_id: office.id, person_id: personId, status: "active" },
  });

  return NextResponse.json({ ok: true, id: ins.id, position: positionCode, space, audit_error: auditError }, { status: 201 });
}

// ── PATCH: end an appointment ────────────────────────────────────────────────
export async function PATCH(req: Request) {
  const ctx = await gate();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isOwner) return NextResponse.json({ error: OWNER_ONLY }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const appointmentId = b?.appointment_id;
  const status = typeof b?.status === "string" ? b.status.trim() : "";
  if (!isUuid(appointmentId)) return NextResponse.json({ error: "appointment_id is required" }, { status: 400 });
  if (!(HQ_END_STATUSES as readonly string[]).includes(status))
    return NextResponse.json({ error: `status must be one of: ${HQ_END_STATUSES.join(", ")}` }, { status: 400 });
  // ⚠ Asked of the guard's own allowlist, at runtime. If somebody ever adds one of these statuses to
  // ACCESS_GRANTING_STATUSES, this route refuses rather than becoming an appointment path.
  if (appointmentGrantsAccess(status))
    return NextResponse.json({ error: `"${status}" grants access, and this endpoint only ends appointments.` }, { status: 400 });

  const { data: appt, error: aErr } = await ctx.admin
    .from("ogs_office_appointments").select("id, office_id, person_id, person_name, role, status").eq("id", appointmentId).maybeSingle();
  if (aErr) return NextResponse.json({ error: `The appointment could not be read: ${aErr.message}` }, { status: 500 });
  if (!appt) return NextResponse.json({ error: "No such appointment" }, { status: 404 });

  // ⚠ HQ OFFICES ONLY. Without this, an HQ screen would be a general-purpose way to end any tenant
  // committee appointment in the estate — a different plane, with its own scope rules.
  const offices = await readHqOffices(ctx.admin);
  if (!offices.ok) return NextResponse.json({ error: `HQ spaces could not be read: ${offices.error}` }, { status: 500 });
  if (!offices.value.some(o => o.id === (appt as any).office_id))
    return NextResponse.json({ error: "That appointment is not in a Competen HQ space." }, { status: 403 });

  if ((appt as any).status === status)
    return NextResponse.json({ error: `That appointment is already ${status}.` }, { status: 409 });

  // ⚠ SET, NEVER DELETE. term_end records WHEN it ended for the two statuses that are endings; a
  // suspension is a pause, so its term is left alone.
  const patch: Record<string, unknown> = { status };
  if (status === "removed" || status === "expired") patch.term_end = today();
  const { data: upd, error: uErr } = await ctx.admin
    .from("ogs_office_appointments").update(patch).eq("id", appointmentId).select("id, status").single();
  if (uErr || !upd) return NextResponse.json({ error: `The appointment was not changed: ${uErr?.message ?? "no row returned"}` }, { status: 500 });

  const auditError = await auditOrNull(ctx, {
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: `hq_end_appointment_${status}`, entity_type: "ogs_office_appointment", entity_id: appointmentId,
    entity_name: (appt as any).person_name ?? (appt as any).person_id, hospital_id: null,
    old_value: { status: (appt as any).status, position: (appt as any).role },
    new_value: { status, position: (appt as any).role },
  });

  return NextResponse.json({ ok: true, id: appointmentId, status: (upd as any).status, audit_error: auditError });
}
