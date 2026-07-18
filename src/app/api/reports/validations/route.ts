import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Validation Analytics CSV — every score validation and evidence verdict for
// the hospital, with reviewer and turnaround. Educator/admin roles.
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!me?.hospital_id) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });

  const { data: nurses } = await admin.from("profiles").select("id, full_name").eq("hospital_id", me.hospital_id).eq("role", "nurse");
  const nurseIds = (nurses ?? []).map(n => n.id);
  const nameOf = new Map((nurses ?? []).map(n => [n.id, n.full_name]));

  const [{ data: scores }, { data: entries }] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_scores")
          .select("nurse_id, score, is_passing, educator_validated, educator_notes, assessed_at, validated_at, framework_competencies!competency_id(name)")
          .in("nurse_id", nurseIds).not("educator_id", "is", null).limit(2000)
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries")
          .select("nurse_id, skill_name, status, created_at, verified_at, verified_by_name")
          .in("nurse_id", nurseIds).in("status", ["verified", "rejected", "changes_requested"]).limit(2000)
      : Promise.resolve({ data: [] }),
  ]);

  const hours = (a: string | null, b: string | null) =>
    a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 36e5) : "";

  const header = ["Type", "Learner", "Item", "Outcome", "Score", "Submitted/Assessed", "Decided", "Turnaround (h)", "Reviewer"];
  const lines = [header.join(",")];
  for (const s of scores ?? []) {
    lines.push([
      "Score validation",
      esc(nameOf.get(s.nurse_id) ?? "—"),
      esc((s.framework_competencies as unknown as { name: string } | null)?.name ?? "—"),
      s.educator_validated ? "validated" : "returned",
      s.score ?? "",
      (s.assessed_at ?? "").slice(0, 10),
      (s.validated_at ?? "").slice(0, 10),
      hours(s.assessed_at, s.validated_at),
      "",
    ].join(","));
  }
  for (const e of entries ?? []) {
    lines.push([
      "Evidence verdict",
      esc(nameOf.get(e.nurse_id) ?? "—"),
      esc(e.skill_name),
      e.status,
      "",
      (e.created_at ?? "").slice(0, 10),
      (e.verified_at ?? "").slice(0, 10),
      hours(e.created_at, e.verified_at),
      esc(e.verified_by_name ?? ""),
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="validations-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
