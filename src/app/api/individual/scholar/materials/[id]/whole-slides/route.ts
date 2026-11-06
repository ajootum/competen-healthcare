export const maxDuration = 300;

import { after, NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { startWholeSlides } from "@/lib/individual/scholar/slide-render-io";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/materials/[id]/whole-slides -- SCHOLAR-VISUAL-001 phase 2.
//
// Starts drawing the slides of the caller's own PowerPoint, if policy scholar_whole_slides allows it and it has not been done. It answers at
// once and the drawing carries on after the answer, for up to the five minutes above. At most once per material. No AI, and the file goes to no
// other service. Another person's id is a 404.
export async function POST(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const { out, run } = await startWholeSlides(ctx, id);
  if (run) after(run);
  return NextResponse.json(out.body, { status: out.status, headers: { "Cache-Control": "private, no-store" } });
}
