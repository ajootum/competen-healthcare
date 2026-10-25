import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { isUuid } from "@/lib/individual/professional/validate";
import { refuse, writeFailed } from "@/lib/individual/professional/api";
import { LEARNING_UNMATCH_ACTION, loadUnmatchDecisions, pairKey } from "@/lib/individual/professional/learning";
import { learningEnabled } from "@/lib/learning/policy";
import { loadLearningRecords } from "@/lib/learning/products";
import { currentTraceId } from "@/lib/trace";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/cpd/learning-match -- "This is a different activity".
//
// Owner (double-counted CPD hours): a CPD entry the person logged that matches a Competen Learning record is counted
// once (src/lib/individual/professional/learning.ts). This is the person's way to say the match is wrong. Their
// decision is one ids-only audit_log row -- the CPD entry id and the learning record id, never a title -- read back by
// loadUnmatchDecisions. No migration, and NOTHING is changed or deleted: not the 373 row, not the learning record.
//
// ⚠ UNLIKE audit() IN src/lib/individual/professional/api.ts, THE WRITE IS CHECKED. This row IS the decision, so a failed insert is a failed save,
// not something to swallow.

export async function PATCH(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const cpdId = body?.cpdId, recordId = body?.recordId;
  if (!isUuid(cpdId) || !isUuid(recordId)) return refuse("Choose a CPD entry and the course it was matched to.");
  if (!(await learningEnabled(ctx.admin))) return refuse("Competen Learning is not switched on, so nothing is matched.", 409);

  const { data: entry } = await ctx.admin.from("individual_professional_cpd").select("id").eq("id", cpdId).eq("user_id", ctx.userId).maybeSingle();
  if (!entry) return refuse("That CPD entry is not on your record.", 404);
  const refs = await loadLearningRecords(ctx.admin, ctx.userId);
  if (refs === null) return writeFailed("choice");
  if (!refs.some(r => r.recordId === recordId)) return refuse("That course is not in your completed learning.", 404);

  const prior = await loadUnmatchDecisions(ctx.admin, ctx.userId);
  if (prior === null) return writeFailed("choice");
  if (prior.has(pairKey(cpdId, recordId))) return NextResponse.json({ ok: true, already: true });

  const { error } = await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: null,
    action: LEARNING_UNMATCH_ACTION, entity_type: "individual_professional_cpd", entity_id: cpdId,
    new_value: { experience: "professional", learning_record_id: recordId },
  });
  if (error) return writeFailed("choice");
  return NextResponse.json({ ok: true });
}
