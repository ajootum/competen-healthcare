import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, competencyProfile } from "@/lib/analytics";
import { StatTiles, Card, PctChip } from "../../reports/ui";
import { AiHeader } from "../ui";
import AskAi from "../AskAi";

// AI Learning Recommendations — organisation gaps mapped to REAL linked
// learning resources (resource_competencies), plus per-learner AI development
// plans via the coach engine.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ n?: string }>;

export default async function LearningRecommendationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const { n } = await searchParams;
  const sel = n ? ctx.nurses.find(x => x.id === n) ?? null : null;

  const comps = competencyProfile(ctx.latest);
  const gaps = comps.filter(c => c.total >= 2 && c.pct < 80).sort((a, b) => a.pct - b.pct).slice(0, 6);
  const gapIds = [...new Set(ctx.latest.filter(d => gaps.some(g => g.name === d.name)).map(d => d.competency_id))];

  const { data: links } = gapIds.length
    ? await admin.from("resource_competencies")
        .select("competency_id, learning_resources(title, resource_type, is_active)")
        .in("competency_id", gapIds).limit(200)
    : { data: [] };
  const nameById = new Map(ctx.latest.map(d => [d.competency_id, d.name]));
  const resourcesByGap = new Map<string, string[]>();
  for (const l of links ?? []) {
    const r = l.learning_resources as unknown as { title: string; resource_type: string; is_active: boolean } | null;
    if (!r?.is_active) continue;
    const gapName = nameById.get(l.competency_id);
    if (!gapName) continue;
    resourcesByGap.set(gapName, [...(resourcesByGap.get(gapName) ?? []), `${r.title} (${r.resource_type})`]);
  }

  return (
    <div className="max-w-4xl">
      <AiHeader icon="🎓" title="AI Learning Recommendations" sub="Learning targeted at real gaps — governed resources mapped to weak competencies, and per-learner AI plans." />
      <StatTiles tiles={[
        { label: "Competency Gaps", value: String(gaps.length), sub: "below 80% pass, ≥2 decisions", alert: gaps.length > 0 },
        { label: "Linked Resources", value: String([...resourcesByGap.values()].reduce((s, r) => s + r.length, 0)), sub: "governed learning material" },
        { label: "Learners", value: String(ctx.nurses.length) },
        { label: "Gap Coverage", value: gaps.length ? `${Math.round(gaps.filter(g => resourcesByGap.has(g.name)).length / gaps.length * 100)}%` : "—", sub: "gaps with linked material" },
      ]} />

      <Card title="Organisation Gaps → Learning" sub="derived from latest decisions; resources are governed links, not suggestions">
        {gaps.length ? (
          <div className="space-y-2.5">
            {gaps.map(g => (
              <div key={g.name} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-800 flex-1">{g.name}</span>
                  <PctChip v={g.pct} />
                  <span className="text-[9px] text-gray-300">{g.total} decisions</span>
                </div>
                {resourcesByGap.get(g.name)?.length ? (
                  <p className="text-[10px] text-teal-700 mt-1">📚 {resourcesByGap.get(g.name)!.join(" · ")}</p>
                ) : (
                  <p className="text-[10px] text-amber-600 mt-1">No learning resource linked yet — attach one in Studio so plans can reference it.</p>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No competency gaps below 80% — nothing to recommend. ✅</p>}
      </Card>

      <div className="mt-4">
        <Card title="Per-Learner AI Plan" sub="coach engine — grounded in the learner's own gaps">
          <form action="/assessor/ai/learning" className="flex items-center gap-2 mb-3">
            <select name="n" defaultValue={sel?.id ?? ""}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-indigo-400">
              <option value="">Choose a learner…</option>
              {ctx.nurses.map(x => <option key={x.id} value={x.id}>{x.name} · {x.dept}</option>)}
            </select>
            <button type="submit" className="text-xs font-semibold text-white bg-indigo-600 rounded-lg px-3 py-1.5 hover:bg-indigo-700">Select</button>
          </form>
          {sel
            ? <AskAi endpoint="/api/ai/coach" body={{ nurse_id: sel.id }} label={`Generate learning plan for ${sel.name.split(" ")[0]}`} />
            : <p className="text-xs text-gray-400">Select a learner to generate their personalised plan.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Learner-side pathways update automatically after decision runs (<Link href="/assessor/passports" className="text-indigo-500 hover:underline">Passport Centre</Link>).
        Course-completion percentages shown in the mockup need LMS tracking that doesn&apos;t exist — omitted.
      </p>
    </div>
  );
}
