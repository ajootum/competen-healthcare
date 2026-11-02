import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { materialVisuals } from "@/lib/individual/scholar/material-visuals-io";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/materials/[id]/visuals -- SCHOLAR-LESSON-VISUALS-01.
//
// The original pictures of the caller's own PowerPoint slides (and the image-only pages of their own PDF), judged by fixed
// rules and no AI (material-visuals.ts). Read-only. The material is read by the caller's own id: another person's id is a 404.
// Policy scholar_lesson_visuals off answers { visuals: [], off: true }.

export async function GET(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const out = await materialVisuals(ctx, id);
  return NextResponse.json(out.body, { status: out.status, headers: { "Cache-Control": "private, no-store" } });
}
