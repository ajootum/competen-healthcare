import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadToolsHub } from "@/lib/tools-hub";
import CommandBar from "./CommandBar";
import AiAssistant from "./AiAssistant";

// Tools & Settings — the Educator Productivity & Administration hub (spec v1.0 +
// mockup). Light-themed landing: KPI tiles, quick-access tool launchers, recent
// activity, pending approvals, top content and a browse-all-tools grid over the
// five sections, with an AI assistant rail and a live command bar.
//
// Honest-UI: KPIs, activity, approvals and content are live from real records;
// modules with no store yet are flagged "soon" (no dead links); AI-usage metering
// and per-asset favourites/deadlines aren't tracked, so those are shown honestly.

export const dynamic = "force-dynamic";

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
};
const STATUS_CLS: Record<string, string> = { Draft: "bg-gray-100 text-gray-600", Review: "bg-amber-100 text-amber-700", review: "bg-amber-100 text-amber-700", pending: "bg-amber-100 text-amber-700", Published: "bg-emerald-100 text-emerald-700" };

export default async function ToolsHubPage() {
  const { admin, hospitalId, name } = await requireEducatorAccess();
  const d = await loadToolsHub(admin, hospitalId ?? "");
  const firstName = (name?.split(" ")[0]) ?? "Educator";

  const insights = [
    { icon: "🗂️", text: `${d.kpis[0].value ?? 0} content assets in your workspace — reuse them as templates.` },
    { icon: "📤", text: d.approvals.length ? `${d.approvals.length} item${d.approvals.length === 1 ? "" : "s"} awaiting review in the publishing queue.` : "Nothing is waiting for review — your queue is clear." },
    { icon: "📚", text: `${d.kpis[3].value ?? 0} knowledge & scenario resources available to import into new work.` },
  ];

  return (
    <div className="max-w-[1400px]">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">Productivity &amp; Administration Centre</h1>
        <p className="text-gray-500 text-sm">Your professional tools, templates, resources and workspace settings</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {d.kpis.map(k => (
          <div key={k.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${k.muted ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2 mb-2"><span className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${k.tint}`}>{k.icon}</span><span className="text-[12px] text-gray-500 font-medium leading-tight">{k.label}</span></div>
            <p className="text-2xl font-extrabold text-gray-900">{k.value === null ? "—" : k.value.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5">
        {/* ── Main ── */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Quick access tools */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Quick Access Tools</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {d.quickTools.map(t => t.soon ? (
                <div key={t.label} title="Coming soon — needs a backing store" className="rounded-xl border border-dashed border-gray-200 p-3.5 bg-gray-50/60 cursor-default">
                  <span className="text-xl opacity-50">{t.icon}</span>
                  <p className="text-[13px] font-bold text-gray-400 mt-1.5 leading-tight flex items-center gap-1.5">{t.label}<span className="text-[8px] font-bold uppercase text-gray-400 bg-gray-100 rounded px-1 py-0.5">soon</span></p>
                  <p className="text-[11px] text-gray-400 leading-tight">{t.desc}</p>
                </div>
              ) : (
                <Link key={t.label} href={t.href!} className="rounded-xl border border-gray-200 p-3.5 hover:border-violet-300 hover:bg-violet-50/40 transition-colors">
                  <span className="text-xl">{t.icon}</span>
                  <p className="text-[13px] font-bold text-gray-800 mt-1.5 leading-tight">{t.label}</p>
                  <p className="text-[11px] text-gray-500 leading-tight">{t.desc}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent activity + pending approvals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Recent Activity</p>
              {d.activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded activity yet.</p> : (
                <div className="flex flex-col gap-2.5">
                  {d.activity.map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-xs shrink-0">📌</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-gray-800 leading-tight"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-500"> — {a.entity}</span> : null}</p>
                        <p className="text-[10px] text-gray-400">{relTime(a.when)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Pending Approvals</p>
              {d.approvals.length === 0 ? <p className="text-[12px] text-emerald-600">Nothing awaiting review.</p> : (
                <div className="flex flex-col gap-2">
                  {d.approvals.map((a, i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 px-2.5 py-2">
                      <span className="min-w-0 flex-1"><span className="block text-[12px] text-gray-800 truncate leading-tight">{a.title}</span><span className="text-[10px] text-gray-400">{a.kind}</span></span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_CLS[a.status] ?? "bg-gray-100 text-gray-600"}`}>{a.status}</span>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/educator/studio/publishing" className="inline-block text-[11px] text-violet-600 hover:text-violet-700 mt-2">Open publishing queue →</Link>
            </div>
          </div>

          {/* Top content / favourites */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Recent Content <span className="normal-case font-normal text-gray-400">(favourites need a usage store — recent shown)</span></p>
            {d.templates.length === 0 ? <p className="text-[12px] text-gray-400">No content assets yet.</p> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {d.templates.map((t, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-3">
                    <span className="text-lg">📄</span>
                    <p className="text-[12px] font-semibold text-gray-800 mt-1 leading-tight line-clamp-2">{t.title}</p>
                    <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded mt-1.5 ${STATUS_CLS[t.status] ?? "bg-gray-100 text-gray-600"}`}>{t.kind}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Browse all tools (5 sections) */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">All Modules</p>
            <div className="flex flex-col gap-4">
              {d.sections.map(s => (
                <div key={s.title}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{s.title}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {s.modules.map(m => m.soon ? (
                      <div key={m.label} title="Coming soon — needs a backing store" className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-2.5 py-2 bg-gray-50/60">
                        <span className="text-sm opacity-50">{m.icon}</span>
                        <span className="min-w-0"><span className="block text-[11px] text-gray-400 leading-tight truncate">{m.label}</span></span>
                        <span className="ml-auto text-[7px] font-bold uppercase text-gray-400 bg-gray-100 rounded px-1 py-0.5">soon</span>
                      </div>
                    ) : (
                      <Link key={m.label} href={m.href!} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 hover:border-violet-300 hover:bg-violet-50/40 transition-colors">
                        <span className="text-sm">{m.icon}</span>
                        <span className="text-[11px] text-gray-700 leading-tight truncate">{m.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <CommandBar aiConfigured={d.aiConfigured} />
        </div>

        {/* ── Right rail ── */}
        <div className="flex flex-col gap-5 min-w-0">
          <AiAssistant name={firstName} aiConfigured={d.aiConfigured} />

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">Productivity Insights</p>
            <div className="flex flex-col gap-2">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2"><span className="text-sm">{ins.icon}</span><span className="text-[11px] text-gray-600 leading-tight">{ins.text}</span></div>
              ))}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">Insights derived from your live content &amp; queue. Usage-trend analytics need an activity-metering store.</p>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">Needs Your Attention</p>
            {d.approvals.length === 0 ? <p className="text-[12px] text-emerald-600">You&apos;re all caught up.</p> : (
              <div className="flex flex-col gap-1.5">
                {d.approvals.slice(0, 4).map((a, i) => (
                  <Link key={i} href="/educator/approvals" className="flex items-center gap-2 text-[11px] text-gray-700 hover:text-violet-700 py-0.5"><span className="text-amber-500">●</span><span className="truncate flex-1">{a.title}</span><span className="text-gray-400 text-[9px]">{a.kind}</span></Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
