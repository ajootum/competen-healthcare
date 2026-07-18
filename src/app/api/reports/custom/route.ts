import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { OUTCOME_CONFIG, METHOD_LABELS, type AssessmentMethod, type DecisionOutcome } from "@/lib/ckcm";
import { DATASET_COLUMNS } from "@/lib/report-datasets";

// Custom report engine (Report Builder). Datasets and columns are whitelisted
// in @/lib/report-datasets — the builder can only parameterise these prebuilt,
// hospital-scoped queries, never arbitrary SQL. GET returns JSON
// ({columns, rows}) for preview or CSV with ?format=csv.
// Params: dataset, columns (csv), from, to (YYYY-MM-DD), department, assessor

type Row = Record<string, string | number | null>;

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
  const hospitalId = me?.hospital_id ?? null;
  if (!hospitalId) return NextResponse.json({ error: "No facility assigned" }, { status: 400 });

  const url = new URL(req.url);
  const dataset = url.searchParams.get("dataset") ?? "";
  const allCols = DATASET_COLUMNS[dataset];
  if (!allCols) {
    return NextResponse.json({ error: `dataset must be one of: ${Object.keys(DATASET_COLUMNS).join(", ")}` }, { status: 400 });
  }
  const wanted = (url.searchParams.get("columns") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const cols = wanted.length ? allCols.filter(c => wanted.includes(c.key)) : allCols;
  if (!cols.length) return NextResponse.json({ error: "No valid columns selected" }, { status: 400 });

  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const department = url.searchParams.get("department") || null;
  const assessorId = url.searchParams.get("assessor") || null;
  const fromIso = from ? `${from}T00:00:00Z` : null;
  const toIso = to ? `${to}T23:59:59Z` : null;

  let rows: Row[] = [];

  if (dataset === "assessments") {
    let q = admin.from("assessments")
      .select("score, method, assessed_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name), competency_cycles!cycle_id(hospital_id, profiles!nurse_id(full_name, specialization))")
      .eq("status", "complete").not("score", "is", null)
      .order("assessed_at", { ascending: false }).limit(2000);
    if (fromIso) q = q.gte("assessed_at", fromIso);
    if (toIso) q = q.lte("assessed_at", toIso);
    if (assessorId) q = q.eq("assessor_id", assessorId);
    const { data } = await q;
    rows = (data ?? [])
      .filter(a => {
        const c = a.competency_cycles as unknown as { hospital_id: string | null; profiles: { specialization: string | null } | null } | null;
        if (c?.hospital_id !== hospitalId) return false;
        if (department && (c?.profiles?.specialization ?? "General") !== department) return false;
        return true;
      })
      .map(a => {
        const c = a.competency_cycles as unknown as { profiles: { full_name: string; specialization: string | null } | null };
        return {
          date: (a.assessed_at as string).slice(0, 10),
          learner: c.profiles?.full_name ?? "—",
          department: c.profiles?.specialization ?? "General",
          assessor: (a.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
          method: METHOD_LABELS[a.method as AssessmentMethod] ?? (a.method as string),
          competency: (a.framework_competencies as unknown as { name: string } | null)?.name ?? "—",
          score: a.score as number,
          passing: (a.score as number) >= 3 ? "yes" : "no",
        };
      });
  }

  if (dataset === "learners") {
    const { data: nurses } = await admin.from("profiles")
      .select("id, full_name, specialization").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name");
    const list = (nurses ?? []).filter(n => !department || (n.specialization ?? "General") === department);
    const ids = list.map(n => n.id);
    const { data: decisions } = ids.length
      ? await admin.from("competency_decisions")
          .select("nurse_id, competency_id, outcome, expiry_date, critical_failure, created_at")
          .in("nurse_id", ids).order("created_at", { ascending: false }).limit(4000)
      : { data: [] };
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    const agg = new Map<string, { pass: number; total: number; expired: number; risk: string }>();
    for (const d of decisions ?? []) {
      const key = `${d.nurse_id}:${d.competency_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = agg.get(d.nurse_id) ?? { pass: 0, total: 0, expired: 0, risk: "low" };
      a.total++;
      const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
      const expired = passing && d.expiry_date && d.expiry_date < today;
      if (expired) a.expired++;
      if (passing && !expired) a.pass++;
      if (d.critical_failure) a.risk = "high";
      else if ((!passing || expired) && a.risk !== "high") a.risk = "medium";
      agg.set(d.nurse_id, a);
    }
    rows = list.map(n => {
      const a = agg.get(n.id);
      return {
        learner: n.full_name,
        department: n.specialization ?? "General",
        decided: a?.total ?? 0,
        passing_pct: a?.total ? Math.round(a.pass / a.total * 100) : null,
        expired: a?.expired ?? 0,
        risk: a?.risk ?? "low",
      };
    });
  }

  if (dataset === "evidence") {
    let q = admin.from("skill_log_entries")
      .select("status, created_at, verified_at, profiles!nurse_id(full_name, specialization, hospital_id)")
      .order("created_at", { ascending: false }).limit(2000);
    if (fromIso) q = q.gte("created_at", fromIso);
    if (toIso) q = q.lte("created_at", toIso);
    const { data } = await q;
    rows = (data ?? [])
      .filter(e => {
        const p = e.profiles as unknown as { hospital_id: string | null; specialization: string | null } | null;
        if (p?.hospital_id !== hospitalId) return false;
        if (department && (p?.specialization ?? "General") !== department) return false;
        return true;
      })
      .map(e => {
        const p = e.profiles as unknown as { full_name: string; specialization: string | null };
        return {
          date: (e.created_at as string).slice(0, 10),
          learner: p.full_name,
          department: p.specialization ?? "General",
          status: e.status as string,
          hours_to_verify: e.verified_at
            ? Math.round((new Date(e.verified_at as string).getTime() - new Date(e.created_at as string).getTime()) / 36e5)
            : null,
        };
      });
  }

  if (dataset === "audits") {
    let q = admin.from("audits")
      .select("audit_type, title, compliance_pct, items_met, items_not_met, conducted_by, conducted_by_name, conducted_at")
      .eq("hospital_id", hospitalId).order("conducted_at", { ascending: false }).limit(2000);
    if (fromIso) q = q.gte("conducted_at", fromIso);
    if (toIso) q = q.lte("conducted_at", toIso);
    if (assessorId) q = q.eq("conducted_by", assessorId);
    const { data } = await q;
    rows = (data ?? []).map(a => ({
      date: (a.conducted_at as string).slice(0, 10),
      type: a.audit_type as string,
      title: a.title as string,
      compliance: a.compliance_pct != null ? Number(a.compliance_pct) : null,
      met: a.items_met as number,
      not_met: a.items_not_met as number,
      conducted_by: (a.conducted_by_name as string | null) ?? "—",
    }));
  }

  if (url.searchParams.get("format") === "csv") {
    const lines = [cols.map(c => c.label).join(",")];
    for (const r of rows) lines.push(cols.map(c => esc(r[c.key])).join(","));
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${dataset}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return NextResponse.json({ columns: cols, rows: rows.slice(0, 200), total: rows.length });
}
