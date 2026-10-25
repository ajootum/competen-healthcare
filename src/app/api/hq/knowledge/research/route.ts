/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { CKRI_OFF, ckriEnabled } from "@/lib/knowledge/governance";
import {
  approveDataset, correctPublication, freezeDocument, moveMember, movePublication, proposeMember, requestPublication, reviewItem, writeDocument, writeOutput,
} from "@/lib/knowledge/workspace";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/knowledge/research -- COMPETEN-KNOWLEDGE-RESEARCH-01 s6-s8 (K4), migration 443.
//   hq.quality.research.propose  (Research Lead and team)     doc_write, doc_freeze, member_propose, output_write,
//                                                             publication_request, publication_publish,
//                                                             publication_correct, publication_withdraw
//   hq.quality.research.govern   (Research Governance)        member_appoint, member_end, dataset_approve,
//                                                             publication_approve, publication_reject, governor_withdraw,
//                                                             governor_correct
//   hq.quality.research.review   (Scientific Reviewer)       review
// The 443 triggers decide team membership, independence, integrity fields and the lifecycle again.
// ⚠ NOTHING THE BROWSER SENDS PICKS THE ACTOR, THE DECIDER, A TIME OR AN ACCESS LEVEL. No action exports anything.

const PROPOSE = ["doc_write", "doc_freeze", "member_propose", "output_write", "publication_request", "publication_publish", "publication_correct", "publication_withdraw"] as const;
const GOVERN = ["member_appoint", "member_end", "dataset_approve", "publication_approve", "publication_reject", "governor_withdraw", "governor_correct"] as const;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const capability = (PROPOSE as readonly string[]).includes(action) ? "hq.quality.research.propose" : (GOVERN as readonly string[]).includes(action) ? "hq.quality.research.govern"
    : action === "review" ? "hq.quality.research.review" : null;
  if (!capability) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const ctx = await hqApiGate([capability]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await ckriEnabled(ctx.admin))) return NextResponse.json({ error: CKRI_OFF }, { status: 409 });
  const me = ctx.userId;
  const projectId = str(body.projectId, 40);
  const fields = body?.fields && typeof body.fields === "object" ? body.fields : body;
  let r: any;
  switch (action) {
    case "doc_write": r = await writeDocument(ctx.admin, me, { projectId, kind: str(body.kind, 20), fields }); break;
    case "doc_freeze": r = await freezeDocument(ctx.admin, me, str(body.documentId, 40)); break;
    case "member_propose": r = await proposeMember(ctx.admin, { projectId, personId: str(body.personId, 40), role: str(body.role, 30), external: body.external === true || body.external === "true", agreementRef: str(body.agreementRef) || null }); break;
    case "member_appoint": r = await moveMember(ctx.admin, me, str(body.memberId, 40), "active"); break;
    case "member_end": r = await moveMember(ctx.admin, me, str(body.memberId, 40), "ended"); break;
    case "dataset_approve": r = await approveDataset(ctx.admin, me, { projectId, snapshotId: str(body.snapshotId, 40), label: str(body.label) }); break;
    case "output_write": r = await writeOutput(ctx.admin, me, { projectId, datasetIds: str(body.datasetIds, 2000).split(/[\s,]+/).filter(Boolean), title: str(body.title, 300), results: str(body.results, 150000),
        integrity: fields, usesAiMarked: body.usesAiMarked === true || body.usesAiMarked === "true", freeze: body.freeze === true || body.freeze === "true" }); break;
    case "review": r = await reviewItem(ctx.admin, me, { projectId, documentId: str(body.documentId, 40) || null, outputId: str(body.outputId, 40) || null, decision: str(body.decision, 20), comments: str(body.comments, 20000) }); break;
    case "publication_request": r = await requestPublication(ctx.admin, me, { projectId, manuscriptId: str(body.manuscriptId, 40), venue: str(body.venue, 300) }); break;
    case "publication_approve": r = await movePublication(ctx.admin, me, str(body.publicationId, 40), "approved", { attest: body.attest === true || body.attest === "true", note: str(body.note, 4000) || null }); break;
    case "publication_reject": r = await movePublication(ctx.admin, me, str(body.publicationId, 40), "rejected", { note: str(body.note, 4000) || null }); break;
    case "publication_publish": r = await movePublication(ctx.admin, me, str(body.publicationId, 40), "published", {}); break;
    case "publication_withdraw": case "governor_withdraw": r = await movePublication(ctx.admin, me, str(body.publicationId, 40), "withdrawn", { note: str(body.note, 4000) || null }); break;
    case "publication_correct": case "governor_correct": r = await correctPublication(ctx.admin, me, str(body.publicationId, 40), str(body.note, 4000)); break;
  }
  if (!r?.ok) return NextResponse.json({ error: r?.error ?? "That could not be done." }, { status: 409 });
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: me, actor_name: ctx.fullName ?? null, action: `ckri_${action}`, entity_type: "ckri_research_project",
    entity_id: projectId || null, new_value: { action, id: r.id ?? null },
  }).then((x: unknown) => x, () => {});
  return NextResponse.json(r);
}
