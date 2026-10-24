import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isPlayKind, revealPlay } from "@/lib/individual/scholar/clinical-routes";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/clinical/sessions/[kind]/[id]/reveal { factToken } -- CR2: ask for a finding. Only one
// the current decision permits; the case never reveals anything it does not hold. No AI.

export async function POST(req: Request, ctx2: { params: Promise<{ kind: string; id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { kind, id } = await ctx2.params;
  if (!isPlayKind(kind)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.factToken !== "string" || body.factToken.length > 64) return NextResponse.json({ error: "Ask for one of the findings offered." }, { status: 400 });
  const r = await revealPlay(ctx.admin, ctx.userId, kind, id, body.factToken, body?.hints === true);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: (r as { status?: number }).status ?? 400 });
  return NextResponse.json({ play: r });
}
