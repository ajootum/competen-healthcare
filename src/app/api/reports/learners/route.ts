import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// CSV export of the Learners page (Learners Redesign spec §7 bulk export):
// per-learner competency progress, risk and scheduling state — assessor-gated.
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

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization").eq("hospital_id", me.hospital_id).eq("role", "nurse").order("full_name");
  const nurseIds = (nurses ?? []).map(n => n.id);

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const [{ data: decisions }, { data: sessions }, { data: pending }] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_decisions")
          .select("nurse_id, competency_id, outcome, critical_failure, expiry_date, created_at")
          .in("nurse_id", nurseIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("scheduled_assessments").select("nurse_id, scheduled_for").eq("status", "scheduled")
          .in("nurse_id", nurseIds).gte("scheduled_for", nowIso).order("scheduled_for")
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries").select("nurse_id").eq("status", "pending").in("nurse_id", nurseIds)
      : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set<string>();
  const agg = new Map<string, { pass: number; total: number; notYet: number; expired: number; critical: number }>();
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = agg.get(d.nurse_id) ?? { pass: 0, total: 0, notYet: 0, expired: 0, critical: 0 };
    a.total++;
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (!passing) a.notYet++;
    else if (d.expiry_date && d.expiry_date < today) a.expired++;
    else a.pass++;
    if (d.critical_failure) a.critical++;
    agg.set(d.nurse_id, a);
  }
  const nextByNurse = new Map<string, string>();
  for (const s of sessions ?? []) if (!nextByNurse.has(s.nurse_id)) nextByNurse.set(s.nurse_id, s.scheduled_for);
  const pendingByNurse = new Map<string, number>();
  for (const p of pending ?? []) pendingByNurse.set(p.nurse_id, (pendingByNurse.get(p.nurse_id) ?? 0) + 1);

  const header = ["Learner", "Department", "Competencies Passing", "Total Decided", "Not Yet Competent", "Expired", "Risk", "Next Session", "Evidence Pending"];
  const lines = [header.join(",")];
  for (const n of nurses ?? []) {
    const a = agg.get(n.id) ?? { pass: 0, total: 0, notYet: 0, expired: 0, critical: 0 };
    const risk = a.critical > 0 || a.notYet > 0 ? "High" : a.expired > 0 ? "Medium" : "Low";
    lines.push([
      esc(n.full_name), esc(n.specialization ?? "General"),
      a.pass, a.total, a.notYet, a.expired, risk,
      esc(nextByNurse.get(n.id) ?? ""), pendingByNurse.get(n.id) ?? 0,
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="learners-${today}.csv"`,
    },
  });
}
