import { NextRequest, NextResponse } from "next/server";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { audit } from "@/lib/practice/audit";
import { HQ_RECORD_SEARCH_FLAG } from "@/lib/hq/record-search/flag";

// PATCH /api/hq/search/flag -- HQ-RECORD-SEARCH-01: turn the HQ palette's record search on or off.
//
// ⚠ A HOLDINGS RIGHT, NOT A PRACTICE ONE. The owner's default of 6 Nov 2026: "a Holdings platform administrator may activate the flag and
// activation grants no extra access". hq.platform.governance.manage is the platform-class right for changing how Holdings is run; it is
// granted to no position by default, so today this means the owner, or someone the owner appoints to it. The Practice Product Director's
// hq.practice.flags.manage does not open this, which is why the switch left /api/v1/practice/flags.
//
// ⚠ IT GRANTS NOTHING. The flag only shows the search. Every /api/hq/search route still checks its own capability: flag on and no capability is
// a 403 with zero reads (src/app/api/hq/search/search.test.ts). The row is not seeded and there is no migration: the first flip creates it.
export async function PATCH(req: NextRequest) {
  const ctx = await hqApiGate(["hq.platform.governance.manage"]);
  if (isHqRefusal(ctx)) return ctx;

  let body: { enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  const { data: before, error: readError } = await ctx.admin.from("practice_platform_flags").select("enabled").eq("flag", HQ_RECORD_SEARCH_FLAG).maybeSingle();
  if (readError) return NextResponse.json({ error: "The switch could not be read just now." }, { status: 503 });
  const { error } = before
    ? await ctx.admin.from("practice_platform_flags").update({ enabled: body.enabled }).eq("flag", HQ_RECORD_SEARCH_FLAG)
    : await ctx.admin.from("practice_platform_flags").insert({ flag: HQ_RECORD_SEARCH_FLAG, enabled: body.enabled, note: "HQ palette record search (policies, instruments, frameworks, positions, staff directory)." });
  if (error) return NextResponse.json({ error: "The switch could not be saved just now." }, { status: 503 });

  await audit(ctx.admin, {
    actorId: ctx.userId, eventType: "practice.launch_flag_changed",
    payload: { flag: HQ_RECORD_SEARCH_FLAG, from: before?.enabled ?? null, to: body.enabled, reason: null },
    correlationId: crypto.randomUUID(),
  });
  return NextResponse.json({ flag: HQ_RECORD_SEARCH_FLAG, enabled: body.enabled, changed: (before?.enabled ?? false) !== body.enabled });
}
