import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, competencyProfile } from "@/lib/analytics";
import { StatTiles, Card, PctChip } from "@/app/assessor/reports/ui";
import AskAi from "@/app/assessor/ai/AskAi";
import { EduHeader } from "../ui";

// Competency Gaps — per-learner and per-competency gaps from latest
// decisions, mapped to the governed learning resources that close them, with
// a grounded AI reading. Rule-derived, not predicted.

export const dynamic = "force-dynamic";

export default async function CompetencyGapsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));

  // Per-learner gaps (failed or expired latest decisions)
  const byNurse = new Map<string, { name: string; gaps: string[]; critical: number }>();
  for (const d of ctx.latest) {
    if (d.passing && !d.expired) continue;
    const cur = byNurse.get(d.nurse_id) ?? { name: nameOf.get(d.nurse_id) ?? "—", gaps: [], critical: 0 };
    cur.gaps.push(d.name);
    if (d.critical) cur.critical++;
    byNurse.set(d.nurse_id, cur);
  }
  const learners = [...byNurse.entries()].map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.critical - a.critical || b.gaps.length - a.gaps.length).slice(0, 10);

  // Org gaps + linked resources
  const comps = competencyProfile(ctx.latest);
  const gaps = comps.filter(c => c.total >= 2 && c.pct < 80).sort((a, b) => a.pct - b.pct).slice(0, 8);
  const gapIds = [...new Set(ctx.latest.filter(d => gaps.some(g => g.name === d.name)).map(d => d.competency_id))];
  const { data: links } = gapIds.length
    ? await admin.from("resource_competencies")
        .select("competency_id, learning_resources(title, is_active)")
        .in("competency_id", gapIds).limit(200)
    : { data: [] };
  const nameById = new Map(ctx.latest.map(d => [d.competency_id, d.name]));
  const resourcesByGap = new Map<string, string[]>();
  for (const l of links ?? []) {
    const r = l.learning_resources as unknown as { title: string; is_active: boolean } | null;
    if (!r?.is_active) continue;
    const gapName = nameById.get(l.competency_id);
    if (gapName) resourcesByGap.set(gapName, [...(resourcesByGap.get(gapName) ?? []), r.title]);
  }

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🧩" title="Competency Gaps" sub="Missing and failed competencies mapped to the learning that closes them — rule-derived from latest decisions." />
      <StatTiles tiles={[
        { label: "Learners With Gaps", value: String(byNurse.size), sub: `of ${ctx.nurses.length}` },
        { label: "Gap Competencies", value: String(gaps.length), sub: "below 80% pass, ≥2 decisions" },
        { label: "Critical Gaps", value: String(learners.reduce((s, l) => s + l.critical, 0)), alert: learners.some(l => l.critical > 0) },
        { label: "Gaps With Resources", value: gaps.length ? `${Math.round(gaps.filter(g => resourcesByGap.has(g.name)).length / gaps.length * 100)}%` : "—" },
      ]} />

      <Card title="Learners With Gaps" sub="critical gaps first — actions link to the profile and plan tools">
        {learners.length ? (
          <div className="space-y-1.5">
            {learners.map(l => (
              <div key={l.id} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 flex-wrap">
                <Link href={`/educator/profiles?n=${l.id}`} className="text-xs font-semibold text-gray-800 hover:text-purple-700">{l.name}</Link>
                {l.critical > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-red-600 text-white">{l.critical} critical</span>}
                <span className="text-[10px] text-gray-500 flex-1 truncate">{l.gaps.slice(0, 3).join(", ")}{l.gaps.length > 3 ? ` +${l.gaps.length - 3}` : ""}</span>
                <Link href={`/educator/profiles?n=${l.id}`} className="text-[10px] font-semibold text-purple-600 hover:underline">Plan →</Link>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No learners with gaps. ✅</p>}
      </Card>

      <div className="mt-4">
        <Card title="Organisation Gaps → Learning" sub="link resources in the library to strengthen future plans">
          {gaps.length ? gaps.map(g => (
            <div key={g.name} className="flex items-center gap-2 text-[11px] py-1 flex-wrap">
              <span className="text-gray-700 flex-1 truncate">{g.name}</span>
              <PctChip v={g.pct} />
              {resourcesByGap.get(g.name)?.length
                ? <span className="text-[10px] text-teal-700">📚 {resourcesByGap.get(g.name)!.slice(0, 2).join(" · ")}</span>
                : <Link href="/educator/library" className="text-[10px] text-amber-600 hover:underline">link a resource →</Link>}
            </div>
          )) : <p className="text-xs text-gray-400">No organisation-level gaps below 80%.</p>}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="AI Gap Analysis" sub="Claude, grounded in the live competency profile">
          <AskAi endpoint="/api/ai/insights" body={{ scope: "competency" }} label="Generate gap analysis" />
        </Card>
      </div>
    </div>
  );
}
