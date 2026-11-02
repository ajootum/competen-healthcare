import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { CAP } from "@/lib/assessment/studio/transitions";
import { refuse } from "@/lib/assessment/studio/api";
import { buildCriterionTree, listFrameworks, readCriteria } from "@/lib/assessment/adapters/scholar/criteria";

export const dynamic = "force-dynamic";

// GET /api/hq/checklist-studio/criteria -- Checklist Studio (S2). View capability. The criterion picker.
//   (no query)         the shared frameworks that can be picked from
//   ?framework=<code>  that framework as domain -> competency -> criteria, with the component, the framework publication status and
//                      the competency clinical approval status of each
// This is the ONE place the Studio reads framework tables, through the adapter folder.

export async function GET(req: Request) {
  const ctx = await withOwnAppointments(await hqApiGate([CAP.view]));
  if (isHqRefusal(ctx)) return ctx;
  const code = new URL(req.url).searchParams.get("framework");
  if (!code) return NextResponse.json({ frameworks: await listFrameworks(ctx.admin) });
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(code)) return refuse(400, "Choose a framework.");
  const rows = await readCriteria(ctx.admin, code);
  return NextResponse.json({ tree: buildCriterionTree(rows) });
}
