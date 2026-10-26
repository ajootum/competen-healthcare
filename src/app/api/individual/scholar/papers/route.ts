// Reading a paper and, where policy allows, transcribing its scanned pages: up to the revision ceiling.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/scholar/store";
import { preparePaper } from "@/lib/individual/scholar/exam-service";

export const dynamic = "force-dynamic";

// POST /api/individual/scholar/papers -- COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570). Body { materialId, attested, transcribe? }.
// Study one of the student's own materials as a past or practice examination paper: its structure is read (no AI)
// and kept with the practice-paper attestation. Scanned pages are transcribed only where policy turns that on and
// the student asked, with their AI consent. Idempotent: a paper already prepared answers { existing: true }.
export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.materialId)) return NextResponse.json({ error: "Choose one of your materials." }, { status: 400 });
  const r = await preparePaper(ctx, req, body.materialId, { attested: body?.attested === true, transcribe: body?.transcribe === true });
  return NextResponse.json(r.body, { status: r.status });
}