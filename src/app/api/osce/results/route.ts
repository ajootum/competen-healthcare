import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// OSCE Centre — record a station score for a candidate (0–6 Benner scale).
// Upserts so an examiner can correct a score before the exam is completed.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessor roles can record OSCE scores" }, { status: 403 });
  }

  const { station_id, nurse_id, score, notes } = await req.json().catch(() => ({}));
  if (!station_id || !nurse_id || !Number.isInteger(score) || score < 0 || score > 6) {
    return NextResponse.json({ error: "station_id, nurse_id and an integer score 0–6 are required" }, { status: 400 });
  }
  if (nurse_id === user.id) return NextResponse.json({ error: "You cannot score yourself" }, { status: 400 });

  const { data: station } = await admin.from("osce_stations").select("id, name, exam_id").eq("id", station_id).single();
  if (!station) return NextResponse.json({ error: "Station not found" }, { status: 404 });
  const { data: exam } = await admin.from("osce_exams").select("id, title, status, hospital_id").eq("id", station.exam_id).single();
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });
  if (me?.hospital_id && exam.hospital_id !== me.hospital_id && !roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only score OSCEs in your hospital" }, { status: 403 });
  }
  if (!["published", "running"].includes(exam.status)) {
    return NextResponse.json({ error: `Scores can only be recorded while the exam is published or running (currently ${exam.status})` }, { status: 400 });
  }
  const { data: candidate } = await admin.from("osce_candidates")
    .select("id, status").eq("exam_id", exam.id).eq("nurse_id", nurse_id).single();
  if (!candidate) return NextResponse.json({ error: "Candidate is not registered for this exam" }, { status: 404 });

  const { error } = await admin.from("osce_results").upsert({
    exam_id: exam.id, station_id, nurse_id,
    assessor_id: user.id,
    score, notes: (notes ?? "").trim() || null,
    recorded_at: new Date().toISOString(),
  }, { onConflict: "station_id,nurse_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (candidate.status === "registered") {
    await admin.from("osce_candidates").update({ status: "checked_in" }).eq("id", candidate.id);
  }

  await admin.from("audit_log").insert({
    actor_id: user.id, actor_name: me?.full_name ?? null,
    action: "record_osce_score", entity_type: "osce_exam", entity_id: exam.id, entity_name: exam.title,
    new_value: { station: station.name, score },
  });
  return NextResponse.json({ ok: true });
}
