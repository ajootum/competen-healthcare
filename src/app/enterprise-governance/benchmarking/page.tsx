import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadEnterpriseGovernance } from "@/lib/enterprise-governance-data";
import { card, tone, pctText, ScopeBanner, BenchmarkTable } from "../_ui";

export const dynamic = "force-dynamic";

// Enterprise Benchmarking (EGV-004) — organisations compared across governance metrics.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function BenchmarkingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadEnterpriseGovernance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { enterpriseName, scopeMode, benchmark, kpis, truncated } = d;
  const withComp = benchmark.filter(o => o.compPct != null);
  const best = withComp[0] ?? null;
  const worst = withComp.length ? withComp[withComp.length - 1] : null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise Benchmarking</h1>
          <p className="text-sm text-gray-500 mt-1">Organisations ranked by competency currency, with quality compliance and workforce scale.</p>
        </div>
        <ScopeBanner mode={scopeMode} name={enterpriseName} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${tone(kpis.avgCompetency)}`}>{pctText(kpis.avgCompetency)}</div><div className="text-xs text-gray-500 mt-1">Enterprise avg competency</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${tone(kpis.avgCompliance)}`}>{pctText(kpis.avgCompliance)}</div><div className="text-xs text-gray-500 mt-1">Enterprise avg compliance</div></div>
        <div className={card}><div className="text-lg font-bold text-gray-900 truncate">{best?.name ?? "—"}</div><div className="text-xs text-gray-500 mt-1">Top performer{best?.compPct != null ? ` · ${best.compPct}%` : ""}</div></div>
        <div className={card}><div className="text-lg font-bold text-gray-900 truncate">{worst?.name ?? "—"}</div><div className="text-xs text-gray-500 mt-1">Needs attention{worst?.compPct != null ? ` · ${worst.compPct}%` : ""}</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Organisation comparison</h3>
        <BenchmarkTable rows={benchmark} />
      </div>
      {truncated && <p className="text-[11px] text-amber-600">Figures are based on the most recent records and may be capped at this platform scale.</p>}
      <p className="text-[11px] text-gray-400">Competency currency = share of the latest assessed decisions that are passing and unexpired. Quality compliance = average compliance of completed audits. Organisations with no records show “—”.</p>
    </div>
  );
}
