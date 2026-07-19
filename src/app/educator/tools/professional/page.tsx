import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProfHub } from "@/lib/professional-tools";
import ToolGrid from "./ToolGrid";
import CommandBar from "./CommandBar";
import AiAssistant from "./AiAssistant";

// Professional Tools — the educator productivity centre landing (spec v1.0 +
// mockup). Light-themed: a live overview row, the eight filterable module
// cards, an AI assistant rail, recent activity and a command bar. Each card
// opens its own module workspace (dynamic route), mirroring the Intelligence
// hub → workspace pattern.
//
// Honest-UI: the overview counts and recent activity are live from real
// records; tool-utilisation metering and per-tool favourites aren't tracked, so
// they're shown muted, never invented.

export const dynamic = "force-dynamic";

const OVERVIEW_ICON: Record<string, string> = {
  "Tools Available": "💼", "Templates": "🗂️", "Questions Created": "❓",
  "Scenarios Built": "🧪", "Resources": "📚", "Tool Utilisation": "📈",
};

const relTime = (iso: string | null): string => {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
};

export default async function ProfessionalToolsPage() {
  const { admin, name } = await requireEducatorAccess();
  const d = await loadProfHub(admin);
  const firstName = name?.split(" ")[0] ?? "Educator";

  return (
    <div className="max-w-[1400px]">
      {/* Breadcrumb + header */}
      <nav className="text-[12px] text-gray-400 mb-1 flex items-center gap-1.5">
        <Link href="/educator/tools" className="hover:text-violet-600">Productivity &amp; Administration Centre</Link>
        <span>›</span><span className="text-gray-600 font-medium">Professional Tools</span>
      </nav>
      <div className="mb-5">
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900">Professional Tools</h1>
        <p className="text-gray-500 text-sm">Powerful tools to create, manage and enhance your educational content and assessments</p>
      </div>

      {/* Overview */}
      <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 mb-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mb-3">Your Professional Tools Overview</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {d.overview.map(k => (
            <div key={k.label} className={`flex items-center gap-3 ${k.muted ? "opacity-70" : ""}`}>
              <span className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center text-base shrink-0">{OVERVIEW_ICON[k.label] ?? "•"}</span>
              <div className="min-w-0">
                <p className="text-xl font-extrabold text-gray-900 leading-none">{k.value === null ? "—" : typeof k.value === "number" ? k.value.toLocaleString() : k.value}</p>
                <p className="text-[11px] text-gray-500 leading-tight mt-0.5">{k.label}</p>
                <p className="text-[9px] text-gray-400 leading-tight">{k.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
        {/* Main */}
        <div className="flex flex-col gap-5 min-w-0">
          <ToolGrid modules={d.modules} />
          <CommandBar aiConfigured={d.aiConfigured} />
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5 min-w-0">
          <AiAssistant name={firstName} aiConfigured={d.aiConfigured} />

          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Recent Activity</p>
              <Link href="/educator/tools" className="text-[10px] text-violet-600 hover:text-violet-700">View all</Link>
            </div>
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
        </div>
      </div>
    </div>
  );
}
