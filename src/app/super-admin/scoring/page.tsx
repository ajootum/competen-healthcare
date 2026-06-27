import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ScoringManager from "./ScoringManager";

export default async function ScoringPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: scales } = await admin
    .from("scoring_scales")
    .select("id, name, description, min_score, max_score, is_default, scoring_levels(id, score, label, description, color, is_passing)")
    .order("is_default", { ascending: false });

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Scoring Rules</h1>
          <p className="text-gray-400 text-sm mt-0.5">Configure scoring scales, level labels, colours, and pass thresholds</p>
        </div>
        <ScoringManager scales={scales ?? []} />
      </div>

      <div className="flex flex-col gap-6">
        {(scales ?? []).map(scale => (
          <div key={scale.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900">{scale.name}</h2>
                  {scale.is_default && <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-2 py-0.5 rounded">Default</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{scale.description}</p>
              </div>
              <span className="text-xs text-gray-400">Score {scale.min_score}–{scale.max_score}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {(scale.scoring_levels ?? []).sort((a, b) => a.score - b.score).map(level => (
                <div key={level.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: level.color }}>{level.score}</div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{level.label}</p>
                    {level.description && <p className="text-[10px] text-gray-400 mt-0.5">{level.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {level.is_passing
                      ? <span className="text-[10px] bg-green-50 text-green-600 font-semibold px-2 py-0.5 rounded">Passing</span>
                      : <span className="text-[10px] bg-red-50 text-red-500 px-2 py-0.5 rounded">Not passing</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
