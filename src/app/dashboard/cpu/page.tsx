import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  RISK_CONFIG as RISK_CONFIG_T, METHOD_LABELS as METHOD_LABELS_T,
  OUTCOME_CONFIG, COMPLEXITY_LABELS, type DecisionOutcome,
} from "@/lib/ckcm";
const METHOD_LABELS = METHOD_LABELS_T as Record<string, string>;
const RISK_CONFIG = RISK_CONFIG_T as Record<string, { label: string; cls: string }>;

// My Clinical Practice Units — the nurse's workplace practice hub.
// Shows every published CPU, the nurse's progress through its competencies,
// evidence requirements, assessment blueprint and reassessment dates.

export default async function MyCpusPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [{ data: cpus }, { data: comps }, { data: decisions }, { data: blueprints }, { data: evidence }, { data: resources }] =
    await Promise.all([
      admin.from("clinical_practice_units")
        .select("id, name, code, description, risk_category, complexity, reassessment_months, practices(name)")
        .eq("pub_status", "published").order("sort_order"),
      admin.from("framework_competencies").select("id, name, cpu_id").not("cpu_id", "is", null),
      admin.from("competency_decisions")
        .select("competency_id, cpu_id, outcome, expiry_date, created_at")
        .eq("nurse_id", user.id).order("created_at", { ascending: false }),
      admin.from("assessment_blueprints")
        .select("cpu_id, min_score, min_assessors, consensus_rule, blueprint_methods(method, weight, is_required)"),
      admin.from("evidence_matrix").select("cpu_id, evidence_type, min_quantity, is_critical"),
      admin.from("resource_competencies").select("competency_id, learning_resources(title, resource_type, is_active)"),
    ]);

  // Latest decision per competency
  const latest = new Map<string, { outcome: DecisionOutcome; expiry: string | null }>();
  for (const d of decisions ?? []) {
    if (!latest.has(d.competency_id)) latest.set(d.competency_id, { outcome: d.outcome as DecisionOutcome, expiry: d.expiry_date });
  }

  const compsByCpu = new Map<string, { id: string; name: string }[]>();
  for (const c of comps ?? []) {
    if (!c.cpu_id) continue;
    if (!compsByCpu.has(c.cpu_id)) compsByCpu.set(c.cpu_id, []);
    compsByCpu.get(c.cpu_id)!.push({ id: c.id, name: c.name });
  }
  const bpByCpu = new Map((blueprints ?? []).map(b => [b.cpu_id, b]));
  const evByCpu = new Map<string, { evidence_type: string; min_quantity: number; is_critical: boolean }[]>();
  for (const e of evidence ?? []) {
    if (!evByCpu.has(e.cpu_id)) evByCpu.set(e.cpu_id, []);
    evByCpu.get(e.cpu_id)!.push(e);
  }
  const resByComp = new Map<string, string[]>();
  for (const r of resources ?? []) {
    const lr = r.learning_resources as unknown as { title: string; is_active: boolean } | null;
    if (!lr?.is_active) continue;
    if (!resByComp.has(r.competency_id)) resByComp.set(r.competency_id, []);
    resByComp.get(r.competency_id)!.push(lr.title);
  }

  const rows = (cpus ?? []).map(cpu => {
    const cpuComps = compsByCpu.get(cpu.id) ?? [];
    const decided = cpuComps.map(c => ({ ...c, d: latest.get(c.id) ?? null }));
    const passing = decided.filter(c => c.d && (OUTCOME_CONFIG[c.d.outcome]?.passing ?? false)).length;
    const progress = cpuComps.length ? Math.round((passing / cpuComps.length) * 100) : 0;
    const expiries = decided.map(c => c.d?.expiry).filter(Boolean) as string[];
    const nextReassessment = expiries.length ? expiries.sort()[0] : null;
    const started = decided.some(c => c.d);
    return { cpu, cpuComps: decided, passing, progress, nextReassessment, started };
  }).sort((a, b) => Number(b.started) - Number(a.started));

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">My Clinical Practice Units</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Where learning, workplace practice and assessment converge — your progress through each unit of clinical work.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-4xl mb-3">🏥</p>
          <p className="font-semibold text-gray-700">No published CPUs yet</p>
          <p className="text-gray-400 text-sm mt-2">Clinical Practice Units appear here once your organisation publishes them.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {rows.map(({ cpu, cpuComps, passing, progress, nextReassessment, started }) => {
            const risk = RISK_CONFIG[cpu.risk_category] ?? null;
            const bp = bpByCpu.get(cpu.id);
            const ev = evByCpu.get(cpu.id) ?? [];
            const practice = (cpu.practices as unknown as { name: string } | null)?.name;
            return (
              <div key={cpu.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900">{cpu.name}
                        <span className="ml-2 text-[10px] font-mono font-normal text-gray-300">{cpu.code}</span>
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {practice ? `${practice} · ` : ""}{COMPLEXITY_LABELS[cpu.complexity] ?? `Level ${cpu.complexity}`}
                        {cpu.reassessment_months ? ` · reassess every ${cpu.reassessment_months} months` : ""}
                      </p>
                    </div>
                    {risk && <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${risk.cls}`}>{risk.label}</span>}
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-gray-900">{progress}%</p>
                      <p className="text-[10px] text-gray-400">{passing}/{cpuComps.length} competent</p>
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-3">
                    <div className={`h-full rounded-full ${progress >= 100 ? "bg-green-500" : progress > 0 ? "bg-teal-500" : "bg-gray-200"}`}
                      style={{ width: `${Math.max(progress, 2)}%` }} />
                  </div>
                </div>

                <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Competencies</p>
                    <div className="flex flex-col gap-1.5">
                      {cpuComps.map(c => {
                        const oc = c.d ? OUTCOME_CONFIG[c.d.outcome] : null;
                        const resTitles = resByComp.get(c.id) ?? [];
                        return (
                          <div key={c.id} className="flex items-center gap-2">
                            <span className="flex-1 text-sm text-gray-700 min-w-0 truncate" title={resTitles.length ? `Learning: ${resTitles.join(", ")}` : undefined}>{c.name}</span>
                            {oc
                              ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${oc.cls}`}>{oc.label}</span>
                              : <span className="text-[10px] text-gray-300 shrink-0">Not yet assessed</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-4">
                    {bp && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Assessment Blueprint</p>
                        <div className="flex flex-wrap gap-1.5">
                          {((bp.blueprint_methods ?? []) as { method: string; weight: number }[]).map(m => (
                            <span key={m.method} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">
                              {METHOD_LABELS[m.method] ?? m.method} {m.weight}%
                            </span>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1.5">
                          Pass mark {bp.min_score}/6 · {bp.min_assessors} assessor{bp.min_assessors !== 1 ? "s" : ""} ({bp.consensus_rule})
                        </p>
                      </div>
                    )}
                    {ev.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Evidence Required</p>
                        <div className="flex flex-col gap-1">
                          {ev.map((e, i) => (
                            <p key={i} className="text-[11px] text-gray-600">
                              {e.min_quantity}× {METHOD_LABELS[e.evidence_type] ?? e.evidence_type}
                              {e.is_critical && <span className="ml-1.5 text-[9px] font-bold text-red-500">CRITICAL</span>}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {started && nextReassessment && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                        ⏰ Reassessment due {new Date(nextReassessment).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-6">
        Gaps in a CPU feed your <Link href="/dashboard/learning" className="text-teal-600 hover:underline">Learning Pathway</Link> automatically.
      </p>
    </div>
  );
}
