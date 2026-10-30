import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { QUESTION_MAX } from "@/lib/individual/scholar/config";
import { audit } from "@/lib/individual/scholar/http";
import { ORIGIN_LABEL, RETRIEVED_LABEL, parseRecoveryMode, recoverEvidence } from "@/lib/individual/scholar/evidence-recovery";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/evidence/recover -- SCHOLAR-SQIE-02 s5-8 (evidence recovery).
//
// Body { question, materialId?, sectionId?, mode?, withheldReason? }. mode: notes_only | notes_and_library |
// notes_and_references (Learn's notes | library | research are read the same); absent: HQ's default. Searches the
// learner's own notes, then the approved Competen library, then -- only for notes_and_references, and only where HQ and
// the Research & Evidence Engine allow it -- external scholarly sources, which receive topic keywords only (names,
// numbers and dates removed), never the notes. NO AI CALL: it returns evidence, a deterministic sufficiency verdict and
// the actions to offer. An explanation from the evidence is the caller's own AI activity, through its own checks.
// The audit row and the outcome row hold codes and counts only, never the question.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const question = typeof body?.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  if (findPatientIdentifiers(question).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);
  const mode = parseRecoveryMode(body?.mode, policy.scholarRecovery.defaultMode);
  const withheldReason = typeof body?.withheldReason === "string" ? body.withheldReason.slice(0, 40) : null;

  const r = await recoverEvidence(ctx, policy, {
    question, mode, materialId: isUuid(body?.materialId) ? body.materialId : null, sectionId: isUuid(body?.sectionId) ? body.sectionId : null, withheldReason,
  });
  await audit(ctx, "scholar_evidence_recovery", "individual_scholar_evidence_recovery", null, {
    recovery_id: r.recoveryId, question_chars: question.length, mode, state: r.state, verdict: r.sufficiency.verdict,
    notes: r.evidence.notes.length, library: r.evidence.library.length, external: r.evidence.external.length, reading: r.reading.length,
    external_status: r.external.reason, external_dropped: r.external.dropped,
  });
  return NextResponse.json({ ...r, labels: { origin: ORIGIN_LABEL, retrieved: RETRIEVED_LABEL } });
}
