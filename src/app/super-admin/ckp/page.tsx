import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCkp } from "@/lib/super-admin/ckp";

export const dynamic = "force-dynamic";

// Clinical Knowledge Platform (CKP-001) — 6-modules overview. The authoritative
// home for all clinical knowledge, presented as the six module cards (each with
// live KPIs and its sub-modules), matching the CKP overview mockup. Every card
// opens its full module workspace. Live data; fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ACCENT: Record<number, { badge: string; action: string }> = {
  1: { badge: "bg-violet-100 text-violet-700", action: "bg-violet-600 hover:bg-violet-700" },
  2: { badge: "bg-blue-100 text-blue-700", action: "bg-blue-600 hover:bg-blue-700" },
  3: { badge: "bg-green-100 text-green-700", action: "bg-green-600 hover:bg-green-700" },
  4: { badge: "bg-orange-100 text-orange-700", action: "bg-orange-600 hover:bg-orange-700" },
  5: { badge: "bg-rose-100 text-rose-700", action: "bg-rose-600 hover:bg-rose-700" },
  6: { badge: "bg-indigo-100 text-indigo-700", action: "bg-indigo-600 hover:bg-indigo-700" },
};
const TRUST = ["🤖 AI-Powered", "🕓 Version Controlled", "🔐 Role-Based Access", "⚖️ Audit & Governance", "🧩 Integrated Platform", "🛡️ Secure & Compliant"];

export default async function ClinicalKnowledgePlatform() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const ckp = await loadCkp(admin);

  return (
    <div data-wide className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Clinical Knowledge Platform</h1>
          <p className="text-sm text-gray-500">Create, govern and publish the clinical knowledge that powers Competen — six modules.</p>
        </div>
        <span className="text-xs text-gray-400 tabular-nums">Updated {new Date(ckp.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {/* Six module cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {ckp.modules.map((m: any) => {
          const ac = ACCENT[m.n] ?? ACCENT[1];
          return (
            <div key={m.n} className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col hover:border-teal-300 hover:shadow-sm transition-all">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className={`w-7 h-7 rounded-lg ${ac.badge} flex items-center justify-center text-sm font-bold shrink-0`}>{m.n}</span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-gray-900 leading-tight">{m.name}</h2>
                    <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{m.desc}</p>
                  </div>
                </div>
                <Link href={m.href} className={`text-[11px] font-semibold text-white rounded-lg px-2.5 py-1.5 shrink-0 ${ac.action}`}>{m.action}</Link>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-3">
                {m.kpis.map((k: any) => (
                  <div key={k.label} className="rounded-lg border border-gray-100 py-2 px-1 text-center">
                    <p className="text-lg font-bold text-gray-900 tabular-nums leading-none">{k.value}</p>
                    <p className="text-[9px] text-gray-500 mt-1 leading-tight">{k.label}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {m.subs.map((s: string) => <span key={s} className="text-[9px] text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{s}</span>)}
              </div>

              <Link href={m.href} className="mt-auto text-xs font-semibold text-teal-700 hover:underline">Open {m.name.split(" ")[0]} workspace →</Link>
            </div>
          );
        })}
      </div>

      {/* Trust / capability footer */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        {TRUST.map(t => <span key={t} className="text-[11px] font-medium text-gray-500">{t}</span>)}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Clinical Knowledge Platform is the authoritative source for every competency, CPU, CKO, framework, assessment, policy and clinical guideline. Each module’s KPIs are live from the knowledge schema; open a module for its full workspace. Metrics the platform doesn’t track (duplicate detection, usage analytics) show honest states inside each module.</p>
    </div>
  );
}
