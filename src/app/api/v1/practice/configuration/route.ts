import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  getConfiguration, updateConfiguration, configurationHistory,
  listLocations, createLocation, updateLocation,
} from "@/lib/practice/configuration";

// GET   /api/v1/practice/configuration -- settings, locations and the trail behind them.
// PATCH /api/v1/practice/configuration -- { settings: {...} }
// POST  /api/v1/practice/configuration -- { location: {...} } add one
// PUT   /api/v1/practice/configuration -- { locationId, ... } rename, retype or close one
//
// Settings need practice.settings.manage; locations need practice.locations.manage. Both have existed
// on the owner role since migration 191 -- CPR-360 is the route arriving, not a new permission.

export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  const [configuration, locations, history] = await Promise.all([
    getConfiguration(auth.caller.admin, auth.ctx.workspaceId),
    listLocations(auth.caller.admin, auth.ctx.workspaceId),
    configurationHistory(auth.caller.admin, auth.ctx.workspaceId),
  ]);
  if (!configuration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...configuration, locations, history, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const s = body.settings ?? {};

  const result = await updateConfiguration(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    practiceName: s.practiceName !== undefined ? String(s.practiceName) : undefined,
    timezone: s.timezone !== undefined ? String(s.timezone) : undefined,
    locale: s.locale !== undefined ? String(s.locale) : undefined,
    defaultEncounterMode: s.defaultEncounterMode !== undefined ? String(s.defaultEncounterMode) : undefined,
    defaultAppointmentMinutes: typeof s.defaultAppointmentMinutes === "number" ? s.defaultAppointmentMinutes : undefined,
    // CPR-330 practice branding. String(...) rather than a truthiness check, so "" reaches the engine
    // and clears the field -- a practice must be able to remove a registration number it mistyped.
    letterheadName: s.letterheadName !== undefined ? String(s.letterheadName) : undefined,
    letterheadRegistration: s.letterheadRegistration !== undefined ? String(s.letterheadRegistration) : undefined,
    letterheadAddress: s.letterheadAddress !== undefined ? String(s.letterheadAddress) : undefined,
    letterheadContact: s.letterheadContact !== undefined ? String(s.letterheadContact) : undefined,
    letterheadFooter: s.letterheadFooter !== undefined ? String(s.letterheadFooter) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ settings: result.data, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.locations.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const l = body.location ?? {};

  const result = await createLocation(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, name: String(l.name ?? ""),
    type: l.type ? String(l.type) : undefined, country: l.country ? String(l.country) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ location: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requirePracticeContext("practice.locations.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.locationId) return NextResponse.json({ error: "locationId is required" }, { status: 400 });

  const result = await updateLocation(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, locationId: String(body.locationId),
    name: body.name !== undefined ? String(body.name) : undefined,
    type: body.type !== undefined ? String(body.type) : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ location: result.data, correlationId: auth.caller.traceId });
}
