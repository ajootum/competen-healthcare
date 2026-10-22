import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/professional/validate";
import { loadSharedCompetencies } from "@/lib/individual/professional/frameworks";

// GET /api/individual/professional/frameworks?framework=<uuid> -- the competencies of ONE shared framework
// (hospital_id null), for the need and evidence forms. A hospital's own framework answers 404, the same
// as one that does not exist: whether it exists is that organisation's business.

export async function GET(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const id = new URL(req.url).searchParams.get("framework");
  if (!isUuid(id)) return NextResponse.json({ error: "Choose a framework." }, { status: 400 });
  const competencies = await loadSharedCompetencies(ctx.admin, id);
  if (competencies === null) return NextResponse.json({ error: "That is not one of the shared frameworks." }, { status: 404 });
  return NextResponse.json({ competencies });
}
