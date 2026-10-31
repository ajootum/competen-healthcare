import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { findLibraryCases } from "@/lib/cases/library";
import { isUuid } from "@/lib/individual/scholar/store";
import { findPatientIdentifiers } from "@/lib/individual/scholar/extract";
import { latestGaps } from "@/lib/individual/scholar/case-ranking-context";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// GET /api/individual/scholar/clinical/library?competency=&topic= -- "Choose an existing case" (CR1, CI6). The governed
// library's cases that are published and approved for their exact version (library.ts findLibraryCases), with nothing
// of the blueprint but its title and opening, ranked by relevance with a short "why this case" each (cases/ranking.ts). Behind the case_library flag (off: an empty list, said as such). No AI.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("scholar");
  if (isGuardRefusal(ctx)) return ctx;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (!policy.scholarCaseEntries.includes("library")) return NextResponse.json({ offers: [], reason: "Library cases are not offered here." });
  const q = new URL(req.url).searchParams;
  const competency = q.get("competency"), topic = (q.get("topic") ?? "").trim().slice(0, 120);
  if (topic && findPatientIdentifiers(topic).length) return NextResponse.json({ error: "That topic looks like it identifies a patient. Name the topic only." }, { status: 422 });
  const offers = await findLibraryCases(ctx.admin, { competencyIds: isUuid(competency) ? [competency] : undefined, topic: topic || undefined, gaps: await latestGaps(ctx.admin, ctx.userId) });
  if (offers === null) return NextResponse.json({ error: "The case library could not be read just now." }, { status: 503 });
  return NextResponse.json({ offers });
}
