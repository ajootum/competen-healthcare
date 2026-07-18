import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// CSV export of the Passport Centre queue: per-clinician passport health,
// validation backlog, expiries and evidence gaps — assessor-gated.
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

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Key = in30.toISOString().slice(0, 10);

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization").eq("hospital_id", me.hospital_id).eq("role", "nurse").order("full_name");
  const nurseIds = (nurses ?? []).map(x => x.id);

  const [{ data: decisions }, { data: pending }] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_decisions")
          .select("nurse_id, competency_id, outcome, validation_outcome, expiry_date, created_at")
          .in("nurse_id", nurseIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries").select("nurse_id").eq("status", "pending").in("nurse_id", nurseIds)
      : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set<string>();
  const agg = new Map<string, { competent: number; awaiting: number; expired: number; expSoon: number; notYet: number; total: number }>();
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = agg.get(d.nurse_id) ?? { competent: 0, awaiting: 0, expired: 0, expSoon: 0, notYet: 0, total: 0 };
    a.total++;
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (!passing) a.notYet++;
    else if (d.expiry_date && d.expiry_date < today) a.expired++;
    else if (d.validation_outcome === "validated") {
      a.competent++;
      if (d.expiry_date && d.expiry_date <= in30Key) a.expSoon++;
    } else a.awaiting++;
    agg.set(d.nurse_id, a);
  }
  const pendingByNurse = new Map<string, number>();
  for (const p of pending ?? []) pendingByNurse.set(p.nurse_id, (pendingByNurse.get(p.nurse_id) ?? 0) + 1);

  const header = ["Clinician", "Department", "Health %", "Validated", "Awaiting Validation", "Expired", "Expiring 30d", "Not Yet Competent", "Evidence Pending", "Total Decided"];
  const lines = [header.join(",")];
  for (const nu of nurses ?? []) {
    const a = agg.get(nu.id) ?? { competent: 0, awaiting: 0, expired: 0, expSoon: 0, notYet: 0, total: 0 };
    lines.push([
      esc(nu.full_name), esc(nu.specialization ?? "General"),
      a.total ? Math.round((a.competent / a.total) * 100) : "",
      a.competent, a.awaiting, a.expired, a.expSoon, a.notYet,
      pendingByNurse.get(nu.id) ?? 0, a.total,
    ].join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="passport-centre-${today}.csv"`,
    },
  });
}
