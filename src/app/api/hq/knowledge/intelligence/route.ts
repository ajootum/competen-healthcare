import { NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { currentTraceId } from "@/lib/trace";
import { CKRI_OFF, ckriEnabled, loadCkriPolicy } from "@/lib/knowledge/governance";
import { buildSnapshot, purgeExpired } from "@/lib/knowledge/intelligence";

// Request-time only: it reads the session, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// POST /api/hq/knowledge/intelligence -- COMPETEN-KNOWLEDGE-RESEARCH-01 s4 (K2), migration 441.
//   { action: "build", measure, from, to, dimension }   hq.quality.research.govern
//   { action: "purge" }                                  hq.quality.research.govern
// The settings (cohort minimum, rounding, suppression, retention, grain) come from the PUBLISHED policy on the server,
// never from the request. 441 refuses again without the flag, the capability or the floor.

const str = (v: unknown, max = 40) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "build" && body?.action !== "purge") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const ctx = await hqApiGate(["hq.quality.research.govern"]);
  if (isHqRefusal(ctx)) return ctx;
  // Purging expired snapshots is retention, which never waits for the gate. Building does.
  if (body.action === "build" && !(await ckriEnabled(ctx.admin))) return NextResponse.json({ error: CKRI_OFF }, { status: 409 });
  const r = body.action === "build"
    ? await buildSnapshot(ctx.admin, ctx.userId, await loadCkriPolicy(ctx.admin), { measure: str(body.measure), from: str(body.from, 10), to: str(body.to, 10), dimension: str(body.dimension, 20) || "none" })
    : await purgeExpired(ctx.admin);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  await ctx.admin.from("audit_log").insert({
    trace_id: await currentTraceId(), actor_id: ctx.userId, actor_name: ctx.fullName ?? null, action: `ckri_snapshot_${body.action}`,
    entity_type: "ckri_snapshot", entity_id: "id" in r ? r.id : null, new_value: body.action === "build" ? { measure: str(body.measure), dimension: str(body.dimension, 20) || "none" } : { deleted: "deleted" in r ? r.deleted : 0 },
  }).then((x: unknown) => x, () => {});
  return NextResponse.json(r);
}
