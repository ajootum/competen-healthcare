import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { loadReviewerPack, renderPackDocx } from "@/lib/competency/review-pack";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/hq/clinical-review/pack -- the reviewer's clinical review pack as an editable Word file (owner, 29 Oct 2026).
//
// ⚠ GATED BY hqApiGate(["hq.quality.clinical.approve"]), the Clinical Content Reviewer, and it holds EXACTLY that
// reviewer's current queue (reviewQueue: in scope, independent, current versions). Read only. Paper is for notes: a
// decision counts only when recorded in Competen against the version the pack shows (src/lib/competency/review-pack.ts).

export async function GET() {
  const ctx = await hqApiGate(["hq.quality.clinical.approve"]);
  if (isHqRefusal(ctx)) return ctx;
  const pack = await loadReviewerPack(ctx.admin, { id: ctx.userId, name: ctx.fullName ?? null });
  if (!pack) return NextResponse.json({ error: "Your review queue could not be read just now." }, { status: 503 });
  const buf = await renderPackDocx(pack);
  return new NextResponse(new Uint8Array(buf), { status: 200, headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="clinical-review-pack-${new Date().toISOString().slice(0, 10)}.docx"`,
    "Cache-Control": "no-store",
  } });
}
