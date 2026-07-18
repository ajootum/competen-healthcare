import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// CSV export of the assessor's completed assessments (spec §Reports —
// Excel-compatible). Only the caller's own records.
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: rows } = await admin.from("assessments")
    .select(`method, status, score, assessed_at, created_at,
      competency_cycles!cycle_id(cycle_type, profiles!nurse_id(full_name)),
      framework_competencies!competency_id(name, framework_domains!domain_id(name))`)
    .eq("assessor_id", user.id)
    .order("assessed_at", { ascending: false });

  const header = ["Nurse", "Competency", "Domain", "Method", "Status", "Score (0-6)", "Assessed At", "Created At"];
  const lines = [(header.join(","))];
  for (const a of rows ?? []) {
    const cyc = a.competency_cycles as unknown as { profiles: { full_name: string } | null } | null;
    const comp = a.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
    lines.push([
      esc(cyc?.profiles?.full_name), esc(comp?.name), esc(comp?.framework_domains?.name),
      esc(a.method), esc(a.status), esc(a.score ?? ""), esc(a.assessed_at ?? ""), esc(a.created_at),
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="assessment-history-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
