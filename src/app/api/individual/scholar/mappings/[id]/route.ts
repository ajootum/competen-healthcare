import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { decideMapping } from "@/lib/individual/scholar/store";
import { audit } from "@/lib/individual/scholar/http";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/mappings/[id] -- COMPETEN-SCHOLAR-01 S2, accept or reject a proposal.
//
// Body { decision: "accepted" | "rejected", reason? }. A new row in the append-only decision trail, never
// an edit: changing your mind is another decision, and every one is kept. The mapping is looked up by the
// caller's own id, so another person's mapping answers 404.

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const body = await req.json().catch(() => ({}));
  const decision = body?.decision === "accepted" || body?.decision === "rejected" ? body.decision : null;
  if (!decision) return NextResponse.json({ error: "Accept or reject." }, { status: 400 });
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;
  const r = await decideMapping(ctx.admin, ctx.userId, id, decision, reason);
  if (r === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (r === "failed") return NextResponse.json({ error: "Your choice could not be saved just now. Try again shortly." }, { status: 500 });
  await audit(ctx, "individual_scholar_mapping_decided", "individual_scholar_competency_map", id, { decision, with_reason: reason !== null });
  return NextResponse.json({ ok: true, state: decision });
}
