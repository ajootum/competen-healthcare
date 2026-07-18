import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// OSCE Centre CSV export: candidate × station score matrix for one exam, with
// per-candidate averages and pass flags (Benner passing = score ≥ 3).
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const examId = new URL(req.url).searchParams.get("exam");
  if (!examId) return NextResponse.json({ error: "Pass ?exam=<id>" }, { status: 400 });

  const { data: exam } = await admin.from("osce_exams").select("id, title, hospital_id, exam_date, status").eq("id", examId).single();
  if (!exam) return NextResponse.json({ error: "Exam not found" }, { status: 404 });
  if (me?.hospital_id && exam.hospital_id !== me.hospital_id && !roles.includes("super_admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [{ data: stations }, { data: candidates }, { data: results }] = await Promise.all([
    admin.from("osce_stations").select("id, station_no, name").eq("exam_id", examId).order("station_no"),
    admin.from("osce_candidates").select("nurse_id, status, profiles!nurse_id(full_name)").eq("exam_id", examId),
    admin.from("osce_results").select("station_id, nurse_id, score").eq("exam_id", examId),
  ]);

  const scoreOf = new Map((results ?? []).map(r => [`${r.station_id}:${r.nurse_id}`, r.score]));
  const header = ["Candidate", "Attendance", ...(stations ?? []).map(s => `S${s.station_no}: ${s.name}`), "Average", "Stations Passed", "Missing"];
  const lines = [header.join(",")];
  for (const c of candidates ?? []) {
    const name = (c.profiles as unknown as { full_name: string } | null)?.full_name ?? "—";
    const scores = (stations ?? []).map(s => scoreOf.get(`${s.id}:${c.nurse_id}`));
    const present = scores.filter((v): v is number => v != null);
    lines.push([
      esc(name), c.status,
      ...scores.map(v => v ?? ""),
      present.length ? (present.reduce((a, b) => a + b, 0) / present.length).toFixed(1) : "",
      `${present.filter(v => v >= 3).length}/${(stations ?? []).length}`,
      scores.filter(v => v == null).length,
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="osce-${(exam.title as string).replace(/[^\w-]+/g, "-").slice(0, 40)}-${exam.exam_date ?? "results"}.csv"`,
    },
  });
}
