import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import QualityTabs from "../QualityTabs";

export const dynamic = "force-dynamic";

// Quality & Safety sub-modules (UMG-QS-002..011). The Command Centre is the real landing surface; each of
// these surfaces its live status and routes to the authoritative store/surface (the SSW incident register,
// the audit/accreditation workspace, the enterprise risk register), or honestly notes a next-phase module.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SUBS: Record<string, { code: string; title: string; blurb: string; link?: { label: string; href: string }; phase: "live" | "next" }> = {
  accreditation: {
    code: "UMG-QS-005", title: "Accreditation Readiness",
    blurb: "Framework-by-framework accreditation readiness (JCI, SafeCare), evidence repository and mock-survey scoring. The command centre shows the audit-compliance-derived readiness; the framework assessment and evidence repository live in the accreditation workspace.",
    link: { label: "Open accreditation workspace", href: "/quality-accreditation" }, phase: "live",
  },
  analytics: {
    code: "UMG-QS-010", title: "Quality Analytics",
    blurb: "Cross-domain quality analytics — trend decomposition, benchmarking and drill-down. The command centre surfaces the live KPI ribbon, incident trend and risk heat map; the 12-month composite quality trend and benchmarking need a persisted analytics-snapshot history (next-phase). Clinical analytics over the live census are available now.",
    link: { label: "Open clinical analytics", href: "/unit-manager/patient-operations/analytics" }, phase: "live",
  },
  ai: {
    code: "UMG-QS-011", title: "AI Quality Intelligence",
    blurb: "AI-driven quality intelligence — explainable, rule-based recommendations generated from the live incident, audit, CAPA and risk state are on the command centre now. Predictive analytics (incident-probability forecasting, audit-gap prediction) are the next-phase deepening once an analytics-snapshot history accrues.",
    phase: "next",
  },
  mortality: {
    code: "UMG-QS-009", title: "Mortality & Morbidity",
    blurb: "Structured M&M review — case registration, review meetings, learning points and action tracking. This module needs its own store (mortality/morbidity cases and reviews) and is honestly next-phase; the incident register already captures sentinel events in the meantime.",
    phase: "next",
  },
};

export default async function QualitySubPage({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = ((profile?.roles?.length ? profile.roles : [profile?.role]) as any[]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const s = Object.hasOwn(SUBS, sub) ? SUBS[sub] : undefined;
  if (!s) redirect("/unit-manager/quality");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><span className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-lg">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900">Quality &amp; Safety</h1><p className="text-sm text-gray-500">{s.code} · {s.title}</p></div></div>
      <QualityTabs />
      <div className={`bg-white border border-gray-200 rounded-xl p-6 max-w-3xl`}>
        <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-1 mb-3 ${s.phase === "live" ? "text-emerald-600 bg-emerald-50 border border-emerald-100" : "text-amber-600 bg-amber-50 border border-amber-100"}`}>{s.phase === "live" ? "Live on command centre · authoritative surface" : "Next phase"}</span>
        <p className="text-sm text-gray-600 leading-relaxed">{s.blurb}</p>
        {s.link && <Link href={s.link.href} className="mt-4 inline-block text-sm font-medium text-rose-700 hover:underline">{s.link.label} →</Link>}
      </div>
    </div>
  );
}
