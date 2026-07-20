import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEnterpriseGovernance } from "@/lib/enterprise-governance-data";
import { card, tone, barCls, pctText, ScopeBanner } from "../_ui";

export const dynamic = "force-dynamic";

// Regulatory Compliance (EGV-005) — audit compliance posture across organisations.
/* eslint-disable @typescript-eslint/no-explicit-any */

const rating = (n: number | null) => (n == null ? "No audits" : n >= 85 ? "Compliant" : n >= 60 ? "Partial" : "At risk");

export default async function RegulatoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadEnterpriseGovernance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { enterpriseName, scopeMode, benchmark, kpis } = d;
  const ranked = [...benchmark].sort((a, b) => (b.auditPct ?? -1) - (a.auditPct ?? -1));
  const noAudit = benchmark.filter(o => o.auditN === 0).length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Regulatory Compliance</h1>
          <p className="text-sm text-gray-500 mt-1">Audit compliance across the enterprise — the regulatory posture regulators and boards ask about.</p>
        </div>
        <ScopeBanner mode={scopeMode} name={enterpriseName} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${tone(kpis.avgCompliance)}`}>{pctText(kpis.avgCompliance)}</div><div className="text-xs text-gray-500 mt-1">Enterprise avg compliance</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{benchmark.length - noAudit}</div><div className="text-xs text-gray-500 mt-1">Organisations audited</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${noAudit ? "text-amber-600" : "text-gray-900"}`}>{noAudit}</div><div className="text-xs text-gray-500 mt-1">Awaiting first audit</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Compliance by organisation</h3>
        <div className="space-y-3">
          {ranked.map((o) => (
            <div key={o.id}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{o.name}</span>
                <span className="text-gray-500"><span className={tone(o.auditPct)}>{pctText(o.auditPct)}</span> · {rating(o.auditPct)}{o.auditN ? ` · ${o.auditN} audit${o.auditN !== 1 ? "s" : ""}` : ""}</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${o.auditPct == null ? "bg-gray-200" : barCls(o.auditPct)}`} style={{ width: `${o.auditPct ?? 0}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Derived from completed quality audits. Detailed findings, CAPA and accreditation readiness live in each organisation&apos;s <Link href="/quality-accreditation" className="text-teal-600 hover:underline">Quality &amp; Accreditation</Link> workspace.</p>
    </div>
  );
}
