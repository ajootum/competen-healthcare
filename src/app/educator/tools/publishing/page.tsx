import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadPublishingHub, ROW_CAP } from "@/lib/publishing-tools";
import Workspace from "./Workspace";

// Publishing Tools — the enterprise release-management & governance workspace
// (Publishing Tools spec + developer spec + mockup). Light-themed: a Publication
// Status header, governance quick actions, and the eight-module workspace
// (Publication Manager table + contextual resource panel).
//
// Honest-UI: the Publication Status counts and the Publication Manager table are
// live from the real content stores; release / scheduling / distribution /
// publish-pipeline stores don't exist yet, so those KPIs are muted and the
// governance write-actions are shown disabled (never faked), with the modules
// that need those stores rendered as honest scaffolds inside the workspace.

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  ["🚀", "Publish Now"], ["🗓️", "Schedule Release"], ["📦", "Create Release"],
  ["↩️", "Rollback Version"], ["🗄️", "Archive Resource"], ["🧩", "Publish Package"],
];

export default async function PublishingToolsPage() {
  const { admin } = await requireEducatorAccess();
  const d = await loadPublishingHub(admin);

  return (
    <div className="max-w-[1500px]">
      {/* Breadcrumb + header */}
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><span className="text-gray-600 font-medium">Publishing Tools</span>
      </nav>
      <div className="flex items-start gap-3 mb-5">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">Publishing Tools</h1>
          <p className="text-gray-500 text-sm">Release, manage and govern educational content with confidence.</p>
        </div>
        <Link href="/educator/ai" className="ml-auto self-center flex items-center gap-1.5 text-[13px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 hover:bg-violet-100 transition-colors">✨ AI Insights</Link>
      </div>

      {/* Publication Status */}
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-2">Publication Status</p>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {d.kpis.map(k => (
          <div key={k.label} className={`rounded-2xl bg-white border border-gray-200 shadow-sm p-4 ${k.muted ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 mb-1.5"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${k.tone}`}>{k.icon}</span></div>
            <p className="text-[11px] text-gray-500 font-medium leading-tight">{k.label}</p>
            <p className="text-2xl font-extrabold text-gray-900">{k.value === null ? "—" : k.value.toLocaleString()}</p>
            <p className="text-[10px] text-gray-400 leading-tight">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Governance quick actions — write-actions have no pipeline yet, so they are
          shown disabled rather than faked. */}
      <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-3 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          {QUICK_ACTIONS.map(([ic, label], i) => (
            <span key={label} title="Governance actions run in the publishing pipeline — coming soon"
              className={`flex items-center gap-1.5 text-[13px] font-semibold rounded-lg px-3.5 py-2 cursor-default select-none ${i === 0 ? "bg-violet-100 text-violet-400 border border-violet-200" : "bg-gray-50 text-gray-400 border border-dashed border-gray-200"}`}>
              <span>{ic}</span>{label}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-gray-400 pr-1">Publishing pipeline actions activate once the release backend is connected.</span>
        </div>
      </div>

      {d.capped && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          Aggregating the most recent {ROW_CAP.toLocaleString()} records per store — the status counts above are a floor, not a full total.
        </p>
      )}

      <Workspace resources={d.resources} typeCounts={d.typeCounts} statusCounts={d.statusCounts} activity={d.activity} aiConfigured={d.aiConfigured} />
    </div>
  );
}
