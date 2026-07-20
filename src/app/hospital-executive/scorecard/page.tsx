import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveDashboard } from "@/lib/executive-data";

export const dynamic = "force-dynamic";

// Organisational Performance (HEX-005) — the full hospital performance scorecard.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const tone = (n: number | null) => (n == null ? "text-gray-300" : n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");
const barCls = (n: number) => (n >= 85 ? "bg-green-500" : n >= 60 ? "bg-amber-500" : "bg-red-500");
const rating = (n: number | null) => (n == null ? "No data" : n >= 85 ? "Strong" : n >= 60 ? "Developing" : "Needs attention");

export default async function PerformanceScorecard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadExecutiveDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { scorecard, readinessIndex } = d;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organisational Performance</h1>
        <p className="text-sm text-gray-500 mt-1">The hospital performance scorecard — every domain traces to a governed workspace.</p>
      </div>

      {/* Composite index */}
      <div className={`${card} flex items-center gap-6`}>
        <div className="text-center shrink-0">
          <p className={`text-5xl font-bold tabular-nums ${tone(readinessIndex)}`}>{readinessIndex == null ? "—" : `${readinessIndex}%`}</p>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Organisational<br />Readiness Index</p>
        </div>
        <div className="flex-1 text-sm text-gray-500">
          <p>The readiness index is the mean of the scorecard domains that currently have live records. It is deliberately conservative — a domain with no data is excluded from the average rather than counted as zero, so the index reflects measured performance only.</p>
        </div>
      </div>

      {/* Scorecard rows */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-4">Performance domains</h3>
        <div className="space-y-4">
          {scorecard.map((s) => (
            <Link key={s.name} href={s.href} className="block group">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700 w-52 shrink-0 group-hover:text-teal-700">{s.name}</span>
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${s.score == null ? "bg-gray-200" : barCls(s.score)}`} style={{ width: `${Math.max(s.score ?? 0, 1)}%` }} />
                </div>
                <span className={`text-sm font-bold w-12 text-right tabular-nums ${tone(s.score)}`}>{s.score == null ? "—" : `${s.score}%`}</span>
                <span className="text-[11px] text-gray-400 w-28 text-right hidden md:block">{rating(s.score)}</span>
              </div>
              <p className="text-[11px] text-gray-400 ml-0 md:ml-[13.5rem] mt-0.5">{s.detail}</p>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Click any domain to drill into the workspace that owns the underlying data.</p>
    </div>
  );
}
