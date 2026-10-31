/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { CKRI_OFF, ckriEnabled } from "@/lib/knowledge/governance";
import { createResource, moveNeed, newVersion, publishVersion, raiseNeed, retireResource, retireVersion, reviewDraft, saveDraft, setCompetencies, submitDraft } from "@/lib/knowledge/educator";
import { declineLearnerOffer, takeLearnerOffer } from "@/lib/knowledge/learner-offers";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/knowledge/educator -- COMPETEN-KNOWLEDGE-RESEARCH-01 s5 (K3), migration 442.
//   hq.learning.ckri.educator     (Knowledge Educator)       need_raise, need_move, resource_create, draft_save,
//                                                            version_new, competencies_set, review, submit
//                                                            offer_take, offer_decline (learner offers, 802)
//   hq.quality.knowledge.publish  (Quality Council Member)   publish, retire, retire_version (one version, 801)
// Clinical approval is NOT here: it is /api/hq/clinical-review (hq.quality.clinical.approve) and the 442 trigger.
// ⚠ NOTHING THE BROWSER SENDS PICKS AN AUTHOR, A REVIEWER, AN ORIGIN, A STATE OR EVIDENCE. Every action is audited.

const EDUCATOR = ["need_raise", "need_move", "resource_create", "draft_save", "version_new", "competencies_set", "review", "submit", "offer_take", "offer_decline"] as const;
const PUBLISH = ["publish", "retire", "retire_version"] as const;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const capability = (EDUCATOR as readonly string[]).includes(action) ? "hq.learning.ckri.educator" : (PUBLISH as readonly string[]).includes(action) ? "hq.quality.knowledge.publish" : null;
  if (!capability) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const ctx = await hqApiGate([capability]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await ckriEnabled(ctx.admin))) return NextResponse.json({ error: CKRI_OFF }, { status: 409 });
  const me = ctx.userId;
  const fields = body?.fields && typeof body.fields === "object" ? body.fields : {};
  let r: any;
  switch (action) {
    case "need_raise": r = await raiseNeed(ctx.admin, me, { snapshotId: str(body.snapshotId, 40), subjectKind: str(body.subjectKind, 20), subjectRef: str(body.subjectRef, 40), cohort: str(body.cohort, 80), period: str(body.period, 10), summary: str(body.summary, 2000), responseKind: str(body.responseKind, 30) }); break;
    case "need_move": r = await moveNeed(ctx.admin, me, str(body.needId, 40), str(body.status, 20), { responseRef: str(body.responseRef, 40) || null, note: str(body.note, 2000) || null }); break;
    case "resource_create": r = await createResource(ctx.admin, me, { code: str(body.code, 61), kind: str(body.kind, 30), title: str(body.title), needId: str(body.needId, 40) || null, fields }); break;
    case "draft_save": r = await saveDraft(ctx.admin, me, str(body.versionId, 40), fields); break;
    case "version_new": r = await newVersion(ctx.admin, me, str(body.resourceId, 40)); break;
    case "competencies_set": r = await setCompetencies(ctx.admin, str(body.versionId, 40), Array.isArray(body.competencyIds) ? body.competencyIds.map((x: unknown) => str(x, 40)) : str(body.competencyIds ?? body.note, 2000).split(/[\s,]+/)); break;
    case "review": r = await reviewDraft(ctx.admin, me, str(body.versionId, 40)); break;
    case "submit": r = await submitDraft(ctx.admin, me, str(body.versionId, 40), { duplicatesChecked: body.duplicatesChecked === true }); break;
    case "publish": r = await publishVersion(ctx.admin, me, str(body.versionId, 40)); break;
    case "retire": r = await retireResource(ctx.admin, str(body.resourceId, 40)); break;
    case "retire_version": r = await retireVersion(ctx.admin, me, str(body.versionId, 40), str(body.note ?? body.reason, 500)); break;
    case "offer_take": r = await takeLearnerOffer(ctx.admin, me, str(body.offerId, 40), { code: str(body.code, 61), title: str(body.title) }); break;
    case "offer_decline": r = await declineLearnerOffer(ctx.admin, me, str(body.offerId, 40), str(body.note ?? body.reason, 500)); break;
  }
  if (!r?.ok) return NextResponse.json({ error: r?.error ?? "That could not be done." }, { status: 409 });
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: me, actor_name: ctx.fullName ?? null, action: `ckri_${action}`,
    entity_type: action.startsWith("need") ? "ckri_learning_need" : action.startsWith("offer") ? "question_contribution_offer" : "ckri_knowledge_version",
    entity_id: r.id ?? (action.startsWith("offer") ? str(body.offerId, 40) : null) ?? r.versionId ?? (str(body.versionId, 40) || str(body.needId, 40) || str(body.resourceId, 40) || null),
    new_value: { action, ...(action === "retire_version" ? { reason: str(body.note ?? body.reason, 500) } : {}), ...(action === "offer_take" && r.versionId ? { versionId: r.versionId } : {}) },
  }).then((x: unknown) => x, () => {});
  return NextResponse.json(r);
}
