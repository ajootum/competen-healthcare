/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { createCompetency, createCpu, createDomain, createFramework, createPractice, importDraftPackage, isId, renameDomain, setFrameworkIdentity, updateCompetency, updateFramework } from "@/lib/competency/authoring";
import { submitForReview } from "@/lib/competency/clinical-review";
import { createCriterion, moveCriterion, restoreCriterion, retireCriterion, updateCriterion } from "@/lib/competency/criteria-authoring";
import { loadFrameworkDiff } from "@/lib/competency/framework-diff";
import { discardLayout, reorderLayout } from "@/lib/competency/framework-layout";
import { createArea, deleteArea, moveCompetencyDomain, renameArea, reorderAreas, setDomainArea } from "@/lib/competency/framework-areas";
import { loadFrameworkForReview, outcomeCounts, previewOf, runSubmission, type ReviewScope } from "@/lib/competency/review-batch";
import { currentTraceId } from "@/lib/trace";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";
// A draft import (CFCA-STUDIO-P1: 30 competencies, 458 criteria) is one request of a few hundred sequential writes.
export const maxDuration = 60;

// POST /api/hq/competency/authoring -- CFCA authoring in production (migration 465, owner CFCA PRODUCTION AUTHORING).
//
// Body: { action: "create_framework" | "update_framework" | "set_identity" | "create_domain" | "rename_domain" |
//         "create_practice" | "create_cpu" | "create_competency" | "update_competency" | "import_draft" | "submit_review" |
//         "reorder_layout" | "discard_layout", ... }
//
// FRAMEWORK-DESIGN-STUDIO-01 (750/751): reorder_layout { frameworkId, level: "domains" | "competencies" | "criteria" |
// "sections", parentId? (domain for competencies, competency for criteria), component? (the criteria's section, null =
// not classified), order: ids (codes for sections), every one of that parent, in the new order }. A never-published
// draft is reordered directly; a published framework saves a layout draft, applied only by an independent publisher.
// "outcomes" and a criterion to another section or competency are refused (409) as clinical changes. discard_layout { frameworkId }.
//
// FRAMEWORK-DESIGN-STUDIO-02 (760, rulings D1/D3), ORGANISATIONAL, routed like reorder_layout (draft framework: live,
// published: the layout draft): create_area { frameworkId, name, description? }, rename_area { frameworkId, areaId, name },
// delete_area { frameworkId, areaId } (empty only), reorder_areas { frameworkId, order }, set_domain_area { frameworkId,
// domainId, areaId | null }, move_competency_domain { frameworkId, competencyId, domainId, position? }. 409 without 760.
//
// FRAMEWORK-DESIGN-STUDIO-02 S1 (draft frameworks only; anything else 409 "... go through a revision draft"):
//   create_criterion { competencyId, component, text, sourceRef?, position? }          -> 201 { ok, id }
//   update_criterion { criterionId, text?, sourceRef? }                                 -> { ok, unchanged }
//   retire_criterion | restore_criterion { criterionId }                                -> { ok, unchanged }
//   move_criterion { criterionId, component?, competencyId?, position? }                -> { ok, kind, substantive, mode? }
//   import_draft { package, mode?: "append" }   append: new competencies into an existing DRAFT, nothing existing touched
//   compare_published { frameworkId }           read only: the draft against its last published version (framework-diff.ts)
//
// ⚠ GATED BY hqApiGate(["hq.quality.competency.author"]) -- the Competency Author. It authors shared content and
// puts it forward for clinical review. It approves nothing (395, the Clinical Content Reviewer) and publishes nothing
// (the governed framework lifecycle). Every write is preceded by its authorship row (src/lib/competency/authoring.ts).

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.quality.competency.author"]);
  if (isHqRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null };
  switch (body?.action) {
    case "create_framework": { const r = await createFramework(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "update_framework": { const r = await updateFramework(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "set_identity": { const r = await setFrameworkIdentity(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "create_practice": { const r = await createPractice(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "create_cpu": { const r = await createCpu(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "create_domain": { const r = await createDomain(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "rename_domain": { const r = await renameDomain(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "create_competency": { const r = await createCompetency(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "update_competency": { const r = await updateCompetency(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "reorder_layout": { const r = await reorderLayout(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "create_area": { const r = await createArea(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "rename_area": { const r = await renameArea(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "delete_area": { const r = await deleteArea(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "reorder_areas": { const r = await reorderAreas(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "set_domain_area": { const r = await setDomainArea(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "move_competency_domain": { const r = await moveCompetencyDomain(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "discard_layout": { const r = await discardLayout(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "import_draft": { const r = await importDraftPackage(ctx.admin, actor, body.package, { mode: body.mode === "append" ? "append" : undefined }); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "create_criterion": { const r = await createCriterion(ctx.admin, actor, body); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "update_criterion": { const r = await updateCriterion(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "retire_criterion": { const r = await retireCriterion(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "restore_criterion": { const r = await restoreCriterion(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "move_criterion": { const r = await moveCriterion(ctx.admin, actor, body); return r.ok ? NextResponse.json(r) : refuse(r.status, r.error); }
    case "compare_published": {
      if (!isId(body.frameworkId)) return refuse(400, "Choose a framework.");
      const r = await loadFrameworkDiff(ctx.admin, body.frameworkId);
      return "error" in r ? refuse(r.status, r.error) : NextResponse.json(r);
    }
    case "submit_review": {
      // Draft -> Submit for Review. The curator becomes the submitter (and is already an author), so the 395 trigger
      // refuses any decision they make on it. Shared frameworks only: 395 refuses anything else.
      if (!isId(body.competencyId)) return refuse(400, "Choose a competency.");
      const r = await submitForReview(ctx.admin, body.competencyId, ctx.userId);
      return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(409, r.error);
    }
    case "review_preview": {
      // CFCA-STUDIO-UX-02: a whole framework, a domain or chosen competencies -- eligibility and exact versions, read only.
      if (!isId(body.frameworkId)) return refuse(400, "Choose a framework.");
      const scope = parseScope(body.scope);
      if (!scope) return refuse(400, "Choose the framework, a domain, or the competencies to put forward.");
      const f = await loadFrameworkForReview(ctx.admin, body.frameworkId);
      if ("error" in f) return refuse(f.status, f.error);
      const pv = previewOf(f.fw, scope, f.hashes);
      return "error" in pv ? refuse(422, pv.error) : NextResponse.json(pv);
    }
    case "review_submit": {
      // Each previewed item, re-checked at its boundary and put forward through the existing per-competency operation.
      if (!isId(body.frameworkId)) return refuse(400, "Choose a framework.");
      const items = Array.isArray(body.items) ? body.items.filter((i: any) => isId(i?.competencyId)).slice(0, 500) : [];
      if (!items.length) return refuse(400, "Nothing to put forward.");
      const f = await loadFrameworkForReview(ctx.admin, body.frameworkId);
      if ("error" in f) return refuse(f.status, f.error);
      const inFw = new Map(f.fw.domains.flatMap(d => d.competencies.map(c => [c.id, c] as const)));
      if (items.some((i: any) => !inFw.has(i.competencyId))) return refuse(422, "Some items are not in this framework. Nothing was put forward.");
      const results = await runSubmission(ctx.admin, ctx.userId, f.fw.pubStatus,
        items.map((i: any) => ({ competencyId: i.competencyId, code: inFw.get(i.competencyId)!.code, name: inFw.get(i.competencyId)!.name, hash: typeof i.hash === "string" ? i.hash : null })));
      const counts = outcomeCounts(results);
      await ctx.admin.from("audit_log").insert({ trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: actor.name,
        action: "cfca_review_batch_submitted", entity_type: "framework", entity_id: f.fw.id, entity_name: f.fw.name,
        new_value: { counts, items: results.map(r => ({ competency_id: r.competencyId, outcome: r.outcome, version_id: r.versionId ?? null })) } }).then((x: unknown) => x, () => {});
      return NextResponse.json({ results, counts });
    }
    default: return refuse(400, "Unknown action");
  }
}

function parseScope(s: any): ReviewScope | null {
  if (s?.kind === "framework") return { kind: "framework" };
  if (s?.kind === "domain" && isId(s.domainId)) return { kind: "domain", domainId: s.domainId };
  if (s?.kind === "competencies" && Array.isArray(s.ids)) { const ids = [...new Set(s.ids.filter(isId))] as string[]; return ids.length && ids.length <= 500 ? { kind: "competencies", ids } : null; }
  return null;
}
