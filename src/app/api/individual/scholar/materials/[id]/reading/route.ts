export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { recheckSlides } from "@/lib/individual/scholar/slide-reading";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/materials/[id]/reading -- SCHOLAR-PPTX-READING-01.
//
// Check what each slide of the caller's own stored PowerPoint holds. No AI. Only the material's quality record changes: no section,
// lesson, plan, answer or AI reading is touched, so it can be run again safely. Another person's id is a 404.
export async function POST(_req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const out = await recheckSlides(ctx, id);
  return NextResponse.json(out.body, { status: out.status });
}
