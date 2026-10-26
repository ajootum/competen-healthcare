import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { archivePublication, decidePublication, submitForPublication } from "@/lib/competency/framework-publication";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/competency/publication -- Holdings framework publication (migration 467, owner CENTRAL GOVERNANCE).
//
// Body: { action: "submit" | "decide" | "archive", frameworkId, decision?: "publish" | "return", changeKind?, note? }
//
// ⚠ TWO AUTHORITIES, TWO GATES. Putting a framework forward is its author (hq.quality.competency.author) or, for a
// controlled catalogue, its curator (hq.individual.config.manage). Deciding and archiving is the independent publisher
// (hq.quality.competency.publish), and framework-publication.ts refuses a publisher who put it forward or contributed
// to it. Clinical approval of every owned competency is still the database's (466).

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "submit" && action !== "decide" && action !== "archive") return refuse(400, "Unknown action");
  const ctx = action === "submit"
    ? await hqApiGate(["hq.quality.competency.author", "hq.individual.config.manage"])
    : await hqApiGate(["hq.quality.competency.publish"]);
  if (isHqRefusal(ctx)) return ctx;
  const actor = { userId: ctx.userId, name: ctx.fullName ?? null };
  const r = action === "submit" ? await submitForPublication(ctx.admin, actor, body)
    : action === "decide" ? await decidePublication(ctx.admin, actor, body)
    : await archivePublication(ctx.admin, actor, body);
  return r.ok ? NextResponse.json(r) : refuse(r.status, r.error);
}
