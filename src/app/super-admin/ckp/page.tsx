import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCkp } from "@/lib/super-admin/ckp";

export const dynamic = "force-dynamic";

// Clinical Knowledge Platform (CKP-001) — overview / landing dashboard. The
// authoritative home for all clinical, educational and operational knowledge:
// KPI ribbon, publishing pipeline, knowledge intelligence, assets by type,
// activity, tasks and the six-module directory. Live data; un-tracked metrics
// (duplicates, usage) show honest states. The six module workspaces ship next.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

function Panel({ title, href, linkLabel, badge, children }: { title: string; href?: string; linkLabel?: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">{title}{badge && <span className="ml-2 text-[10px] font-medium text-gray-400">{badge}</span>}</h2>
        {href && <Link href={href} className="text-xs text-teal-700 hover:underline shrink-0">{linkLabel ?? "View all"} →</Link>}
      </div>
      {children}
    </div>
  );
}

function Donut({ segments, total }: { segments: { label: string; n: number; color: string }[]; total: number }) {
  const C = 2 * Math.PI * 15.5;
  const arcs: { dash: number; offset: number; color: string }[] = [];
  let acc = 0;
  segments.forEach(s => { const dash = (total ? s.n / total : 0) * C; arcs.push({ dash, offset: acc, color: s.color }); acc += dash; });
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-28 h-28 shrink-0">
        <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" />
          {arcs.map((a, i) => <circle key={i} cx="18" cy="18" r="15.5" fill="none" stroke={a.color} strokeWidth="4" strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.offset} />)}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-bold text-gray-900 tabular-nums">{fmt(total)}</span><span className="text-[9px] text-gray-400">Total</span></div>
      </div>
      <div className="flex-1 space-y-1">
        {segments.map(s => (
          <div key={s.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-gray-600"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>
            <span className="tabular-nums text-gray-700">{fmt(s.n)} <span className="text-gray-300">· {total ? Math.round((s.n / total) * 100) : 0}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

const IMPACT_TONE: Record<string, string> = { High: "text-rose-600 bg-rose-50", Medium: "text-amber-600 bg-amber-50", Low: "text-gray-500 bg-gray-100" };

export default async function ClinicalKnowledgePlatform() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const ckp = await loadCkp(admin);
  const { kpis, pipeline, intelligence: intel, assetsByType, assetsTotal, activity, activityReady, tasks, modules } = ckp;

  const kpiCards = [
    { label: "Knowledge Health", value: kpis.health.pct == null ? "—" : `${kpis.health.pct}%`, sub: kpis.health.label, icon: "💚", iconBg: "bg-green-50", tone: kpis.health.tone },
    { label: "Draft Assets", value: fmt(kpis.draftAssets), sub: "in authoring", icon: "📝", iconBg: "bg-gray-50" },
    { label: "Pending Reviews", value: fmt(kpis.pendingReviews), sub: "awaiting sign-off", icon: "👀", iconBg: "bg-amber-50", tone: kpis.pendingReviews ? "text-amber-600" : undefined },
    { label: "Published CPUs", value: fmt(kpis.publishedCPUs), sub: "clinical practice units", icon: "🧩", iconBg: "bg-blue-50" },
    { label: "Frameworks", value: fmt(kpis.frameworks), sub: "competency frameworks", icon: "📐", iconBg: "bg-violet-50" },
    { label: "Assessments", value: fmt(kpis.assessments), sub: "assessment assets", icon: "🎯", iconBg: "bg-orange-50" },
    { label: "Policies & Guidelines", value: fmt(kpis.policiesGuidelines), sub: "governance content", icon: "📋", iconBg: "bg-rose-50" },
    { label: "Knowledge Objects", value: fmt(kpis.knowledgeObjects), sub: "CKOs", icon: "🧠", iconBg: "bg-teal-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clinical Knowledge Platform</h1>
          <p className="text-sm text-gray-500">Create, govern and publish the clinical knowledge that powers Competen.</p>
        </div>
        <span className="text-xs text-gray-400 tabular-nums">Updated {new Date(ckp.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(k as any).tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Publishing pipeline · Knowledge intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Publishing Pipeline" href="/super-admin/governance/committees" linkLabel="View pipeline">
          <div className="flex items-center justify-between gap-1">
            {pipeline.map((p: any, i: number) => (
              <div key={p.stage} className="flex items-center gap-1 flex-1">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <span className="w-10 h-10 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-base">{p.icon}</span>
                  <span className="text-xl font-bold text-gray-900 tabular-nums">{fmt(p.count)}</span>
                  <span className="text-[9px] text-gray-500 text-center leading-tight">{p.stage}</span>
                </div>
                {i < pipeline.length - 1 && <span className="text-gray-300 shrink-0">→</span>}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Knowledge Intelligence" href="/super-admin/knowledge-graph" linkLabel="View analytics">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xl font-bold text-gray-900 tabular-nums">{intel.coverageScore == null ? "—" : `${intel.coverageScore}%`}</p>
              <p className="text-[10px] text-gray-500">Coverage Score</p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xl font-bold text-orange-600 tabular-nums">{fmt(intel.missingCompetencies)}</p>
              <p className="text-[10px] text-gray-500">Missing Competencies</p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xl font-bold text-gray-400 tabular-nums">—</p>
              <p className="text-[10px] text-gray-400">Duplicates · not computed</p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-xl font-bold text-gray-400 tabular-nums">—</p>
              <p className="text-[10px] text-gray-400">Low Usage · not metered</p>
            </div>
          </div>
          {intel.recommendations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-50 space-y-1.5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase">Top AI Recommendations</p>
              {intel.recommendations.map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">✨ {r.text}</span><span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 ${IMPACT_TONE[r.impact]}`}>{r.impact}</span></div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Assets · Activity · Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Knowledge Assets by Type" href="/super-admin/studio" linkLabel="View all assets">
          {assetsByType.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No knowledge assets yet.</p> : <Donut segments={assetsByType} total={assetsTotal} />}
        </Panel>

        <Panel title="Recent Knowledge Activity" href="/super-admin/audit" linkLabel="View all">
          {!activityReady || activity.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{activityReady ? "No recorded activity yet." : "Activity feed unavailable."}</p> : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {activity.slice(0, 8).map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5"><span className="text-sm mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{a.title}</p>{a.detail && <p className="text-[10px] text-gray-400 truncate capitalize">{a.detail}</p>}</div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="My Tasks & Approvals" href="/super-admin/platform-ops/approvals" linkLabel="View queue">
          {tasks.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">✅ No pending knowledge tasks.</p> : (
            <div className="space-y-2.5">
              {tasks.map((t: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5"><span className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0 mt-1.5" />
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{t.title}</p><p className="text-[10px] text-gray-400 truncate capitalize">{t.detail}{t.by ? ` · ${t.by}` : ""}</p></div>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(t.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 6-module directory */}
      <Panel title="Clinical Knowledge Platform — 6 modules">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {modules.map((m: any) => (
            <Link key={m.n} href={m.href} className="flex items-start gap-3 rounded-lg border border-gray-100 p-4 hover:border-teal-300 hover:bg-teal-50/30 transition-colors">
              <span className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-200 flex items-center justify-center text-base shrink-0">{m.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><span className="text-[10px] font-bold text-gray-400">{m.n}</span><span className="text-sm font-semibold text-gray-900">{m.name}</span></div>
                <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{m.desc}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {m.subs.slice(0, 4).map((sub: string) => <span key={sub} className="text-[9px] text-gray-400 bg-gray-50 rounded px-1.5 py-0.5">{sub}</span>)}
                </div>
                <p className="text-[10px] font-medium text-teal-600 mt-1.5">{m.stat}</p>
              </div>
            </Link>
          ))}
        </div>
      </Panel>

      <p className="text-[11px] text-gray-400 pb-4">The Clinical Knowledge Platform is the authoritative source for every competency, CPU, CKO, framework, assessment, policy and clinical guideline. Counts, pipeline and coverage are live from the knowledge schema; duplicate detection and usage telemetry show honest “not computed” states until those engines run. The six module workspaces (Knowledge Studio first) land in the next phases — cards currently open the closest live surface.</p>
    </div>
  );
}
