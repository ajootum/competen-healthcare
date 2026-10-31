/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { publishScope, setOverride } from "@/lib/config/workspace-config-write";
import { CASE_LIBRARY_OFF, CASE_POLICY_PATH, CASE_SCOPE, caseLibraryEnabled, resolveCasePolicy } from "@/lib/cases/policy";
import {
  createCase, declineCandidate, deleteDraft, draftCaseWithAi, newDraft, promoteCandidate, publishCase, releaseCandidate, retireCase, saveDraft,
  submitCase, takeCandidate,
} from "@/lib/cases/studio";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/cases -- COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s8, s9, s13 (C2, C3), migrations 422-423.
//
// Body: { action, ...args }. Each action's capability is fixed HERE, server-side:
//   hq.quality.case.author   (Clinical Case Educator)  take, release, decline, promote, create, new_draft, delete_draft,
//                                                      save, submit, ai_draft
//   hq.quality.case.publish  (Quality Council Member)  publish, retire, policy_draft, policy_publish
// Clinical approval is NOT here: it is /api/hq/clinical-review (hq.quality.clinical.approve) and the 395 trigger.
//
// ⚠ NOTHING THE BROWSER SENDS PICKS AN OWNER, A BUDGET, A COST, A STATE OR AN AUTHOR. The educator is the session's
// person. AI drafting resolves its budget from the workflow on the server. Every action is audited.

const AUTHOR = ["take", "release", "decline", "promote", "create", "new_draft", "delete_draft", "save", "submit", "ai_draft"] as const;
const PUBLISH = ["publish", "retire", "policy_draft", "policy_publish"] as const;
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const capability = (AUTHOR as readonly string[]).includes(action) ? "hq.quality.case.author" : (PUBLISH as readonly string[]).includes(action) ? "hq.quality.case.publish" : null;
  if (!capability) return refuse(400, "Unknown action.");
  const ctx = await hqApiGate([capability]);
  if (isHqRefusal(ctx)) return ctx;
  // The gate: off (unwritten, unreadable, or off) refuses every studio and publication action.
  if (!(await caseLibraryEnabled(ctx.admin))) return refuse(409, CASE_LIBRARY_OFF);
  const me = ctx.userId;
  const trace = await currentTraceId();
  const audit = (entityType: string, entityId: string | null, value: Record<string, unknown>) => ctx.admin.from("audit_log").insert({
    trace_id: trace, actor_id: me, actor_name: ctx.fullName ?? null, action: `case_${action}`, entity_type: entityType, entity_id: entityId, new_value: value,
  }).then((x: unknown) => x, () => {});

  let r: any;
  switch (action) {
    case "take": r = await takeCandidate(ctx.admin, me, str(body.candidateId)); if (r.ok) await audit("case_candidate", str(body.candidateId), {}); break;
    case "release": r = await releaseCandidate(ctx.admin, me, str(body.candidateId)); if (r.ok) await audit("case_candidate", str(body.candidateId), {}); break;
    case "decline": r = await declineCandidate(ctx.admin, me, str(body.candidateId), str(body.reason, 500)); if (r.ok) await audit("case_candidate", str(body.candidateId), { reason: str(body.reason, 500) }); break;
    case "promote": r = await promoteCandidate(ctx.admin, me, str(body.candidateId), { code: str(body.code, 45), title: str(body.title) || null });
      if (r.ok) { await audit("case_library_case", r.caseId, { from_candidate: str(body.candidateId) }); await audit("case_library_version", r.versionId, { origin: "candidate" }); } break;
    case "create": r = await createCase(ctx.admin, me, { code: str(body.code, 45), title: str(body.title) });
      if (r.ok) { await audit("case_library_case", r.caseId, {}); await audit("case_library_version", r.versionId, { origin: "educator" }); } break;
    case "new_draft": r = await newDraft(ctx.admin, me, str(body.caseId), body.kind === "variation" ? "variation" : "revision"); if (r.ok) await audit("case_library_version", r.versionId, { case: str(body.caseId), kind: body.kind }); break;
    case "delete_draft": r = await deleteDraft(ctx.admin, str(body.versionId)); if (r.ok) await audit("case_library_version", str(body.versionId), {}); break;
    case "save": r = await saveDraft(ctx.admin, me, str(body.versionId), body.content); if (r.ok) await audit("case_library_version", str(body.versionId), { problems: r.problems.length }); break;
    case "submit": r = await submitCase(ctx.admin, me, str(body.versionId)); if (r.ok) await audit("case_library_version", str(body.versionId), { review_version: r.reviewVersionId, required: r.required }); break;
    case "ai_draft": r = await draftCaseWithAi(ctx.admin, me, { brief: str(body.brief, 4000), competencyIds: Array.isArray(body.competencyIds) ? body.competencyIds.map((x: unknown) => str(x, 40)) : [],
        level: ["foundation", "intermediate", "advanced"].includes(body.level) ? body.level : "intermediate", risk: body.risk === "high" ? "high" : "standard", requestKey: str(body.requestKey, 40),
        professionTermIds: Array.isArray(body.professionTermIds) ? body.professionTermIds.map((x: unknown) => str(x, 40)) : [] });
      if (r.ok) await audit("case_library_case", null, { workflow: "case.educator_develop" }); break;
    case "publish": r = await publishCase(ctx.admin, me, str(body.versionId)); if (r.ok) await audit("case_library_version", str(body.versionId), {}); break;
    case "retire": r = await retireCase(ctx.admin, str(body.caseId)); if (r.ok) await audit("case_library_case", str(body.caseId), {}); break;
    case "policy_draft": {
      const w = await setOverride(ctx.admin, { userId: me, name: ctx.fullName ?? null }, CASE_SCOPE, CASE_POLICY_PATH, resolveCasePolicy(body.policy));
      r = w.ok ? { ok: true } : { ok: false, error: "The case policy draft could not be saved." }; break;
    }
    case "policy_publish": {
      const w = await publishScope(ctx.admin, { userId: me, name: ctx.fullName ?? null }, CASE_SCOPE, { label: "Case policy", note: str(body.note, 300) || null });
      r = w.ok ? { ok: true } : { ok: false, error: "The case policy could not be published." }; break;
    }
  }
  if (!r?.ok) return refuse(409, r?.error ?? "That could not be done.", r?.problems ? { problems: r.problems } : {});
  return NextResponse.json(r);
}
