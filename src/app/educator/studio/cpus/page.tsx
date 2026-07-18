import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { RISK_CONFIG, COMPLEXITY_LABELS, type RiskCategory } from "@/lib/ckcm";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../../ui";

// CPU Builder (live view) — Clinical Practice Units with their linked
// competencies, knowledge objects, cases and blueprint. CPUs are the reusable
// governed objects; structural authoring runs in the platform Studio.

export const dynamic = "force-dynamic";

const PUB_CLS: Record<string, string> = {
  published: "bg-green-100 text-green-700", draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-100 text-amber-700", retired: "bg-gray-100 text-gray-400",
};

export default async function CpusPage() {
  const { admin } = await requireEducatorAccess();

  const { data: cpus } = await admin.from("clinical_practice_units")
    .select("id, name, code, risk_category, complexity, reassessment_months, pub_status, version_num")
    .order("name").limit(100);
  const cpuList = cpus ?? [];
  const ids = cpuList.map(c => c.id);

  const [{ data: comps }, { data: knowledge }, { data: cases }, { data: blueprints }] = await Promise.all([
    ids.length ? admin.from("framework_competencies").select("cpu_id").in("cpu_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("knowledge_objects").select("cpu_id").in("cpu_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("clinical_cases").select("cpu_id").in("cpu_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("assessment_blueprints").select("cpu_id").in("cpu_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const count = (rows: { cpu_id: string | null }[] | null, id: string) => (rows ?? []).filter(r => r.cpu_id === id).length;

  return (
    <div className="max-w-4xl">
      <Link href="/educator/studio/cko" className="text-xs text-gray-400 hover:text-gray-600">← CKO & CPU Studio</Link>
      <div className="mt-1"><EduHeader icon="🧱" title="CPU Builder" sub="Clinical Practice Units — the reusable governed objects that power competency, learning and assessment." /></div>
      <StatTiles tiles={[
        { label: "Total CPUs", value: String(cpuList.length) },
        { label: "Published", value: String(cpuList.filter(c => c.pub_status === "published").length) },
        { label: "Draft", value: String(cpuList.filter(c => c.pub_status === "draft").length) },
        { label: "With Knowledge", value: String(cpuList.filter(c => count(knowledge, c.id) > 0).length) },
      ]} />

      <Card title="Clinical Practice Units" sub="each CPU aggregates competencies, knowledge, cases and a blueprint">
        {cpuList.length ? (
          <div className="space-y-2">
            {cpuList.map(c => {
              const risk = RISK_CONFIG[c.risk_category as RiskCategory];
              return (
                <div key={c.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.code && <span className="text-[10px] font-mono text-gray-400">{c.code}</span>}
                    <span className="text-xs font-semibold text-gray-800">{c.name}</span>
                    {risk && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${risk.cls}`}>{risk.label}</span>}
                    {c.complexity != null && <span className="text-[9px] text-gray-400">L{c.complexity} · {COMPLEXITY_LABELS[c.complexity] ?? ""}</span>}
                    <span className="flex-1" />
                    <span className="text-[10px] text-gray-500">v{c.version_num ?? 0}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${PUB_CLS[c.pub_status ?? "draft"] ?? "bg-gray-100"}`}>{(c.pub_status ?? "draft").replace("_", " ")}</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {count(comps, c.id)} competencies · {count(knowledge, c.id)} knowledge objects · {count(cases, c.id)} cases · {count(blueprints, c.id) ? "blueprint set" : "no blueprint"}
                    {c.reassessment_months ? ` · reassess every ${c.reassessment_months}mo` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        ) : <p className="text-xs text-gray-400">No CPUs yet.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Object usage across the platform is in <Link href="/educator/studio/analytics" className="text-purple-600 hover:underline">Object Analytics</Link>;
        lifecycle and versions in <Link href="/educator/studio/versions" className="text-purple-600 hover:underline">Version Control</Link>.
        The CKO marketplace and drag-drop dependency mapper have no store yet.
      </p>
    </div>
  );
}
