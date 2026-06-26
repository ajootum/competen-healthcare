import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// POST /api/assessments  — upsert competency scores for a cycle
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: assessor } = await supabase
    .from("profiles")
    .select("role, hospital_id")
    .eq("id", user.id)
    .single();

  if (!assessor || !["assessor", "hospital_admin", "super_admin"].includes(assessor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { cycle_id, nurse_id, scores } = body as {
    cycle_id: string;
    nurse_id: string;
    scores: Array<{ competency_id: string; score: number; notes?: string }>;
  };

  if (!cycle_id || !nurse_id || !Array.isArray(scores)) {
    return NextResponse.json({ error: "cycle_id, nurse_id, and scores[] are required" }, { status: 400 });
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const rows = scores.map(s => ({
    cycle_id,
    nurse_id,
    competency_id: s.competency_id,
    score: s.score,
    notes: s.notes ?? null,
    assessed_by: user.id,
    assessed_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from("competency_assessments")
    .upsert(rows, { onConflict: "cycle_id,nurse_id,competency_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, count: rows.length });
}
