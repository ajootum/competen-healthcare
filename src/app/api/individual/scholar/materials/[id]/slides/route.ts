// One AI transcription call (two slides) per request; the page calls until none remain.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { readPictureSlides, slideOriginalImage } from "@/lib/individual/scholar/slide-reading";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/materials/[id]/slides -- SCHOLAR-UPLOAD-FIX.
//
// The learner asks for the picture-only slides of their own PowerPoint to be read by AI (slide-reading.ts: policy
// scholar_material_image_slides, AI consent, the existing transcription runner, the upload's patient-identifier
// screen, labelled sections). The material is read by the caller's own id: another person's id is a 404.

export async function POST(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const out = await readPictureSlides(ctx, req, id);
  return NextResponse.json(out.body, { status: out.status });
}

// GET ?slide=N -- the first picture on that slide of the caller's own PowerPoint, to compare with a section read by AI.
export async function GET(req: Request, ctx2: { params: Promise<{ id: string }> }) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const { id } = await ctx2.params;
  const slide = Number(new URL(req.url).searchParams.get("slide"));
  const r = await slideOriginalImage(ctx, id, slide);
  if (!r.bytes) return NextResponse.json({ error: r.error ?? "Not found" }, { status: r.status });
  return new Response(Buffer.from(r.bytes), { status: 200, headers: { "Content-Type": r.type ?? "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
