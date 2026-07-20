import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveDashboard } from "@/lib/executive-data";

export const dynamic = "force-dynamic";

// Enterprise Risk (HEX-007) — the executive risk register, derived from open
// corrective actions, audit findings, competency lapses and vacancies.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const sev: Record<string, { chip: string; dot: string; label: string }> = {
  high: { chip: "bg-red-50 border-red-200", dot: "bg-red-500", label: "text-red-700" },
  medium: { chip: "bg-amber-50 border-amber-200", dot: "bg-amber-500", label: "text-amber-700" },
  low: { chip: "bg-gray-50 border-gray-200", dot: "bg-gray-300", label: "text-gray-500" },
};

export default async function EnterpriseRisk() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadExecutiveDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { risk, riskTotal, riskHigh } = d;
  const active = risk.filter(r => r.count > 0);
  const clear = risk.filter(r => r.count === 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Enterprise Risk</h1>
        <p className="text-sm text-gray-500 mt-1">Open, actionable risks across quality, competency and workforce — each drills into its source.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{riskTotal}</div><div className="text-xs text-gray-500 mt-1">Open risk items</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${riskHigh ? "text-red-600" : "text-gray-900"}`}>{riskHigh}</div><div className="text-xs text-gray-500 mt-1">High severity</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{clear.length}</div><div className="text-xs text-gray-500 mt-1">Categories clear</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Risk register</h3>
        {active.length === 0 && <p className="text-sm text-green-700">✅ No open risks across the tracked categories.</p>}
        <div className="space-y-2">
          {active.map((r) => {
            const s = sev[r.severity];
            return (
              <Link key={r.label} href={r.href} className={`flex items-center gap-3 border rounded-lg px-4 py-3 hover:shadow-sm transition-shadow ${s.chip}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
                <span className="text-sm text-gray-800 flex-1">{r.label}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${s.label}`}>{r.severity}</span>
                <span className="text-lg font-bold tabular-nums text-gray-900 w-10 text-right">{r.count}</span>
                <span className="text-gray-300">→</span>
              </Link>
            );
          })}
        </div>
      </div>

      {clear.length > 0 && (
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Clear</h3>
          <div className="flex flex-wrap gap-2">
            {clear.map((r) => (
              <span key={r.label} className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">✓ {r.label}</span>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400">Risk categories are derived live from the Quality &amp; Accreditation, Competency and Human Resources workspaces. A dedicated enterprise risk-register module (owned risks with likelihood × impact scoring) is a later HEX phase.</p>
    </div>
  );
}
