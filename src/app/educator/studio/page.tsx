import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadPortfolio } from "@/lib/studio-data";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { SECTIONS } from "./sections";
import SectionGrid from "./SectionGrid";

// Education Studio (Competency Design Studio) — the central authoring,
// governance and publishing hub. Every figure is a live content-table count;
// the pipeline aggregates real object statuses. Modules link to real builders
// or live views; unbacked ones are muted soon-rows.

export const dynamic = "force-dynamic";

const PIPE = [
  { key: "draft", label: "Draft", icon: "✏️" },
  { key: "review", label: "In Review", icon: "👀" },
  { key: "validation", label: "Validation", icon: "🛡️" },
  { key: "published", label: "Published", icon: "📣" },
  { key: "retired", label: "Retired", icon: "📦" },
] as const;

export default async function EducationStudioPage() {
  const { admin } = await requireEducatorAccess();
  const p = await loadPortfolio(admin);

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: koReview }, { data: fwReview }, { data: activity }] = await Promise.all([
    admin.from("knowledge_objects").select("id, review_date").not("review_date", "is", null).lte("review_date", today).limit(500),
    admin.from("frameworks").select("id, review_date").not("review_date", "is", null).lte("review_date", today).limit(500),
    admin.from("audit_log")
      .select("actor_name, action, entity_name, created_at")
      .in("action", ["finalize_decisions", "conduct_audit", "save_report", "ai_osce_design", "ai_simulation_design", "clone_cpu", "educator_validate"])
      .order("created_at", { ascending: false }).limit(6),
  ]);
  const dueForReview = (koReview ?? []).length + (fwReview ?? []).length;

  // Content health — real signals.
  const health = [
    { label: "Competencies without checklists", n: p.checklists === 0 ? p.competencies : null, note: "author checklists in the builder", href: "/educator/studio/checklists" },
    { label: "CPUs with no OSCE", n: p.osce === 0 ? p.cpus : null, note: "OSCE store empty", href: "/educator/studio/cpus" },
    { label: "Objects due for review", n: dueForReview, note: "past review date", href: "/educator/studio/versions" },
    { label: "Draft / in-review objects", n: p.pendingReview, note: "not yet published", href: "/educator/studio/versions" },
  ].filter(h => h.n && h.n > 0);

  const ACT: Record<string, string> = {
    finalize_decisions: "ran a decision process", conduct_audit: "conducted an audit",
    save_report: "saved a report", ai_osce_design: "AI-drafted an OSCE station",
    ai_simulation_design: "AI-drafted a scenario", clone_cpu: "cloned a CPU", educator_validate: "validated a score",
  };

  return (
    <div className="max-w-[1150px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">✨ Education Studio</h1>
        <p className="text-gray-400 text-sm mt-0.5">Design, build and publish clinical education that drives competency and quality — every figure below is live.</p>
      </div>

      <StatTiles cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-7" tiles={[
        { label: "Competencies", value: String(p.competencies), sub: `${p.frameworks} frameworks` },
        { label: "CPUs", value: String(p.cpus) },
        { label: "Knowledge Objects", value: String(p.knowledge) },
        { label: "Courses", value: String(p.courses) },
        { label: "Question Bank", value: String(p.questions), sub: `${p.questionBanks} banks` },
        { label: "Clinical Cases", value: String(p.cases) },
        { label: "Pending Review", value: String(p.pendingReview), alert: p.pendingReview > 0 },
      ]} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 mb-4">
        <Card title="Design Pipeline" sub="content objects by lifecycle status — frameworks, CPUs, knowledge, cases">
          <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
            {PIPE.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5 shrink-0">
                <div className={`rounded-lg border px-3 py-2.5 w-[110px] text-center ${s.key === "published" ? "border-green-200 bg-green-50/60" : "border-gray-100 bg-gray-50/60"}`}>
                  <p className="text-lg">{s.icon}</p>
                  <p className="text-xl font-bold text-gray-900">{p.pipeline[s.key]}</p>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{s.label}</p>
                </div>
                {i < PIPE.length - 1 && <span className="text-gray-300 text-xs">→</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Content Health" sub="real signals">
          {health.length ? (
            <div className="space-y-1.5">
              {health.map(h => (
                <Link key={h.label} href={h.href} className="flex items-center gap-2 text-[11px] text-gray-700 hover:text-purple-700">
                  <span className="flex-1">{h.label} <span className="text-gray-400">· {h.note}</span></span>
                  <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">{h.n}</span>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">All content is healthy. ✅</p>}
        </Card>
      </div>

      {/* Section navigator */}
      <div className="space-y-4">
        {SECTIONS.map((s, i) => (
          <Card key={s.id} title={`${i + 1}. ${s.icon} ${s.title}`} sub={s.sub}>
            <div className="flex items-center justify-end -mt-8 mb-2">
              <Link href={`/educator/studio/${s.id}`} className="text-[11px] font-semibold text-purple-600 hover:underline">Open section →</Link>
            </div>
            <SectionGrid modules={s.modules} />
          </Card>
        ))}
      </div>

      <div className="mt-4">
        <Card title="Recent Studio Activity" sub="from the audit trail">
          {(activity ?? []).length ? (
            <ul className="space-y-1.5">
              {(activity ?? []).map((a, i) => (
                <li key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">{a.actor_name ?? "—"}</span> {ACT[a.action] ?? a.action.replace(/_/g, " ")}
                  {a.entity_name ? <span className="text-gray-400"> · {a.entity_name}</span> : null}
                  <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No studio activity yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: the Education Studio surfaces the real content model. Framework/CPU/curriculum authoring at scale remains governed
        (super-admin Studio); educators author checklists, question banks, resources and scenarios here directly. Visual mappers, marketplace,
        microlearning and AI-tutor persistence have no store yet and are marked soon.
      </p>
    </div>
  );
}
