import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Learning Plans — the live learning pathways: auto-generated per learner
// from decision gaps at every decision run, with objectives (competencies)
// and linked governed resources. Manual plan authoring with deadlines needs
// its own store and is stated as such.

export const dynamic = "force-dynamic";

export default async function LearningPlansPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const nurseIds = ctx.nurses.map(n => n.id);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));

  const { data: pathways } = nurseIds.length
    ? await admin.from("learning_pathways")
        .select("id, nurse_id, status, created_at, pathway_items(competency_name, reason, resource_title)")
        .in("nurse_id", nurseIds).eq("status", "active")
        .order("created_at", { ascending: false }).limit(40)
    : { data: [] };

  const plans = ((pathways ?? []) as unknown as {
    id: string; nurse_id: string; status: string; created_at: string;
    pathway_items: { competency_name: string; reason: string | null; resource_title: string | null }[];
  }[]).filter(p => (p.pathway_items ?? []).length > 0);

  const totalItems = plans.reduce((s, p) => s + p.pathway_items.length, 0);
  const withResources = plans.reduce((s, p) => s + p.pathway_items.filter(i => i.resource_title).length, 0);

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🎓" title="Learning Plans" sub="Personalised learning pathways — generated from each learner's real decision gaps, refreshed at every decision run." />
      <StatTiles tiles={[
        { label: "Active Plans", value: String(plans.length) },
        { label: "Plan Items", value: String(totalItems), sub: "objectives from gaps" },
        { label: "With Linked Resources", value: totalItems ? `${Math.round(withResources / totalItems * 100)}%` : "—", sub: `${withResources} of ${totalItems}` },
        { label: "Learners Covered", value: String(new Set(plans.map(p => p.nurse_id)).size), sub: `of ${ctx.nurses.length}` },
      ]} />

      <Card title="Active Learning Plans" sub="each objective traces to a decision gap">
        {plans.length ? (
          <div className="space-y-2.5">
            {plans.map(p => (
              <div key={p.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Link href={`/educator/profiles?n=${p.nurse_id}`} className="text-xs font-semibold text-gray-800 hover:text-purple-700">
                    {nameOf.get(p.nurse_id) ?? "—"}
                  </Link>
                  <span className="text-[10px] text-gray-400">{deptOf.get(p.nurse_id) ?? "General"}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-green-100 text-green-700">active</span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-gray-400" suppressHydrationWarning>generated {new Date(p.created_at).toLocaleDateString()}</span>
                </div>
                <ul className="space-y-0.5">
                  {p.pathway_items.slice(0, 5).map((it, i) => (
                    <li key={i} className="text-[11px] text-gray-600">
                      • {it.competency_name}
                      {it.reason && <span className="text-gray-400"> ({it.reason})</span>}
                      {it.resource_title
                        ? <span className="text-teal-700"> — 📚 {it.resource_title}</span>
                        : <span className="text-amber-600"> — no resource linked</span>}
                    </li>
                  ))}
                  {p.pathway_items.length > 5 && <li className="text-[10px] text-gray-400">…and {p.pathway_items.length - 5} more</li>}
                </ul>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No active plans — pathways generate automatically when an educator runs a decision process with gaps present.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Items marked &quot;no resource linked&quot; are fixable in <Link href="/educator/library" className="text-purple-600 hover:underline">Learning Resources</Link> — link
        material to the competency and future plans reference it. Manual plan authoring with custom deadlines and completion tracking would need its own store;
        completion currently closes via reassessment and the decision run.
      </p>
    </div>
  );
}
