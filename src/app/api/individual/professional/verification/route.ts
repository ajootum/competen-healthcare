import { NextResponse } from "next/server";
import { requireIndividualContext, isGuardRefusal } from "@/lib/individual/guard";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { isUuid } from "@/lib/individual/professional/validate";
import { recordPersonEvent } from "@/lib/individual/professional/profile-verification";
import type { ItemKind } from "@/lib/individual/professional/profile-vocabulary";
import { audit, readBody, refuse } from "@/lib/individual/professional/api";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// POST /api/individual/professional/verification -- COMPETEN-PROFESSIONAL-PROFILE-01 part B, migration 451.
//
// The person's side of independent verification: ask Competen to check one version of a qualification,
// registration or employment record, withdraw that request, or dispute a verifier's outcome. Body:
// { itemId, action: "request" | "withdraw" | "dispute", reason? }.
//
// ⚠ OPTIONAL. Nothing else in Competen Professional waits on it. Whether a kind of record may be submitted is
// the verification policy (WCE professional_verification_kinds). Everything else -- the record is the
// person's own and current, one request at a time, a dispute needs an outcome -- is 451's trigger, so the
// database refuses it even if this route were wrong.
// ⚠ The audit row carries the action and the record kind, never the record's words or the reason.

const EVENT = { request: "requested", withdraw: "request_withdrawn", dispute: "disputed" } as const;

export async function POST(req: Request) {
  const ctx = await requireIndividualContext("professional");
  if (isGuardRefusal(ctx)) return ctx;
  const { fields } = await readBody(req);
  const action = fields.action;
  if (action !== "request" && action !== "withdraw" && action !== "dispute") return refuse("Choose what to do.");
  if (!isUuid(fields.itemId)) return refuse("Choose a record.");
  const reason = typeof fields.reason === "string" && fields.reason.trim() ? fields.reason.trim().slice(0, 1000) : null;
  if (action === "dispute" && (!reason || reason.length < 3)) return refuse("Say why you dispute the outcome.");

  const { data: item } = await ctx.admin.from("individual_professional_profile_item").select("id, section").eq("id", fields.itemId).eq("user_id", ctx.userId).maybeSingle();
  if (!item) return refuse("That record is not on your profile.", 404);
  if (action === "request" && !(await loadIndividualPolicy(ctx.admin)).professionalProfile.verificationKinds.includes(item.section as ItemKind))
    return refuse("Competen does not verify this kind of record at the moment.");

  const out = await recordPersonEvent(ctx.admin, ctx.userId, item.id, EVENT[action], action === "withdraw" ? null : reason);
  if (!out.ok) return refuse(out.error, out.status);
  await audit(ctx, `individual_professional_verification_${action}`, "individual_professional_profile_item", item.id, { kind: item.section });
  return NextResponse.json({ ok: true });
}
