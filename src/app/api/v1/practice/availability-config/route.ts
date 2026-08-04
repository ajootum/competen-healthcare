import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  addClinic, addSession, removeSession, addException, setBookingRule, generateSlots,
  editSession, duplicateSession,
} from "@/lib/practice/availability-config";

// CPR-SET-002 v4 — the write door for locations, clinics, availability and booking rules.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY WRITE THAT CHANGES WHAT IS BOOKABLE REGENERATES ITS OWN WINDOW BEFORE RETURNING.
//
// The specification's acceptance criterion is "booking engine updates immediately after changes", and
// the only honest reading of "immediately" is that the response cannot come back before the diary
// agrees with the change. A background job would be a promise; a button labelled "regenerate" would put
// the work on the practitioner and leave the diary wrong until they pressed it.
//
// Generation is idempotent, so doing it on every write costs a re-read rather than a duplicate.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** How far forward a write regenerates. Named here rather than buried: it is a real limit. */
const REGENERATE_DAYS = 90;

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("appointment.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const admin = auth.caller.admin;
  const ctx = auth.ctx;
  const actorId = auth.caller.userId;
  const correlationId = auth.caller.traceId;

  const regenerate = async () => generateSlots(admin, ctx, {
    fromDate: today(), toDate: plusDays(REGENERATE_DAYS), actorId, correlationId,
  });

  switch (body.action) {
    case "add_clinic": {
      const r = await addClinic(admin, ctx, {
        locationId: String(body.locationId ?? ""), name: String(body.name ?? ""),
        consultationMode: body.consultationMode ? String(body.consultationMode) : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ clinic: r.data, correlationId }, { status: 201 });
    }

    case "add_session": {
      const r = await addSession(admin, ctx, {
        locationId: body.locationId ? String(body.locationId) : null,
        clinicId: body.clinicId ? String(body.clinicId) : null,
        weekday: Number(body.weekday), startsMinute: Number(body.startsMinute), endsMinute: Number(body.endsMinute),
        slotKind: body.slotKind ? String(body.slotKind) : undefined,
        appointmentMinutes: body.appointmentMinutes ? Number(body.appointmentMinutes) : null,
        note: body.note ? String(body.note) : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      const gen = await regenerate();
      return NextResponse.json({ session: r.data, generation: gen.ok ? gen.data : null, correlationId }, { status: 201 });
    }

    // CPR-SETUP-003: edit, move, suspend and reopen are ONE action with different arguments, exactly as
    // the engine models them -- four route branches would be four places to forget the conflict check.
    case "edit_session": {
      const r = await editSession(admin, ctx, {
        templateId: String(body.templateId ?? ""),
        weekday: body.weekday != null ? Number(body.weekday) : undefined,
        startsMinute: body.startsMinute != null ? Number(body.startsMinute) : undefined,
        endsMinute: body.endsMinute != null ? Number(body.endsMinute) : undefined,
        locationId: body.locationId !== undefined ? (body.locationId ? String(body.locationId) : null) : undefined,
        slotKind: body.slotKind ? String(body.slotKind) : undefined,
        capacity: body.capacity !== undefined && body.capacity !== "" ? Number(body.capacity) : undefined,
        status: body.status ? String(body.status) as "active" | "suspended" | "closed" : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      const gen = await regenerate();
      return NextResponse.json({ session: r.data, generation: gen.ok ? gen.data : null, correlationId });
    }

    case "duplicate_session": {
      const r = await duplicateSession(admin, ctx, {
        templateId: String(body.templateId ?? ""),
        toWeekdays: Array.isArray(body.toWeekdays) ? body.toWeekdays.map(Number) : [],
        locationId: body.locationId !== undefined ? (body.locationId ? String(body.locationId) : null) : undefined,
        startsMinute: body.startsMinute != null ? Number(body.startsMinute) : undefined,
        endsMinute: body.endsMinute != null ? Number(body.endsMinute) : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      const gen = await regenerate();
      // PARTIAL SUCCESS IS A REAL OUTCOME HERE and is returned as one: copying to three days where one
      // clashes must report two created and one refused, not a single yes or no.
      return NextResponse.json({ duplicate: r.data, generation: gen.ok ? gen.data : null, correlationId }, { status: 201 });
    }

    case "remove_session": {
      const r = await removeSession(admin, ctx, { templateId: String(body.templateId ?? ""), actorId, correlationId });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      // The removal already reaped its own slots, obeying both guards. Reported so the screen can say
      // "two sessions were kept because somebody is booked into them" rather than silently keeping them.
      return NextResponse.json({ removed: r.data, correlationId });
    }

    case "add_exception": {
      const r = await addException(admin, ctx, {
        kind: String(body.kind ?? ""), fromDate: String(body.fromDate ?? ""), toDate: String(body.toDate ?? ""),
        locationId: body.locationId ? String(body.locationId) : null,
        startsMinute: body.startsMinute != null ? Number(body.startsMinute) : null,
        endsMinute: body.endsMinute != null ? Number(body.endsMinute) : null,
        reason: body.reason ? String(body.reason) : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      const gen = await regenerate();
      return NextResponse.json({ exception: r.data, generation: gen.ok ? gen.data : null, correlationId }, { status: 201 });
    }

    case "set_booking_rule": {
      const r = await setBookingRule(admin, ctx, {
        locationId: body.locationId ? String(body.locationId) : null,
        appointmentType: body.appointmentType ? String(body.appointmentType) : null,
        leadTimeMinutes: body.leadTimeMinutes != null ? Number(body.leadTimeMinutes) : undefined,
        bookingHorizonDays: body.bookingHorizonDays != null && body.bookingHorizonDays !== "" ? Number(body.bookingHorizonDays) : null,
        cancellationNoticeMinutes: body.cancellationNoticeMinutes != null ? Number(body.cancellationNoticeMinutes) : undefined,
        // null and 0 mean different things -- no limit, and none allowed.
        walkInDailyLimit: body.walkInDailyLimit != null && body.walkInDailyLimit !== "" ? Number(body.walkInDailyLimit) : null,
        emergencyReserveMinutes: body.emergencyReserveMinutes != null ? Number(body.emergencyReserveMinutes) : undefined,
        actorId, correlationId,
      });
      if (!r.ok) return NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
      return NextResponse.json({ rule: r.data, correlationId }, { status: 201 });
    }

    case "generate": {
      const gen = await generateSlots(admin, ctx, {
        fromDate: body.fromDate ? String(body.fromDate) : today(),
        toDate: body.toDate ? String(body.toDate) : plusDays(REGENERATE_DAYS),
        actorId, correlationId,
      });
      if (!gen.ok) return NextResponse.json({ error: { code: gen.code, message: gen.message } }, { status: gen.status });
      return NextResponse.json({ generation: gen.data, correlationId });
    }

    default:
      return NextResponse.json({
        error: "action must be one of: add_clinic, add_session, edit_session, duplicate_session, remove_session, add_exception, set_booking_rule, generate",
      }, { status: 400 });
  }
}
