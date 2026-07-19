import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProfModule, PROF_MODULES } from "@/lib/professional-tools";
import Repository from "../Repository";
import CommandBar from "../CommandBar";
import AiAssistant from "../AiAssistant";

// Professional Tools — module workspace (dynamic route serving all eight
// modules; spec: every module shares one enterprise structure). Breadcrumb,
// header + purpose, six KPI cards, the create→archive workflow, the repository,
// quick actions, AI insights, an activity timeline, the AI assistant and a
// command bar.
//
// Honest-UI: KPI values and the repository are live for backed modules; the AI
// Generated / Shared / Version Compliance cards are muted because that metering
// doesn't exist yet. Quick Actions link to the live editor where one exists and
// otherwise read as "in the full editor"; AI Insights are derived from the real
// figures, never invented. Unbacked modules show an honest scaffold.

export const dynamic = "force-dynamic";

const WORKFLOW = ["Create", "Review", "Approve", "Publish", "Share", "Update", "Archive"];
const QUICK_ACTIONS = ["Create", "Import", "Export", "Share", "Publish", "Archive"];

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
};

export function generateStaticParams() {
  return PROF_MODULES.map(m => ({ module: m.slug }));
}

export default async function ModuleWorkspacePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: slug } = await params;
  const { admin, name } = await requireEducatorAccess();
  const data = await loadProfModule(admin, slug);
  if (!data) notFound();
  const { module: m, kpis, assets, activity, aiConfigured } = data;
  const firstName = name?.split(" ")[0] ?? "Educator";

  // Honest AI insights derived from the live figures (or a muted note).
  const total = kpis[0].value, pending = kpis[3].value, recent = kpis[4].value;
  const insights: string[] = m.live
    ? [
        `${typeof total === "number" ? total.toLocaleString() : "—"} ${m.countLabel.toLowerCase()} in this library.`,
        typeof pending === "number" && pending > 0 ? `${pending} awaiting review — clear the queue to keep versions current.` : "Nothing is waiting for review.",
        typeof recent === "number" && recent > 0 ? `${recent} added or updated in the last 7 days.` : "No new assets in the last 7 days.",
        "Duplicate detection and quality scoring activate once the analysis engine is connected.",
      ]
    : ["AI insights (duplicates, quality, usage, recommendations) become available once this module has a backing store."];

  return (
    <div className="max-w-[1400px]">
      {/* Breadcrumb + header */}
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5 flex-wrap">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><Link href="/educator/tools/professional" className="hover:text-violet-600">Professional Tools</Link>
        <span>›</span><span className="text-gray-600 font-medium">{m.title}</span>
      </nav>
      <div className="flex items-start gap-3 mb-5">
        <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${m.tint}`}>{m.icon}</span>
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">{m.title}</h1>
          <p className="text-gray-500 text-sm max-w-3xl">{m.purpose}</p>
        </div>
        {!m.live && <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1 self-center whitespace-nowrap">Scaffold · store soon</span>}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {kpis.map(k => (
          <div key={k.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${k.muted ? "opacity-60" : ""}`}>
            <p className="text-[11px] text-gray-500 font-medium leading-tight">{k.label}</p>
            <p className="text-2xl font-extrabold text-gray-900 mt-1">{k.value === null ? "—" : typeof k.value === "number" ? k.value.toLocaleString() : k.value}</p>
            <p className="text-[10px] text-gray-400 leading-tight">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Workflow strip */}
      <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4 mb-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Asset Lifecycle</p>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {WORKFLOW.map((step, i) => (
            <div key={step} className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">{step}</span>
              {i < WORKFLOW.length - 1 && <span className="text-gray-300 text-xs">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* Main */}
        <div className="flex flex-col gap-5 min-w-0">
          <Repository assets={assets} countLabel={m.countLabel} live={m.live} launchHref={m.launchHref} launchLabel={m.launchLabel} purpose={m.purpose} icon={m.icon} />
          <CommandBar aiConfigured={aiConfigured} />
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          {/* Quick actions */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Quick Actions</p>
            {m.launchHref && (
              <Link href={m.launchHref} className="flex items-center justify-center gap-1 text-[13px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 mb-3 transition-colors">{m.launchLabel ?? "Open full editor"} →</Link>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_ACTIONS.map(a => (
                <span key={a} title={m.launchHref ? "Available in the full editor" : "Coming soon"} className="text-[11px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-2.5 py-1.5 text-center cursor-default select-none">{a}</span>
              ))}
            </div>
            <p className="text-[9px] text-gray-400 mt-2">{m.launchHref ? "Editing actions run in the connected editor." : "Authoring actions activate once a store is connected."}</p>
          </div>

          <AiAssistant name={firstName} aiConfigured={aiConfigured} />

          {/* AI insights */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">AI Insights</p>
            <div className="flex flex-col gap-2">
              {insights.map((t, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2"><span className="text-sm">💡</span><span className="text-[11px] text-gray-600 leading-tight">{t}</span></div>
              ))}
            </div>
          </div>

          {/* Activity timeline */}
          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Activity Timeline</p>
            {activity.length === 0 ? <p className="text-[12px] text-gray-400">No recorded activity yet.</p> : (
              <div className="flex flex-col gap-2.5">
                {activity.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-gray-100 flex items-center justify-center text-[10px] shrink-0">📌</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-gray-800 leading-tight"><span className="font-medium">{a.actor}</span> {a.action}{a.entity ? <span className="text-gray-500"> — {a.entity}</span> : null}</p>
                      <p className="text-[9px] text-gray-400">{relTime(a.when)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
