import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordDiagnosisBatch, MAX_PENDING_DIAGNOSES } from "@/lib/practice/diagnosis-capture";

// POST /api/v1/practice/encounters/{id}/diagnoses/batch -- CP-ENC-DIAG-001's working set.
//
// ⚠ A SEPARATE ROUTE RATHER THAN AN ARRAY ON THE EXISTING ONE. The single-diagnosis POST is what the old
// form, the API consumers and several harness assertions speak, and overloading its body to mean two
// different things would make every one of them a guess about which path ran. This one is additive:
// nothing that worked before changes shape.
//
// ⚠ SAME CAPABILITY AS THE SINGLE ROUTE. diagnosis.record, not encounter.edit -- a batch endpoint that
// gated differently would be a second answer to who may write a clinical record.
//
// ⚠ AND IT RETURNS PER-ITEM OUTCOMES EVEN WHEN SOME FAILED. The engine records what it can and reports
// the rest; a flat error would tell the screen that four saved diagnoses do not exist because the fifth
// was refused, and the practitioner would enter them all again.

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("diagnosis.record");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length === 0)
    return NextResponse.json({ error: { code: "NO_ITEMS", message: "there is nothing in the working set" } }, { status: 400 });
  // Refused rather than truncated: a set quietly cut would look like it recorded everything.
  if (raw.length > MAX_PENDING_DIAGNOSES)
    return NextResponse.json({
      error: {
        code: "TOO_MANY_ITEMS",
        message: `${raw.length} diagnoses were submitted and one encounter takes at most ${MAX_PENDING_DIAGNOSES}`,
      },
    }, { status: 422 });

  const result = await recordDiagnosisBatch(auth.caller.admin, auth.ctx, {
    encounterId,
    items: (raw as Record<string, unknown>[]).map(r => ({
      label: String(r.label ?? ""),
      code: r.code ? String(r.code) : null,
      codeSystem: r.codeSystem ? String(r.codeSystem) : null,
      // ⚠ PASSED THROUGH UNVALIDATED ON PURPOSE. The engine refuses an unknown certainty by name; a
      // route that silently defaulted it would put a clinical qualifier nobody chose onto the record.
      certainty: r.certainty ? String(r.certainty) : null,
      isPrimary: r.isPrimary === true,
      keepAsProblem: r.keepAsProblem === true,
      existingProblemId: r.existingProblemId ? String(r.existingProblemId) : null,
    })),
    actorId: auth.caller.userId,
    correlationId: auth.caller.traceId,
  });

  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // 207 when some items failed: a flat 200 tells a retrying client everything landed.
  const failed = result.data.results.filter(r => !r.ok).length;
  return NextResponse.json(
    { ...result.data, correlationId: auth.caller.traceId },
    { status: failed > 0 && result.data.recorded > 0 ? 207 : (result.data.recorded > 0 ? 201 : 422) },
  );
}
