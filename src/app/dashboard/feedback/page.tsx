import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { METHOD_LABELS as METHOD_LABELS_T, OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
const METHOD_LABELS = METHOD_LABELS_T as Record<string, string>;

// My Feedback — developmental, not punitive: strengths, areas to grow,
// assessor comments and the action plan (learning pathway).

export default async function MyFeedbackPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [{ data: cycles }, { data: decisions }, { data: recognitions }, { data: pathwayItems }] = await Promise.all([
    admin.from("competency_cycles").select("id").eq("nurse_id", user.id),
    admin.from("competency_decisions")
      .select("competency_id, outcome, maturity, created_at, framework_competencies(name)")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_recognitions")
      .select("title, description, awarded_by_name, awarded_at")
      .eq("nurse_id", user.id).order("awarded_at", { ascending: false }).limit(3),
    admin.from("pathway_items")
      .select("competency_name, reason, resource_title, learning_pathways!inner(nurse_id, status)")
      .eq("learning_pathways.nurse_id", user.id).eq("learning_pathways.status", "active"),
  ]);
  const cycleIds = (cycles ?? []).map(c => c.id);

  const { data: comments } = cycleIds.length
    ? await admin.from("assessments")
        .select("method, score, notes, assessed_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name)")
        .in("cycle_id", cycleIds).not("notes", "is", null)
        .order("assessed_at", { ascending: false })
    : { data: [] };

  // Latest decision per competency → strengths & growth areas
  const seen = new Set<string>();
  const strengths: string[] = [];
  const growth: { name: string; label: string }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "—";
    const oc = OUTCOME_CONFIG[d.outcome as DecisionOutcome];
    if (oc?.passing) {
      if (d.maturity === "proficient" || d.maturity === "expert") strengths.push(`${name} — performing at ${d.maturity} level`);
      else strengths.push(name);
    } else {
      growth.push({ name, label: oc?.label ?? d.outcome });
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">My Feedback</h1>
        <p className="text-gray-400 text-sm mt-0.5">What your assessors and supervisors see — framed for growth.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <div className="bg-white rounded-xl border border-green-100 p-5">
          <h2 className="text-xs font-bold text-green-600 uppercase tracking-widest mb-3">💪 Strengths</h2>
          {strengths.length === 0 ? (
            <p className="text-sm text-gray-400">Strengths appear as you achieve competency decisions.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {strengths.map((s, i) => <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-green-500">✓</span>{s}</li>)}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-amber-100 p-5">
          <h2 className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-3">🌱 Areas to Grow</h2>
          {growth.length === 0 ? (
            <p className="text-sm text-gray-400">No open development areas — keep it up!</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {growth.map((g, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-center gap-2">
                  <span className="text-amber-500">→</span>
                  <span className="flex-1">{g.name}</span>
                  <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-semibold">{g.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(pathwayItems ?? []).length > 0 && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl p-5 mb-6">
          <h2 className="text-xs font-bold text-teal-700 uppercase tracking-widest mb-2">📋 Your Action Plan</h2>
          <ul className="flex flex-col gap-1.5">
            {(pathwayItems ?? []).map((p, i) => (
              <li key={i} className="text-sm text-teal-900">
                {p.competency_name}: {p.resource_title ? <>complete <b>{p.resource_title}</b></> : "practice with your preceptor"}
              </li>
            ))}
          </ul>
          <Link href="/dashboard/learning" className="inline-block mt-3 text-sm font-semibold text-teal-700 hover:underline">
            Open my Learning Pathway →
          </Link>
        </div>
      )}

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Assessor Comments</h2>
      {(comments ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-3xl mb-2">💬</p>
          <p className="text-sm text-gray-400">Assessor comments appear here after your assessments.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {(comments ?? []).map((c, i) => (
            <div key={i} className="px-5 py-4">
              <p className="text-sm text-gray-700 italic">&ldquo;{c.notes}&rdquo;</p>
              <p className="text-[10px] text-gray-400 mt-1.5">
                {(c.framework_competencies as unknown as { name: string } | null)?.name}
                {" · "}{METHOD_LABELS[c.method] ?? c.method}
                {" · "}{(c.profiles as unknown as { full_name: string } | null)?.full_name}
                {c.assessed_at ? ` · ${new Date(c.assessed_at).toLocaleDateString()}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      {(recognitions ?? []).length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recognition 🏆</h2>
          <div className="flex flex-col gap-2">
            {(recognitions ?? []).map((r, i) => (
              <div key={i} className="bg-white rounded-xl border border-amber-100 px-5 py-3">
                <p className="text-sm font-medium text-gray-800">{r.title}</p>
                {r.description && <p className="text-[11px] text-gray-500 mt-0.5">{r.description}</p>}
                <p className="text-[10px] text-gray-400 mt-1">{r.awarded_by_name} · {new Date(r.awarded_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
