import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import { SCORING_METHOD_LABELS, ENTRUSTMENT_LABELS } from "@/lib/ckcm";
import { Card } from "../../reports/ui";

// Rubrics & Scoring (Assessment Studio) — the governed scoring models that
// every assessment uses, read from the real scoring_levels table. Custom
// per-asset rubric authoring has no store and is stated as such.

export const dynamic = "force-dynamic";

export default async function StudioRubricsPage() {
  const { admin } = await requireAnalyticsAccess();

  const { data: levels } = await admin.from("scoring_levels")
    .select("score, label, description, color, is_passing")
    .eq("scale_id", "00000000-0000-0000-0000-000000000001")
    .order("score");

  return (
    <div className="max-w-3xl">
      <Link href="/assessor/studio" className="text-xs text-gray-400 hover:text-gray-600">← Assessment Studio</Link>
      <div className="mb-5 mt-1">
        <h1 className="text-xl font-bold text-gray-900">⚖️ Rubrics &amp; Scoring</h1>
        <p className="text-gray-400 text-sm mt-0.5">The governed scoring models every assessment, audit and OSCE uses — one platform standard, no per-assessor variants.</p>
      </div>

      <Card title="Benner Competency Scale (0–6)" sub="scoring_levels — the platform's decision scale">
        {(levels ?? []).length ? (
          <div className="space-y-1.5">
            {(levels ?? []).map(l => (
              <div key={l.score} className="flex items-center gap-3 border border-gray-100 rounded-lg px-3 py-2">
                <span className="w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0" style={{ backgroundColor: l.color }}>{l.score}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{l.label}</p>
                  {l.description && <p className="text-[10px] text-gray-400">{l.description}</p>}
                </div>
                {l.is_passing && <span className="text-[9px] font-bold text-green-600 bg-green-50 rounded px-1.5 py-0.5 uppercase shrink-0">Passing</span>}
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">Scoring levels not seeded.</p>}
      </Card>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Card title="Checklist Scoring Methods" sub="available per checklist item">
          <ul className="space-y-1">
            {Object.entries(SCORING_METHOD_LABELS).map(([k, v]) => (
              <li key={k} className="text-[11px] text-gray-600 flex items-center gap-2">
                <span className="text-gray-300">•</span>{v}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Entrustment Levels" sub="supervision outcomes">
          <ul className="space-y-1">
            {Object.entries(ENTRUSTMENT_LABELS).map(([k, v]) => (
              <li key={k} className="text-[11px] text-gray-600 flex items-center gap-2">
                <span className="text-gray-300">•</span>{v}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Scoring is deliberately centralised: item-level methods are chosen in the Checklist Builder; the decision scale is platform-governed.
        Custom weighted rubrics per asset have no backing store and are not simulated.
      </p>
    </div>
  );
}
