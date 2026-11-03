import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { saveScoring } from "@/lib/assessment/studio/write";
import { copyScoringTemplate, validateInstrument } from "@/lib/assessment/studio/service";
import { isUuid, mustHold, refuse } from "@/lib/assessment/studio/api";
import { applyProfileToDraft, proposeFromWorkbook } from "@/lib/assessment/import/propose";
import { PROFILES, type ProfileId } from "@/lib/assessment/import/profiles";

export const dynamic = "force-dynamic";

// /api/hq/checklist-studio/versions/[versionId]/scoring -- Checklist Studio (S2). Author capability.
//   PUT  { scoring, tests, templateVersionId? }  stores the rules document, scoring_hash = hashDoc(scoring) and the saved tests.
//        A draft is saved even while it has problems (work in progress is not thrown away) and the engine validation comes back in
//        the response. Putting the version forward for review is where problems are refused (422).
//   POST { action: "copy_template", templateVersionId }  copies a PUBLISHED scoring template and re-validates it against this checklist.
//   POST { action: "propose_from_workbook" }  for a draft imported from a workbook: writes the deterministic proposed rules, tests and
//        delivery mode from the stored source (owner GO 3 Nov 2026), marked as proposed until the author accepts them. Draft only.
//   POST { action: "apply_profile", profileId }  applies a scoring profile (ASMT-SCORING-INTEGRATION-01, owner GO 4 Nov 2026:
//        graded_assessment, weighted_agreement, weighted_compliance) to a draft: option values, N/A with a reason, mandatory,
//        evidence fields, rules + tests (proposed), delivery mode when none is set. For the graded profile it also makes sure the
//        SEPARATE proposed competency decision exists as a draft rule template. Draft only.

export async function PUT(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  if (!isUuid(versionId)) return refuse(400, "Choose a version.");
  const b = await req.json().catch(() => ({}));
  const r = await saveScoring(ctx.admin, ctx.userId, versionId, b?.scoring, Array.isArray(b?.tests) ? b.tests : [], isUuid(b?.templateVersionId) ? b.templateVersionId : null);
  if (!r.ok) return refuse(r.status, r.error);
  const v = await validateInstrument(ctx.admin, versionId, null, false);
  return NextResponse.json({ ok: true, scoringHash: r.scoringHash, validation: v?.report ?? null });
}

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.author]));
  if (isHqRefusal(ctx)) return ctx;
  const denied = mustHold(ctx, CAP.author);
  if (denied) return denied;
  const { versionId } = await params;
  const b = await req.json().catch(() => ({}));
  if (isUuid(versionId) && b?.action === "apply_profile") {
    const id = typeof b.profileId === "string" && b.profileId in PROFILES ? (b.profileId as ProfileId) : null;
    if (!id) return refuse(400, "Choose a scoring profile.");
    const r = await applyProfileToDraft(ctx.admin, ctx.userId, versionId, id);
    return r.ok ? NextResponse.json(r) : refuse(r.status, r.error);
  }
  if (isUuid(versionId) && b?.action === "propose_from_workbook") {
    const p = await proposeFromWorkbook(ctx.admin, ctx.userId, versionId);
    return p.ok ? NextResponse.json(p) : NextResponse.json({ error: p.error, flags: p.flags ?? [] }, { status: p.status });
  }
  if (!isUuid(versionId) || b?.action !== "copy_template" || !isUuid(b?.templateVersionId)) return refuse(400, "Choose a published scoring template.");
  const r = await copyScoringTemplate(ctx.admin, ctx.userId, versionId, b.templateVersionId);
  return r.ok ? NextResponse.json(r) : refuse(r.status, r.error);
}
