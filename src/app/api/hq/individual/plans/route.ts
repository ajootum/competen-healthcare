import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { individualCommerceEnabled } from "@/lib/individual/commerce";
import { currentTraceId } from "@/lib/trace";
import { isPlanRefusal, listPlans, savePlan, validatePlan } from "@/lib/individual/plans";

// Request-time only: it reads two gates and the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/individual/plans -- the Competen Individual plans and their prices (P1 Commercial, migrations 399
// and 400). GET lists every plan. POST creates or changes one: { planCode, experience, name, active,
// amount?, currency?, intervalDays?, aiHourlyLimit? }, the amount in the currency's major unit.
//
// ⚠ hq.individual.commercial.manage, which migration 400 grants to NO position: today only the platform
// owners, whom hqApiGate admits for every capability, can reach this. Handing it to a position is a separate
// owner GO.
//
// ⚠ DARK unless BOTH the Individual release gate and individual_commerce are on (404), like every other
// commerce surface -- and so it never reads a migration-399 table where 399 has not been applied.

const notFound = () => NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

export async function GET() {
  const ctx = await hqApiGate(["hq.individual.commercial.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await individualCommerceEnabled(ctx.admin))) return notFound();
  const out = await listPlans(ctx.admin);
  if (!out.ok) return NextResponse.json({ error: { code: "UNAVAILABLE", message: "The plans could not be read." } }, { status: 503 });
  return NextResponse.json({ plans: out.plans });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.commercial.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  if (!(await individualCommerceEnabled(ctx.admin))) return notFound();

  const parsed = validatePlan(await req.json().catch(() => ({})));
  if (isPlanRefusal(parsed)) return NextResponse.json({ error: { code: parsed.code, message: parsed.message } }, { status: parsed.status });

  const out = await savePlan(ctx.admin, parsed, ctx.userId);
  if (!out.ok) return NextResponse.json({ error: { code: out.code, message: out.message } }, { status: out.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: out.before ? "individual_plan_changed" : "individual_plan_created", entity_type: "individual_plan", entity_id: null,
    entity_name: parsed.planCode, old_value: out.before, new_value: out.after,
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ ok: true, plan: out.after, created: !out.before });
}
