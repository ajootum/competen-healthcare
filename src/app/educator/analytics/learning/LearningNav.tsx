import Link from "next/link";
import { EduHeader } from "../../ui";
import { MODULES, MODULE_BY_ID } from "./modules";

// Shared header + module tab bar for the Learning Analytics workspace.
// Independent module navigation (spec acceptance criterion) without bloating
// the global sidebar.
export default function LearningNav({ active }: { active: string }) {
  const m = MODULE_BY_ID.get(active);
  return (
    <div className="mb-4">
      <Link href="/educator/analytics" className="text-xs text-gray-400 hover:text-gray-600">← Analytics &amp; Quality</Link>
      <div className="mt-1 mb-3">
        <EduHeader icon={m?.icon ?? "📊"} title={m ? m.name : "Learning Analytics"} sub={m?.desc ?? "Deep analytics on learner engagement, behaviour, progress and readiness."} />
      </div>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        <Link href="/educator/analytics/learning"
          className={`shrink-0 text-[11px] font-semibold rounded-lg px-3 py-1.5 border transition-colors ${active === "overview" ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"}`}>
          Overview
        </Link>
        {MODULES.map(mod => (
          <Link key={mod.id} href={`/educator/analytics/learning/${mod.id}`}
            className={`shrink-0 text-[11px] font-semibold rounded-lg px-3 py-1.5 border transition-colors ${active === mod.id ? "bg-purple-600 text-white border-purple-600" : "bg-white text-gray-600 border-gray-200 hover:border-purple-300"}`}>
            {mod.n}. {mod.name.replace(" Analytics", "")}
          </Link>
        ))}
      </div>
    </div>
  );
}
