import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { QUESTION_MAX } from "@/lib/individual/scholar/config";
import { audit } from "@/lib/individual/scholar/http";
import { ORIGIN_LABEL, RETRIEVED_LABEL, parseRecoveryMode, recoverEvidence } from "@/lib/individual/scholar/evidence-recovery";
import { paperQuestionForRecovery } from "@/lib/individual/scholar/exam-service";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/individual/scholar/evidence/recover -- SCHOLAR-SQIE-02 s5-8 (evidence recovery).
//
// Body { question, materialId?, sectionId?, mode?, withheldReason?, paperQuestionId? }. mode: notes_only |
// notes_and_library | notes_and_references (Learn's notes | library | research are read the same); absent: HQ's default.
// With paperQuestionId (a question of an examination paper) the question is the server's own text for it, and the paper
// itself is never searched as evidence. Searches the learner's own notes, then the approved Competen library, then --
// only for notes_and_references, and only where HQ and the Research & Evidence Engine allow it -- external scholarly
// sources, which receive topic keywords only (names, numbers and dates removed), never the notes. NO AI CALL: it returns
// evidence, a deterministic sufficiency verdict and the actions to offer. "Explain using approved references" then goes
// to the route the learner was using, with only the recovery's id, mode and question: that route finds the evidence
// again itself (evidence-recovery rederiveRecovery). The audit and outcome rows hold codes and counts, never the question.

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const paper = isUuid(body?.paperQuestionId) ? await paperQuestionForRecovery(ctx, body.paperQuestionId) : null;
  if (body?.paperQuestionId !== undefined && body?.paperQuestionId !== null && !paper) return NextResponse.json({ error: "That question could not be found." }, { status: 404 });
  const raw = paper ? paper.text : typeof body?.question === "string" ? body.question : "";
  const question = raw.replace(/\s+/g, " ").trim().slice(0, paper ? QUESTION_MAX : undefined);
  if (!question || question.length > QUESTION_MAX) return NextResponse.json({ error: `Ask a question of up to ${QUESTION_MAX} characters.` }, { status: 400 });
  if (findPatientIdentifiers(question).length) return NextResponse.json({ error: "That looks like it identifies a patient. Remove it and try again." }, { status: 422 });
  const policy = await loadIndividualPolicy(ctx.admin);
  const mode = parseRecoveryMode(body?.mode, policy.scholarRecovery.defaultMode);
  const withheldReason = typeof body?.withheldReason === "string" ? body.withheldReason.slice(0, 40) : null;

  const r = await recoverEvidence(ctx, policy, {
    question, mode, withheldReason,
    materialId: paper?.materialId ?? (isUuid(body?.materialId) ? body.materialId : null), sectionId: isUuid(body?.sectionId) ? body.sectionId : null,
    excludeMaterialId: paper?.materialId ?? null,
  });
  await audit(ctx, "scholar_evidence_recovery", "individual_scholar_evidence_recovery", null, {
    recovery_id: r.recoveryId, question_chars: question.length, mode, state: r.state, verdict: r.sufficiency.verdict, paper: !!paper,
    notes: r.evidence.notes.length, library: r.evidence.library.length, external: r.evidence.external.length, reading: r.reading.length,
    external_status: r.external.reason, external_dropped: r.external.dropped,
  });
  // The generation inputs stay on the server: an explanation re-derives them, so the browser never holds evidence to send back.
  const { generation: _g, ...shown } = r;
  void _g;
  return NextResponse.json({ ...shown, question, labels: { origin: ORIGIN_LABEL, retrieved: RETRIEVED_LABEL } });
}
