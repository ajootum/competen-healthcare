import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitIntelligence } from "@/lib/operations/ai-intelligence";
import AiTabs from "../AiTabs";

// AI & Intelligence → Executive Recommendations (UMG-AI). The full prioritised cross-domain recommendation
// queue — the same consolidated signals as the command centre, grouped by domain, each routing to its
// authoritative audited surface. Explainable, real, decision-support. No migration.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const TONE: Record<string, string> = { red: "border-rose-200 bg-rose-50", amber: "border-amber-200 bg-amber-50", blue: "border-blue-200 bg-blue-50", gray: "border-gray-200 bg-gray-50", green: "border-emerald-200 bg-emerald-50" };
const DOT: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500", gray: "bg-gray-300", green: "bg-emerald-500" };
const LABEL: Record<string, string> = { red: "Critical", amber: "Priority", blue: "Info", gray: "Watch", green: "Stable" };

export default async function RecommendationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadUnitIntelligence(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const card = "bg-white rounded-xl border border-gray-200 p-5";
  const recs: any[] = d.recommendations ?? [];
  const byDomain = [...new Set(recs.map(r => r.domain))].map(dom => ({ domain: dom, items: recs.filter(r => r.domain === dom) }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Executive Recommendations</h1>
        <p className="text-sm text-gray-500 mt-1">Every open cross-domain signal on your unit, ranked by impact — each routes to its authoritative surface to act.</p>
      </div>
      <AiTabs />

      {!d.provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">Unit intelligence isn&apos;t available yet.</div>
      ) : recs.length === 0 ? (
        <div className={card}><p className="text-sm text-gray-400">No open recommendations — the unit&apos;s cross-domain signals are stable. 🎉</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total", value: recs.length, tone: "text-gray-900" },
              { label: "Critical", value: d.criticalCount, tone: d.criticalCount ? "text-rose-600" : "text-gray-900" },
              { label: "Priority", value: d.warnCount, tone: d.warnCount ? "text-amber-600" : "text-gray-900" },
              { label: "Domains affected", value: byDomain.length, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className={card}><div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</div><div className="text-xs text-gray-500 mt-1 font-medium">{k.label}</div></div>
            ))}
          </div>

          {/* Full ranked queue */}
          <div className={card}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Ranked queue</h3>
            <div className="space-y-2">
              {recs.map((rc: any, i: number) => (
                <Link key={i} href={rc.href} className={`flex items-start gap-3 rounded-lg border p-3 transition-all hover:shadow-sm ${TONE[rc.tone] ?? TONE.gray}`}>
                  <span className="text-[10px] font-bold text-gray-400 tabular-nums w-5 text-right shrink-0 pt-0.5">{i + 1}</span>
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT[rc.tone] ?? DOT.gray}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-semibold text-gray-800">{rc.title}</p><span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{rc.domain}</span><span className={`text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${rc.tone === "red" ? "bg-rose-100 text-rose-600" : rc.tone === "amber" ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-500"}`}>{LABEL[rc.tone] ?? rc.tone}</span></div>
                    <p className="text-xs text-gray-500 mt-0.5">{rc.detail}</p>
                  </div>
                  <span className="text-[11px] text-violet-600 font-medium shrink-0 self-center">Act →</span>
                </Link>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400">Explainable, decision-support recommendations over real unit data — acting on any item routes to its authoritative, audited surface. Generated {new Date(d.generatedAt).toLocaleString()}.</p>
        </>
      )}
    </div>
  );
}
