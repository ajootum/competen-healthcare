import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { isProgrammeRefusal, listProgrammesForHq, saveProgramme, validateProgramme } from "@/lib/individual/programme-admin";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// /api/hq/individual/programmes -- COMPETEN-SCHOLAR-JOIN-01, owner ruling CONFIGURATION: governed no-code
// administration of Scholar PROGRAMMES (individual_scholar_programme and its catalogue links, migration 387).
// GET lists every programme. POST creates or changes one: { code, label, profession, country?, level?, active,
// frameworks: [{ frameworkId, layer }] }. A programme is retired with active: false -- never deleted.
//
// ⚠ GATED BY hqApiGate(["hq.individual.config.manage"]), the same right as the Individual policy (migration
// 376): the Individual Product Administrator appointment and the platform owners. Like the policy route it
// does not touch the release gate, and it works whether or not Individual is switched on, so HQ can prepare
// programmes before activation.
//
// ⚠ EVERY CHANGE IS AUDITED with the programme as it was before and after (audit_log, like the plans route).

export async function GET() {
  const ctx = await hqApiGate(["hq.individual.config.manage"]);
  if (isHqRefusal(ctx)) return ctx;
  const out = await listProgrammesForHq(ctx.admin);
  if (!out.ok) return NextResponse.json({ error: out.notProvisioned ? "Scholar programmes are not set up on this environment (migration 387)." : "The programmes could not be read just now." }, { status: out.notProvisioned ? 409 : 503 });
  return NextResponse.json({ programmes: out.programmes });
}

export async function POST(req: Request) {
  const ctx = await hqApiGate(["hq.individual.config.manage"]);
  if (isHqRefusal(ctx)) return ctx;

  const parsed = validateProgramme(await req.json().catch(() => ({})));
  if (isProgrammeRefusal(parsed)) return NextResponse.json({ error: parsed.message, code: parsed.code }, { status: parsed.status });

  const out = await saveProgramme(ctx.admin, parsed);
  if (!out.ok) return NextResponse.json({ error: out.message, code: out.code }, { status: out.status });

  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null,
    action: !out.before ? "individual_scholar_programme_created" : out.before.is_active && !out.after.is_active ? "individual_scholar_programme_retired" : "individual_scholar_programme_changed",
    entity_type: "individual_scholar_programme", entity_id: null, entity_name: parsed.code,
    old_value: out.before, new_value: out.after,
  }).then((r: unknown) => r, () => {});

  return NextResponse.json({ ok: true, programme: out.after, created: !out.before });
}
