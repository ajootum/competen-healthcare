import { NextResponse } from "next/server";
import { hqOwnerApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { parseClassifyRequest } from "@/lib/hq/account-classification";
import { currentTraceId } from "@/lib/trace";

// HQ-USERS-CLASSIFY-01: classify accounts in bulk, and set the Users screen's default view.
//
// OWNER-ONLY, through the same gate as every other account write on this screen (suspend, invite, delete, roles):
// hq.platform.users.view opens the directory, never a write. Classification is an administrative label and the
// two database functions it calls (migration 650) touch only hq_account_classification and hq_config: no Auth
// user, entitlement, appointment, seat, record or relationship. Each changed account writes one audit_log row
// (before, after, who, when, reason) inside the same transaction as the change.
export async function POST(req: Request) {
  const ctx = await hqOwnerApiGate(["hq.platform.users.view"]);
  if (isHqRefusal(ctx)) return ctx;

  const parsed = parseClassifyRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = parsed.req;
  const trace = await currentTraceId();

  if (r.action === "set_default_view") {
    const { error } = await ctx.admin.rpc("hq_users_default_view_set", {
      p_actor: ctx.userId, p_actor_name: ctx.fullName, p_view: r.view, p_trace: trace,
    });
    if (error) return failure(error);
    return NextResponse.json({ success: true, view: r.view });
  }

  const { data, error } = await ctx.admin.rpc("hq_account_classify", {
    p_actor: ctx.userId, p_actor_name: ctx.fullName, p_profile_ids: r.userIds,
    p_account_type: r.accountType, p_reason: r.reason, p_trace: trace,
  });
  if (error) return failure(error);
  const changed = typeof data === "number" ? data : Number(data ?? 0);
  return NextResponse.json({ success: true, changed, unchanged: r.userIds.length - changed });
}

// A missing function (PGRST202 / 42883) is migration 650 not applied: say so, and change nothing.
function failure(error: { code?: string; message?: string }) {
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01")
    return NextResponse.json({ error: "Account classification is not available until migration 650 is applied" }, { status: 503 });
  return NextResponse.json({ error: error.message ?? "Classification failed" }, { status: 500 });
}
