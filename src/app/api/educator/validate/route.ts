import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admin client for the role lookup — the user-scoped client is subject to
  // RLS and cannot reliably read profiles, which made this gate 403 for
  // legitimate educators. Roles-array aware like every other route.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, roles, full_name")
    .eq("id", user.id)
    .single();
  const roles: string[] = profile?.roles?.length ? profile.roles : [profile?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { competency_score_id, action, notes } = body as {
    competency_score_id: string;
    action: "validate" | "return";
    notes?: string;
  };

  if (action === "validate") {
    const { error } = await admin
      .from("competency_scores")
      .update({
        educator_validated: true,
        educator_id: user.id,
        educator_notes: notes || null,
        validated_at: new Date().toISOString(),
      })
      .eq("id", competency_score_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({
      actor_id: user.id, actor_name: profile?.full_name ?? null,
      action: "educator_validate", entity_type: "competency_score", entity_id: competency_score_id,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "return") {
    // Mark as returned — educator rejects, assessor must re-assess
    const { error } = await admin
      .from("competency_scores")
      .update({
        educator_validated: false,
        educator_notes: notes || null,
        educator_id: user.id,
      })
      .eq("id", competency_score_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({
      actor_id: user.id, actor_name: profile?.full_name ?? null,
      action: "educator_return", entity_type: "competency_score", entity_id: competency_score_id,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
