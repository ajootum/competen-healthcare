// Allow up to 300s: filling a shortfall may write a few small sets of questions through the existing revision route.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { startMonthlyReview } from "@/lib/individual/scholar/monthly-review-data";

// Request-time only: it reads the release gate and the evidence, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/monthly-review -- SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026).
//
// POST { month: "YYYY-MM", retakeOf?: <evaluationId> } prepares the monthly learning review of that month (this month or an earlier
// one: a late review is allowed and said) and returns the Mock sitting to take, with the exact blueprint it was built from.
//   STORED FIRST. Questions come from the learner's own stored questions by the blueprint (core knowledge, application, earlier gaps).
//   A shortfall is written only by the EXISTING revision route (its consent, allowance and checks), only where policy allows new
//   questions and the learner's AI standing says they are available. Otherwise a shorter review runs, and the notes say so.
//   NO new AI call path, no migration. The review is kept as an evaluation when the sitting ends (POST /evaluations, scope month).
// Optional and formative: never verified competence. Nothing waits on it.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const policy = await loadIndividualPolicy(ctx.admin);
  const r = await startMonthlyReview(ctx, req, policy, { month: String(body?.month ?? ""), retakeOf: body?.retakeOf, today: new Date().toISOString().slice(0, 10) });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({
    session: { id: r.sessionId, mode: "mock", feedback: "end", total: r.asked }, evscope: r.evscope,
    asked: r.asked, planned: r.blueprint.length, stored: r.stored, written: r.written, shorter: r.shorter, notes: r.notes,
  });
}
