import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { addPassportEvaluation, isUuid, removePassportEvaluation } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { audit } from "@/lib/individual/scholar/http";
import { PASSPORT_LABEL_MAX } from "@/lib/individual/scholar/passport-items";

// Request-time only: it reads the release gate, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/individual/scholar/passport-evaluations -- COMPETEN-SCHOLAR-PROGRESS-01 P5.
// POST { evaluationId, label } shows one of the student's kept evaluations in their Passport (427), with their label,
// as an educational evaluation: formative, never verified. DELETE { evaluationId } takes it off; the evaluation stays.
// Nothing is in the Passport unless the student chooses it. Owner-keyed: another person's evaluation answers 404.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if ((await loadIndividualPolicy(ctx.admin)).scholarPassportEvaluations !== "offer") return NextResponse.json({ error: "Showing evaluations in the Passport is not offered here." }, { status: 403 });
  const label = typeof body?.label === "string" ? body.label.replace(/\s+/g, " ").trim() : "";
  if (label.length < 1 || label.length > PASSPORT_LABEL_MAX) return NextResponse.json({ error: `Name it in up to ${PASSPORT_LABEL_MAX} characters.` }, { status: 400 });
  if (findPatientIdentifiers(label).length) return NextResponse.json({ error: "That name looks like it identifies a patient. Choose another." }, { status: 422 });
  if (!isUuid(body?.evaluationId)) return NextResponse.json({ error: "Choose an evaluation." }, { status: 400 });
  const r = await addPassportEvaluation(ctx.admin, ctx.userId, body.evaluationId, label);
  if (!r.ok) return NextResponse.json({ error: r.notFound ? "Not found" : r.notProvisioned ? "Showing evaluations in the Passport is not available here yet." : "It could not be added just now." }, { status: r.notFound ? 404 : r.notProvisioned ? 409 : 500 });
  await audit(ctx, "individual_scholar_passport_evaluation_shown", "individual_scholar_evaluation", body.evaluationId, {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (!isUuid(body?.evaluationId)) return NextResponse.json({ error: "Choose an evaluation." }, { status: 400 });
  if (!(await removePassportEvaluation(ctx.admin, ctx.userId, body.evaluationId))) return NextResponse.json({ error: "It could not be taken off just now." }, { status: 500 });
  await audit(ctx, "individual_scholar_passport_evaluation_removed", "individual_scholar_evaluation", body.evaluationId, {});
  return NextResponse.json({ ok: true });
}
