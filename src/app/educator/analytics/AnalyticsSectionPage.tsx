import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, type AnalyticsData } from "@/lib/analytics-data";
import { EduHeader } from "../ui";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import { SECTION_BY_ID } from "./sections";

// Shared renderer for the 8 Analytics & Quality workspace sections. Each shows
// a live snapshot (real figures from loadAnalytics) plus the spec's module
// navigator — backed modules link out, unbacked render as honest "soon" chips.

const pct = (v: number | null) => v !== null ? `${v}%` : "—";

function sectionTiles(id: string, d: AnalyticsData): Tile[] {
  const K = d.kpis;
  const q = (label: string) => d.quality.find(x => x.label === label)?.pct ?? null;
  const withData = d.assessmentPerf.filter(a => a.n > 0).length;
  switch (id) {
    case "learning": return [
      { label: "Active Learners", value: String(K.activeLearners.value), sub: `${K.activeLearners.active30} active · 30d` },
      { label: "Course Completion", value: pct(K.courseCompletion.pct), sub: `${K.courseCompletion.completed}/${K.courseCompletion.total}` },
      { label: "Avg. Competency", value: pct(K.avgCompetency.pct) },
      { label: "Pass Rate", value: pct(K.passRate.pct), sub: "30d" },
    ];
    case "competency": return [
      { label: "Avg. Competency", value: pct(K.avgCompetency.pct), sub: K.avgCompetency.raw !== null ? `${K.avgCompetency.raw.toFixed(1)}/6` : "—" },
      { label: "Attainment", value: pct(q("Competency Attainment")) },
      { label: "Coverage", value: pct(q("Curriculum Coverage")) },
      { label: "Domains Assessed", value: String(d.heatmap.length) },
    ];
    case "curriculum": return [
      { label: "Curriculum Coverage", value: pct(q("Curriculum Coverage")) },
      { label: "Domains Assessed", value: String(d.heatmap.length) },
      { label: "Attainment", value: pct(q("Competency Attainment")) },
    ];
    case "assessment": return [
      { label: "Pass Rate", value: pct(K.passRate.pct), sub: "30d" },
      { label: "Avg. Score", value: pct(K.avgCompetency.pct) },
      { label: "Sources with Data", value: String(withData), sub: `of ${d.assessmentPerf.length}` },
    ];
    case "outcomes": return [
      { label: "Course Completion", value: pct(K.courseCompletion.pct), sub: `${K.courseCompletion.completed}/${K.courseCompletion.total}` },
      { label: "Pass Rate", value: pct(K.passRate.pct), sub: "30d" },
      { label: "At-Risk", value: String(K.atRisk.count), alert: K.atRisk.count > 0 },
    ];
    case "quality": return [
      { label: "Overall Quality", value: pct(d.overallQuality) },
      { label: "Curriculum Coverage", value: pct(q("Curriculum Coverage")) },
      { label: "Compliance Rate", value: pct(q("Compliance Rate")) },
      { label: "Learner Engagement", value: pct(q("Learner Engagement")) },
    ];
    case "accreditation": return [
      { label: "Compliance Rate", value: pct(q("Compliance Rate")) },
      { label: "CPD Compliance", value: pct(K.cpdCompliance.pct), sub: K.cpdCompliance.note || "—" },
    ];
    case "improvement": return [
      { label: "At-Risk Learners", value: String(K.atRisk.count), alert: K.atRisk.count > 0 },
      { label: "Pass Rate", value: pct(K.passRate.pct), sub: "30d" },
      { label: "Coverage", value: pct(q("Curriculum Coverage")) },
    ];
    default: return [];
  }
}

export default async function AnalyticsSectionPage({ id }: { id: string }) {
  const { admin, hospitalId } = await requireEducatorAccess();
  const section = SECTION_BY_ID.get(id);
  if (!section) return <p className="text-sm text-gray-400">Unknown section.</p>;

  const d = await loadAnalytics(admin, hospitalId ?? "");
  const tiles = sectionTiles(id, d);
  const backed = section.modules.filter(m => m.href).length;

  return (
    <div className="max-w-[1200px]">
      <Link href="/educator/analytics" className="text-xs text-gray-400 hover:text-gray-600">← Analytics &amp; Quality</Link>
      <div className="mt-1 mb-4"><EduHeader icon={section.icon} title={section.name} sub={section.desc} /></div>

      {tiles.length > 0 && <div className="mb-5"><StatTiles tiles={tiles} /></div>}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-gray-900">Modules</h2>
        <span className="text-[10px] text-gray-400">{backed} of {section.modules.length} live</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {section.modules.map(m => m.href ? (
          <Link key={m.name} href={m.href} className="bg-white border border-gray-100 rounded-xl p-3.5 hover:border-purple-200 transition-colors">
            <p className="text-[12px] font-semibold text-gray-800">{m.name}</p>
            <p className={`text-[11px] font-semibold mt-1 ${section.accent}`}>Open →</p>
          </Link>
        ) : (
          <span key={m.name} title="Not available yet — no backing store" className="bg-gray-50/60 border border-gray-100 rounded-xl p-3.5 select-none">
            <p className="text-[12px] font-semibold text-gray-400">{m.name}</p>
            <p className="text-[8px] font-bold uppercase tracking-wider text-gray-300 mt-1">soon</p>
          </span>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-5">
        Snapshot figures are live from your hospital&apos;s records. Modules marked &ldquo;soon&rdquo; need backing stores not yet built and are shown for structure, never as dead links.
      </p>
    </div>
  );
}
