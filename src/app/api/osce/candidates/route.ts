import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// OSCE Centre — candidate attendance: check-in / mark absent / re-register.
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Only assessor roles can manage candidates" }, { status: 403 });
  }

  const { exam_id, nurse_id, status } = await req.json().catch(() => ({}));
  if (!exam_id || !nurse_id || !["registered", "checked_in", "absent"].includes(status)) {
    return NextResponse.json({ error: "exam_id, nurse_id and status (registered | checked_in | absent) are required" }, { status: 400 });
  }
  const { data: exam } = await admin.from("osce_exams").select("id, hospital_id, status").eq("id", exam_id).single();
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });
  if (me?.hospital_id && exam.hospital_id !== me.hospital_id && !roles.includes("super_admin")) {
    return NextResponse.json({ error: "You can only manage OSCEs in your hospital" }, { status: 403 });
  }
  if (["completed", "cancelled"].includes(exam.status)) {
    return NextResponse.json({ error: "This exam is closed" }, { status: 400 });
  }

  const { error } = await admin.from("osce_candidates").update({ status })
    .eq("exam_id", exam_id).eq("nurse_id", nurse_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
