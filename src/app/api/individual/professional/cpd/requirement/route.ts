import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { audit, refuse, todayUtc, writeFailed } from "@/lib/individual/professional/api";
import { loadLcpdConfig } from "@/lib/individual/lcpd-config";
import { parseSetting } from "@/lib/individual/professional/cpd-requirements";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// /api/individual/professional/cpd/requirement -- the CPD requirement a person chooses to follow (LCPD-01 LCPD-5, 490).
//
// The person's own choice, on their own row. A requirement is one the Individual policy offers now, with its source and
// review status. Choosing one claims nothing: the CPD page counts the person's record against it, and says plainly that
// nothing is verified or accepted by any body.

export async function PUT(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const cfg = await loadLcpdConfig(ctx.admin);
  const p = parseSetting(body, cfg.requirements, todayUtc());
  if (!p.ok) return refuse(p.error);
  const { error } = await ctx.admin.from("individual_professional_cpd_setting").upsert({
    user_id: ctx.userId, requirement_code: p.value.requirementCode, cycle_start: p.value.cycleStart, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? refuse("CPD requirements are not available on this environment yet.", 409) : writeFailed("CPD requirement");
  await audit(ctx, "individual_professional_cpd_requirement_set", "individual_professional_cpd_setting", null, { requirement_code: p.value.requirementCode });
  return NextResponse.json({ ok: true });
}
