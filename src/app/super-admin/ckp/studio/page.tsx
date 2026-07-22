import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadKnowledgeStudio } from "@/lib/super-admin/ckp-studio";
import StudioBuilder from "./StudioBuilder";

export const dynamic = "force-dynamic";

// Knowledge Studio (CKP-001.1) — the authoring factory. Every knowledge asset is
// designed here. Authoring-status KPIs, the asset builders, cross-type recent
// work, and the AI Authoring Assistant. Builders open the real authoring
// surfaces that already exist; live data, fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };

const STATUS_BADGE: Record<string, string> = { draft: "bg-gray-100 text-gray-600", in_review: "bg-amber-50 text-amber-700", approved: "bg-blue-50 text-blue-700", published: "bg-green-50 text-green-700", active: "bg-green-50 text-green-700", retired: "bg-gray-100 text-gray-400", archived: "bg-gray-100 text-gray-400" };

// Asset builders → the real authoring surface each opens. `soon` = no surface yet.
const BUILDERS = [
  { label: "Competency Builder", icon: "🎯", href: "/super-admin/content" },
  { label: "CPU Builder", icon: "🧩", href: "/super-admin/studio/cpus" },
  { label: "CKO Builder", icon: "🧠", href: "/super-admin/studio/knowledge" },
  { label: "Learning Builder", icon: "📚", href: "/super-admin/studio" },
  { label: "Assessment Builder", icon: "📝", href: "/super-admin/assessment-methods" },
  { label: "Simulation Builder", icon: "🧪", href: "/super-admin/studio/cases" },
  { label: "Policy Builder", icon: "📋", href: "/super-admin/policy-manager" },
  { label: "Workflow Builder", icon: "🔀", href: "/super-admin/workflows" },
  { label: "Decision Tree Builder", icon: "🌳", soon: true },
  { label: "AI Authoring Assistant", icon: "✨", href: "/super-admin/assistant" },
];

export default async function KnowledgeStudio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const s = await loadKnowledgeStudio(admin);
  const k = s.kpis;

  const kpiCards = [
    { label: "Total Assets", value: fmt(k.total), icon: "📦", iconBg: "bg-violet-50" },
    { label: "Draft Assets", value: fmt(k.drafts), icon: "📝", iconBg: "bg-gray-50" },
    { label: "Awaiting Review", value: fmt(k.awaitingReview), icon: "👀", iconBg: "bg-amber-50", tone: k.awaitingReview ? "text-amber-600" : undefined },
    { label: "Published", value: fmt(k.published), icon: "✅", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "Archived", value: fmt(k.archived), icon: "🗄️", iconBg: "bg-gray-50", tone: "text-gray-400" },
    { label: "AI Suggestions", value: fmt(k.suggestions), icon: "✨", iconBg: "bg-teal-50", tone: k.suggestions ? "text-teal-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ckp" className="hover:text-teal-700">Clinical Knowledge Platform</Link><span>/</span><span className="text-gray-600">Knowledge Studio</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Knowledge Studio</h1>
        <p className="text-sm text-gray-500">Design, create and author every knowledge asset — the content factory.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real in-Studio builder canvas — creates live draft assets via the content APIs */}
      <StudioBuilder domains={s.domains} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Full authoring surfaces */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-1">Full Authoring Surfaces</h2>
          <p className="text-xs text-gray-500 mb-3">The canvas above creates drafts fast; open a full surface for rich, multi-step authoring.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {BUILDERS.map(b => {
              const Wrap: any = b.soon ? "div" : Link;
              return (
                <Wrap key={b.label} {...(b.soon ? {} : { href: b.href })} className={`flex items-center gap-2.5 rounded-lg border border-gray-100 p-3 ${b.soon ? "opacity-60" : "hover:border-teal-300 hover:bg-teal-50/40 transition-colors"}`}>
                  <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{b.icon}</span>
                  <div className="min-w-0"><p className="text-sm font-medium text-gray-800 leading-tight">{b.label}</p>{b.soon && <p className="text-[9px] text-amber-600">soon</p>}</div>
                </Wrap>
              );
            })}
          </div>
        </div>

        {/* AI Authoring Assistant */}
        <div className={`${card} p-5 flex flex-col`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-2">AI Authoring Assistant</h2>
          <p className="text-sm text-gray-500 mb-3">Draft content, suggest competencies, generate assessments and run gap analysis across the knowledge base.</p>
          {s.suggestions.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {s.suggestions.map((sug: string, i: number) => <p key={i} className="text-xs text-gray-600 flex items-start gap-1.5">✨ <span>{sug}</span></p>)}
            </div>
          )}
          <Link href="/super-admin/assistant" className="mt-auto text-center text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3.5 py-2">Ask AI Assistant</Link>
        </div>
      </div>

      {/* Recent work */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 text-[15px]">Recent Work</h2>
          <Link href="/super-admin/studio" className="text-xs text-teal-700 hover:underline">Open Studio →</Link>
        </div>
        {s.recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No knowledge assets authored yet.</p> : (
          <div className="divide-y divide-gray-50">
            {s.recent.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{r.icon}</span>
                <div className="min-w-0 flex-1"><p className="text-sm text-gray-800 truncate">{r.title}</p><p className="text-[10px] text-gray-400">{r.type}</p></div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{(r.status ?? "").replace(/_/g, " ")}</span>
                <span className="text-[10px] text-gray-400 shrink-0 tabular-nums w-16 text-right">{relTime(r.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Knowledge Studio is the single authoring environment for every asset type. The builder canvas creates real draft CKOs, competencies, frameworks and policies in-place via the content APIs; full surfaces open the rich multi-step authoring tools. Authoring-status counts and recent work are live from the knowledge schema.</p>
    </div>
  );
}
