import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { createCompetency, createCpu, createDomain, createFramework, createPractice, importDraftPackage, isId, renameDomain, setFrameworkIdentity, updateCompetency, updateFramework } from "@/lib/competency/authoring";
import { submitForReview } from "@/lib/competency/clinical-review";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";
// A draft import (CFCA-STUDIO-P1: 30 competencies, 458 criteria) is one request of a few hundred sequential writes.
export const maxDuration = 60;

// POST /api/hq/competency/authoring -- CFCA authoring in production (migration 465, owner CFCA PRODUCTION AUTHORING).
//
// Body: { action: "create_framework" | "update_framework" | "set_identity" | "create_domain" | "rename_domain" |
//         "create_practice" | "create_cpu" | "create_competency" | "update_competency" | "import_draft" | "submit_review", ... }
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
    case "import_draft": { const r = await importDraftPackage(ctx.admin, actor, body.package); return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(r.status, r.error); }
    case "submit_review": {
      // Draft -> Submit for Review. The curator becomes the submitter (and is already an author), so the 395 trigger
      // refuses any decision they make on it. Shared frameworks only: 395 refuses anything else.
      if (!isId(body.competencyId)) return refuse(400, "Choose a competency.");
      const r = await submitForReview(ctx.admin, body.competencyId, ctx.userId);
      return r.ok ? NextResponse.json(r, { status: 201 }) : refuse(409, r.error);
    }
    default: return refuse(400, "Unknown action");
  }
}
