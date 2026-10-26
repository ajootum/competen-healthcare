import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { addProfessionalFromScholar, professionalSelfAddEnabled } from "@/lib/individual/professional-add";

// Request-time only: it reads the gates and the session.
export const dynamic = "force-dynamic";

// POST /api/individual/professional-add -- PRODUCT-EXPERIENCE P5 (prepared, OFF). A Scholar member adds
// Competen Professional to the same account.
//
// ⚠ ORDER: the Individual guard for Scholar (release gate, session, membership, live Scholar, its terms), then the
// self-add flag -- 404 while it is off, before anything is read or written. The flag has no row in any
// environment until the owner turns it on.

export async function POST() {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  if (!(await professionalSelfAddEnabled(ctx.admin))) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  const out = await addProfessionalFromScholar(ctx.admin, ctx.userId);
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.status });
  return NextResponse.json({ ok: true, alreadyLive: out.alreadyLive, next: out.next });
}
