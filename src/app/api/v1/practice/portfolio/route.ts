import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  buildPortfolio, exportPortfolio, getProfile, saveProfile, addEntry, removeEntry,
  PORTFOLIO_KINDS, PORTFOLIO_LIMITS, PROVENANCE,
} from "@/lib/practice/portfolio";

// GET    /api/v1/practice/portfolio            -- the portfolio, with its coverage window
// GET    /api/v1/practice/portfolio?view=export -- the same, shaped for a document
// POST   /api/v1/practice/portfolio            -- add a declared entry
// PATCH  /api/v1/practice/portfolio            -- save the practitioner profile
// DELETE /api/v1/practice/portfolio?entryId=   -- remove a declared entry
//
// NO CAPABILITY. A portfolio is an account of your own work and nobody grants you permission to keep
// one; practice.home.view is the floor for being a member at all. Every query is scoped to the caller,
// so there is no parameter for whose portfolio to read.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  if (new URL(req.url).searchParams.get("view") === "export") {
    const result = await exportPortfolio(auth.caller.admin, auth.ctx, { correlationId: auth.caller.traceId });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  const portfolio = await buildPortfolio(auth.caller.admin, auth.ctx);
  return NextResponse.json({
    ...portfolio, kinds: PORTFOLIO_KINDS, limits: PORTFOLIO_LIMITS, provenance: PROVENANCE,
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await addEntry(auth.caller.admin, auth.ctx, {
    kind: String(body.kind ?? ""), title: String(body.title ?? ""),
    detail: body.detail ? String(body.detail) : undefined,
    organisation: body.organisation ? String(body.organisation) : undefined,
    occurredOn: body.occurredOn ? String(body.occurredOn) : null,
    expiresOn: body.expiresOn ? String(body.expiresOn) : null,
    reference: body.reference ? String(body.reference) : undefined,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ entry: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const str = (k: string) => body[k] === undefined ? undefined : String(body[k]);
  const result = await saveProfile(auth.caller.admin, auth.ctx, {
    fullName: str("fullName"), profession: str("profession"),
    specialty: str("specialty"), subSpecialty: str("subSpecialty"),
    registrationNumber: str("registrationNumber"), registrationBody: str("registrationBody"),
    registrationExpiresOn: body.registrationExpiresOn === undefined ? undefined : (body.registrationExpiresOn ? String(body.registrationExpiresOn) : null),
    practisingSince: body.practisingSince === undefined ? undefined : (body.practisingSince ? String(body.practisingSince) : null),
    summary: str("summary"), correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  const profile = await getProfile(auth.caller.admin, auth.ctx);
  return NextResponse.json({ profile, correlationId: auth.caller.traceId });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("practice.home.view");
  if (isDenied(auth)) return auth;

  const entryId = new URL(req.url).searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });

  const result = await removeEntry(auth.caller.admin, auth.ctx, { id: entryId, correlationId: auth.caller.traceId });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
