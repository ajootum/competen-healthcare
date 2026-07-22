import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyCentre } from "@/lib/super-admin/ckp-competency";
import ArchitectureBuilder from "./ArchitectureBuilder";

export const dynamic = "force-dynamic";

// Competency & Framework Centre (CKP-001.2) — the competency architecture
// workspace. Frameworks by library, domain hierarchy, per-framework coverage,
// crosswalks and mapping. Live from the framework schema; fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const LIB_BADGE: Record<string, string> = { core: "bg-violet-50 text-violet-700", specialty: "bg-blue-50 text-blue-700", role: "bg-teal-50 text-teal-700" };

export default async function CompetencyFrameworkCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const cc = await loadCompetencyCentre(admin);
  const k = cc.kpis;

  const kpiCards = [
    { label: "Competencies", value: fmt(k.competencies), icon: "🎯", iconBg: "bg-violet-50" },
    { label: "Frameworks", value: fmt(k.frameworks), icon: "📐", iconBg: "bg-blue-50", sub: `${k.frameworksActive} active` },
    { label: "Domains", value: fmt(k.domains), icon: "🗂️", iconBg: "bg-teal-50" },
    { label: "Practices", value: fmt(k.practices), icon: "🧭", iconBg: "bg-sky-50" },
    { label: "Core Frameworks", value: fmt(k.core), icon: "🏛️", iconBg: "bg-violet-50" },
    { label: "Specialty", value: fmt(k.specialty), icon: "⭐", iconBg: "bg-blue-50" },
    { label: "Role Frameworks", value: fmt(k.role), icon: "👤", iconBg: "bg-teal-50" },
    { label: "Mapping Coverage", value: k.coverage == null ? "—" : `${k.coverage}%`, icon: "🔗", iconBg: "bg-amber-50", tone: k.coverage != null && k.coverage < 50 ? "text-amber-600" : "text-green-600" },
  ];

  const components = [
    { label: "Competency Library", icon: "🎯", href: "/super-admin/competencies" },
    { label: "Framework Library", icon: "📐", href: "/super-admin/content" },
    { label: "Domain Library", icon: "🗂️", href: "/super-admin/content" },
    { label: "Role Frameworks", icon: "👤", href: "/super-admin/content" },
    { label: "Crosswalks", icon: "🔗", href: "/super-admin/knowledge-graph" },
    { label: "Version History", icon: "🕓", href: "/super-admin/audit" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ckp" className="hover:text-teal-700">Clinical Knowledge Platform</Link><span>/</span><span className="text-gray-600">Competency &amp; Framework Centre</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Competency &amp; Framework Centre</h1>
        <p className="text-sm text-gray-500">Manage the competency architecture — libraries, frameworks, domains and crosswalks.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
            {(c as any).sub && <p className="text-[10px] text-gray-400 mt-0.5">{(c as any).sub}</p>}
          </div>
        ))}
      </div>

      {/* Real in-place architecture builder — framework → domain → competency */}
      <ArchitectureBuilder frameworks={cc.builderFrameworks} domains={cc.builderDomains} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Framework overview */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Framework Overview</h2>
            <Link href="/super-admin/content" className="text-xs text-teal-700 hover:underline">Manage →</Link>
          </div>
          {cc.frameworkOverview.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No frameworks yet.</p> : (
            <div className="space-y-3">
              {cc.frameworkOverview.map((f: any) => (
                <div key={f.id}>
                  <div className="flex items-center justify-between text-sm mb-0.5">
                    <span className="flex items-center gap-2 min-w-0"><span className="text-gray-800 font-medium truncate">{f.name}</span>{f.version && <span className="text-[10px] text-gray-400">{f.version}</span>}{f.library && <span className={`text-[9px] px-1.5 py-0.5 rounded ${LIB_BADGE[f.library] ?? "bg-gray-100 text-gray-500"}`}>{f.library}</span>}</span>
                    <span className="text-gray-500 tabular-nums shrink-0">{f.competencies} · {f.coverage}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${f.coverage}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Domain hierarchy */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Domain Hierarchy <span className="text-[10px] text-gray-400">top {cc.domainHierarchy.length}</span></h2>
            <Link href="/super-admin/content" className="text-xs text-teal-700 hover:underline">View all →</Link>
          </div>
          {cc.domainHierarchy.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No domains yet.</p> : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {cc.domainHierarchy.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between text-sm py-1">
                  <span className="flex items-center gap-2 min-w-0"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" /><span className="text-gray-700 truncate">{d.name}</span>{d.framework && <span className="text-[10px] text-gray-400 shrink-0">· {d.framework}</span>}</span>
                  <span className="text-gray-500 tabular-nums shrink-0">{d.competencies}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Library breakdown */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Frameworks by Library</h2>
          <div className="space-y-2">
            {[["Core", cc.byLibrary.core, "#8b5cf6"], ["Specialty", cc.byLibrary.specialty, "#3b82f6"], ["Role", cc.byLibrary.role, "#14b8a6"]].map(([l, n, color]) => (
              <div key={l as string}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{l}</span><span className="text-gray-500 tabular-nums">{n as number}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${cc.kpis.frameworks ? ((n as number) / cc.kpis.frameworks) * 100 : 0}%`, backgroundColor: color as string }} /></div>
              </div>
            ))}
          </div>
        </div>

        {/* Crosswalks & mapping */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Crosswalks &amp; Mapping</h2>
          <div className="grid grid-cols-2 gap-2">
            {[["Mappings", cc.mapping.mappings], ["Crosswalks", cc.mapping.crosswalks], ["Unmapped", cc.mapping.unmapped], ["Active Cycles", cc.mapping.activeCycles]].map(([l, n]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 p-3 text-center"><p className={`text-xl font-bold tabular-nums ${l === "Unmapped" && (n as number) > 0 ? "text-orange-600" : "text-gray-900"}`}>{fmt(n as number)}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Mappings = competencies linked to a CPU; crosswalks come from the knowledge graph.</p>
        </div>

        {/* Components */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Components</h2>
          <div className="grid grid-cols-2 gap-2">
            {components.map(c => (
              <Link key={c.label} href={c.href} className="flex flex-col items-center gap-1 rounded-lg border border-gray-100 py-3 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-lg">{c.icon}</span><span className="text-[11px] font-semibold text-gray-700 leading-tight">{c.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Competency & Framework Centre is the architecture layer — every competency belongs to a domain within a framework. The Architecture Builder creates real frameworks, domains and competencies in-place via the content APIs (each level feeds the next level's picker); counts, coverage and the domain hierarchy are live. Version history and crosswalks open the audit log and knowledge graph.</p>
    </div>
  );
}
