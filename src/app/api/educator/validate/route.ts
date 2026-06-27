import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["educator","hospital_admin","super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { competency_score_id, action, notes } = body as {
    competency_score_id: string;
    action: "validate" | "return";
    notes?: string;
  };

  const admin = createAdminClient();

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
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
