import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";

// CPR-DOC-AUTO-001 section 16 -- the frequently used destinations, so an address is not retyped.
// Ordered by the counter migration 352 maintains, most used first.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  let query = auth.caller.admin.from("practice_referral_destination")
    .select("id, kind, display_name, specialty, facility, address, phone, email, use_count, last_used_on")
    .eq("workspace_id", auth.ctx.workspaceId).eq("active", true);
  if (q) query = query.ilike("display_name", `%${q}%`);

  const { data, error } = await query
    .order("use_count", { ascending: false }).order("last_used_on", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: { code: "READ_FAILED", message: error.message } }, { status: 500 });

  return NextResponse.json({ destinations: data ?? [], correlationId: auth.caller.traceId });
}
