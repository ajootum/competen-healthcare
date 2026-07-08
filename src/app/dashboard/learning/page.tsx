import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PathwayItems from "./PathwayItems";
import CoachPanel from "./CoachPanel";
import { aiStatus } from "@/lib/ai/config";

export default async function LearningPathwayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: pathway } = await admin
    .from("learning_pathways")
    .select("id, title, status, generated_at")
    .eq("nurse_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: items } = pathway
    ? await admin.from("pathway_items")
        .select("id, competency_name, reason, resource_id, resource_title, resource_type, status, sort_order")
        .eq("pathway_id", pathway.id)
        .order("sort_order")
    : { data: [] as {
        id: string; competency_name: string | null; reason: string | null;
        resource_id: string | null; resource_title: string | null; resource_type: string | null;
        status: string; sort_order: number;
      }[] };

  const rows = items ?? [];
  const done = rows.filter(i => i.status === "completed").length;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard" className="hover:text-gray-600">Dashboard</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Learning Pathway</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">My Learning Pathway</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Personalised from your competency decisions — targeted at your current gaps (Book II Ch.17).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-4xl mb-3">🎓</p>
          <p className="font-semibold text-gray-700">No gaps to address — nice work</p>
          <p className="text-gray-400 text-sm mt-2">Your pathway populates automatically when an assessment identifies a competency needing development.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-100 px-5 py-4 mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">{done}/{rows.length} items completed</p>
              {pathway && <p className="text-[10px] text-gray-400">Generated {new Date(pathway.generated_at).toLocaleDateString()}</p>}
            </div>
            <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full" style={{ width: `${rows.length ? Math.round((done / rows.length) * 100) : 0}%` }} />
            </div>
          </div>
          <PathwayItems items={rows} />
          {aiStatus().configured && <CoachPanel />}
        </>
      )}
    </div>
  );
}
