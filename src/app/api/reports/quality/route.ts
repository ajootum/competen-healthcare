import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Quality & Governance CSV export: all audits for the hospital with type,
// criteria source competency, compliance and linked CAPA counts.
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
  if (!roles.some(r => ["assessor", "educator", "hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!me?.hospital_id) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });

  const [{ data: audits }, { data: capa }] = await Promise.all([
    admin.from("audits")
      .select("id, audit_type, title, area, record_ref, compliance_pct, items_met, items_not_met, items_na, conducted_by_name, conducted_at, framework_competencies!competency_id(name), profiles!nurse_id(full_name)")
      .eq("hospital_id", me.hospital_id).order("conducted_at", { ascending: false }).limit(1000),
    admin.from("capa_actions").select("audit_id").eq("hospital_id", me.hospital_id).not("audit_id", "is", null),
  ]);

  const capaByAudit = new Map<string, number>();
  for (const c of capa ?? []) capaByAudit.set(c.audit_id!, (capaByAudit.get(c.audit_id!) ?? 0) + 1);

  const header = ["Date", "Type", "Title", "Criteria Competency", "Subject", "Area", "Record Ref", "Compliance %", "Met", "Not Met", "N/A", "CAPA Actions", "Conducted By"];
  const lines = [header.join(",")];
  for (const a of audits ?? []) {
    lines.push([
      (a.conducted_at ?? "").slice(0, 10),
      a.audit_type,
      esc(a.title),
      esc((a.framework_competencies as unknown as { name: string } | null)?.name ?? ""),
      esc((a.profiles as unknown as { full_name: string } | null)?.full_name ?? ""),
      esc(a.area ?? ""), esc(a.record_ref ?? ""),
      a.compliance_pct ?? "",
      a.items_met, a.items_not_met, a.items_na,
      capaByAudit.get(a.id) ?? 0,
      esc(a.conducted_by_name ?? ""),
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="quality-audits-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
