import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// CSV export of the Evidence Validation queue (spec header Export action):
// open entries with candidate, competency mapping, evidence counts, age and
// status — assessor-gated.
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

  const { data: rows } = await admin.from("skill_log_entries")
    .select(`id, skill_name, supervision_level, status, created_at, performed_at,
      profiles!nurse_id(full_name, specialization),
      framework_competencies!competency_id(name)`)
    .in("status", ["pending", "changes_requested", "escalated"]).neq("nurse_id", user.id)
    .order("created_at");

  const ids = (rows ?? []).map(r => r.id);
  const { data: evidence } = ids.length
    ? await admin.from("evidence").select("skill_log_entry_id, mime_type").in("skill_log_entry_id", ids)
    : { data: [] };
  const evCount = new Map<string, { photos: number; docs: number }>();
  for (const e of evidence ?? []) {
    const c = evCount.get(e.skill_log_entry_id) ?? { photos: 0, docs: 0 };
    if (e.mime_type.startsWith("image/")) c.photos++;
    else c.docs++;
    evCount.set(e.skill_log_entry_id, c);
  }

  const header = ["Candidate", "Department", "Skill", "Competency", "Supervision", "Status", "Submitted", "Performed", "Photos", "Documents", "Days Waiting"];
  const lines = [header.join(",")];
  const now = Date.now();
  for (const r of rows ?? []) {
    const prof = r.profiles as unknown as { full_name: string; specialization: string | null } | null;
    const comp = r.framework_competencies as unknown as { name: string } | null;
    const c = evCount.get(r.id) ?? { photos: 0, docs: 0 };
    lines.push([
      esc(prof?.full_name), esc(prof?.specialization ?? "General"), esc(r.skill_name), esc(comp?.name ?? ""),
      esc(r.supervision_level), esc(r.status), esc(r.created_at), esc(r.performed_at),
      c.photos, c.docs, Math.floor((now - new Date(r.created_at).getTime()) / 86400000),
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="evidence-queue-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
