import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// CSV export of the admin dashboard's CPD & competency compliance table
// (previously a dead "#" button and a mailto). Scope mirrors the dashboard:
// the admin's facility, or all facilities for org-wide roles.
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles")
    .select("role, roles, hospital_id, org_role, organisation_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let hospitalIds: string[] = me?.hospital_id ? [me.hospital_id] : [];
  if (["chief_officer", "org_admin"].includes(me?.org_role ?? "") && me?.organisation_id) {
    const { data: orgHospitals } = await admin.from("hospitals").select("id").eq("organisation_id", me.organisation_id);
    hospitalIds = (orgHospitals ?? []).map(h => h.id);
  }
  if (!hospitalIds.length) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization").in("hospital_id", hospitalIds).eq("role", "nurse").order("full_name");
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [{ data: cpd }, { data: decisions }, { data: hospitals }] = await Promise.all([
    nurseIds.length ? admin.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds) : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("competency_decisions")
          .select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, created_at")
          .in("nurse_id", nurseIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    admin.from("hospitals").select("cpd_target_hours").in("id", hospitalIds),
  ]);

  const targets = [...new Set((hospitals ?? []).map(h => h.cpd_target_hours).filter((v): v is number => v != null).map(Number))];
  const target = targets.length === 1 ? targets[0] : null;

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const perNurse = new Map<string, { competent: number; awaiting: number; expired: number; notYet: number }>();
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const agg = perNurse.get(d.nurse_id) ?? { competent: 0, awaiting: 0, expired: 0, notYet: 0 };
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (!passing) agg.notYet++;
    else if (d.expiry_date && d.expiry_date < today) agg.expired++;
    else if (d.validation_outcome === "validated") agg.competent++;
    else agg.awaiting++;
    perNurse.set(d.nurse_id, agg);
  }

  const header = ["Nurse", "Ward", "CPD Hours", "Annual Target", "Competent", "Awaiting Validation", "Expired", "Not Yet Competent"];
  const lines = [header.join(",")];
  for (const n of nurses ?? []) {
    const hours = (cpd ?? []).filter(l => l.user_id === n.id).reduce((s, l) => s + Number(l.hours), 0);
    const agg = perNurse.get(n.id) ?? { competent: 0, awaiting: 0, expired: 0, notYet: 0 };
    lines.push([
      esc(n.full_name), esc(n.specialization ?? "General"), hours.toFixed(1), target ?? "not set",
      agg.competent, agg.awaiting, agg.expired, agg.notYet,
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cpd-compliance-${today}.csv"`,
    },
  });
}
