import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { ASSESS_CAPABILITY } from "@/lib/assessment/assessor/common";
import { addEvidence } from "@/lib/assessment/assessor/instances";
import { readJson, respond } from "../../../_respond";

export const dynamic = "force-dynamic";

// POST /api/hq/checklist-assessments/instances/[instanceId]/evidence { itemKey?, kind: "note" | "record_ref", note? | refKind, refId }
// Notes and references to records only: there is no HQ upload path to reuse. Append-only; added while in progress.
export async function POST(req: Request, ctx: { params: Promise<{ instanceId: string }> }) {
  const gate = await hqApiGate([ASSESS_CAPABILITY]);
  if (isHqRefusal(gate)) return gate;
  const { instanceId } = await ctx.params;
  const b = await readJson(req);
  const r = await addEvidence(gate.admin, gate.userId, instanceId, { itemKey: typeof b.itemKey === "string" ? b.itemKey : null, kind: b.kind, note: b.note, refKind: b.refKind, refId: b.refId });
  return r.ok ? NextResponse.json(r.value, { status: 201 }) : respond(r);
}
