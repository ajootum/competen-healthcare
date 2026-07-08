"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RISK_CONFIG, COMPLEXITY_LABELS, type RiskCategory } from "@/lib/ckcm";
import CpuConfigPanel from "./CpuConfigPanel";

type Competency = { id: string; name: string; practice_id: string | null; cpu_id: string | null; risk_category: string | null };
type Domain = { id: string; name: string; sort_order: number; framework_competencies: Competency[] };
type Practice = { id: string; domain_id: string; name: string; code: string | null; sort_order: number };
type Cpu = {
  id: string; practice_id: string; name: string; code: string | null;
  risk_category: string; complexity: number; reassessment_months: number; pub_status: string; sort_order: number;
};

export default function CpuBuilder({
  frameworkId, domains, practices, cpus,
}: {
  frameworkId: string;
  domains: Domain[];
  practices: Practice[];
  cpus: Cpu[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [configCpu, setConfigCpu] = useState<Cpu | null>(null);

  async function api(url: string, method: string, body?: object) {
    setBusy(true);
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json().catch(() => ({}))).error ?? "Operation failed");
    return res.ok;
  }

  async function addPractice(domainId: string) {
    const name = prompt("Practice name (e.g. Oxygen Therapy):");
    if (!name?.trim()) return;
    await api("/api/content/practices", "POST", { domain_id: domainId, name: name.trim() });
  }
  async function renamePractice(p: Practice) {
    const name = prompt("Rename practice:", p.name);
    if (!name?.trim() || name === p.name) return;
    await api("/api/content/practices", "PATCH", { id: p.id, name: name.trim() });
  }
  async function deletePractice(p: Practice) {
    if (!confirm(`Delete practice "${p.name}" and its CPUs? Competencies are kept (unassigned).`)) return;
    await api(`/api/content/practices?id=${p.id}`, "DELETE");
  }
  async function addCpu(practiceId: string) {
    const name = prompt("Clinical Practice Unit name (e.g. Safe Oxygen Administration):");
    if (!name?.trim()) return;
    await api("/api/content/cpus", "POST", { practice_id: practiceId, name: name.trim() });
  }
  async function deleteCpu(c: Cpu) {
    if (!confirm(`Delete CPU "${c.name}"? Its blueprint and evidence matrix are removed; competencies are kept.`)) return;
    await api(`/api/content/cpus?id=${c.id}`, "DELETE");
  }
  async function assignCompetency(competencyId: string, practiceId: string | null, cpuId: string | null) {
    await api(`/api/content/competencies?id=${competencyId}`, "PATCH", { practice_id: practiceId, cpu_id: cpuId });
  }

  const practicesByDomain = (domainId: string) => practices.filter(p => p.domain_id === domainId).sort((a, b) => a.sort_order - b.sort_order);
  const cpusByPractice = (practiceId: string) => cpus.filter(c => c.practice_id === practiceId).sort((a, b) => a.sort_order - b.sort_order);
  const competenciesInCpu = (dom: Domain, cpuId: string) => dom.framework_competencies.filter(c => c.cpu_id === cpuId);
  const unassignedInDomain = (dom: Domain) => dom.framework_competencies.filter(c => !c.cpu_id);

  return (
    <div className="flex flex-col gap-4">
      {domains.map(domain => {
        const doms = practicesByDomain(domain.id);
        const unassigned = unassignedInDomain(domain);
        return (
          <div key={domain.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-gray-50/60 border-b border-gray-100">
              <div>
                <p className="font-semibold text-gray-900 text-sm">{domain.name}</p>
                <p className="text-[10px] text-gray-400">{doms.length} practice{doms.length !== 1 ? "s" : ""} · {domain.framework_competencies.length} competencies</p>
              </div>
              <button onClick={() => addPractice(domain.id)} disabled={busy}
                className="px-3 py-1 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg hover:bg-indigo-100 disabled:opacity-50">
                + Practice
              </button>
            </div>

            <div className="divide-y divide-gray-50">
              {doms.map(practice => {
                const pcpus = cpusByPractice(practice.id);
                return (
                  <div key={practice.id} className="px-5 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-indigo-400 text-xs">▸</span>
                        <p className="text-sm font-medium text-gray-800">{practice.name}</p>
                        <span className="text-[10px] text-gray-400">{pcpus.length} CPU{pcpus.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => renamePractice(practice)} className="px-2 py-0.5 text-[11px] text-gray-500 border border-gray-200 rounded hover:bg-gray-100">Edit</button>
                        <button onClick={() => deletePractice(practice)} className="px-2 py-0.5 text-[11px] text-red-500 border border-red-100 rounded hover:bg-red-50">Delete</button>
                        <button onClick={() => addCpu(practice.id)} className="px-2 py-0.5 text-[11px] text-teal-600 border border-teal-200 rounded hover:bg-teal-50 font-semibold">+ CPU</button>
                      </div>
                    </div>

                    {/* CPUs under this practice */}
                    <div className="flex flex-col gap-2 pl-5">
                      {pcpus.map(cpu => {
                        const risk = RISK_CONFIG[(cpu.risk_category as RiskCategory)] ?? RISK_CONFIG.standard;
                        const inCpu = competenciesInCpu(domain, cpu.id);
                        return (
                          <div key={cpu.id} className="rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-teal-500 text-xs">■</span>
                                <p className="text-sm font-medium text-gray-800">{cpu.name}</p>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${risk.cls}`}>{risk.label}</span>
                                <span className="text-[9px] text-gray-400">L{cpu.complexity} · {COMPLEXITY_LABELS[cpu.complexity]}</span>
                                {cpu.pub_status !== "published" && (
                                  <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded capitalize">{cpu.pub_status.replace("_", " ")}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => setConfigCpu(cpu)} className="px-2 py-0.5 text-[11px] text-teal-600 border border-teal-200 rounded hover:bg-teal-50 font-semibold">Configure</button>
                                <button onClick={() => deleteCpu(cpu)} className="px-2 py-0.5 text-[11px] text-red-500 border border-red-100 rounded hover:bg-red-50">Delete</button>
                              </div>
                            </div>
                            {/* Competencies assigned to this CPU */}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {inCpu.map(c => (
                                <span key={c.id} className="group inline-flex items-center gap-1 text-xs bg-white border border-teal-100 text-teal-700 pl-2.5 pr-1.5 py-0.5 rounded-full">
                                  {c.name}
                                  <button onClick={() => assignCompetency(c.id, null, null)} title="Unassign"
                                    className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity leading-none px-0.5">×</button>
                                </span>
                              ))}
                              {!inCpu.length && <p className="text-[11px] text-gray-300 italic">No competencies assigned</p>}
                            </div>
                          </div>
                        );
                      })}
                      {!pcpus.length && <p className="text-[11px] text-gray-300 italic pl-1">No CPUs yet — click &quot;+ CPU&quot;</p>}
                    </div>
                  </div>
                );
              })}
              {!doms.length && <p className="px-5 py-3 text-xs text-gray-400 italic">No practices yet — click &quot;+ Practice&quot;</p>}
            </div>

            {/* Unassigned competencies — quick-assign into a CPU */}
            {unassigned.length > 0 && (
              <div className="px-5 py-3 border-t border-dashed border-gray-200 bg-amber-50/20">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-2">Unassigned competencies ({unassigned.length})</p>
                <div className="flex flex-col gap-1.5">
                  {unassigned.map(c => {
                    const allCpus = doms.flatMap(p => cpusByPractice(p.id).map(cpu => ({ ...cpu, practiceName: p.name })));
                    return (
                      <div key={c.id} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-600">{c.name}</span>
                        {allCpus.length > 0 ? (
                          <select
                            defaultValue=""
                            onChange={e => { const cpu = allCpus.find(x => x.id === e.target.value); if (cpu) assignCompetency(c.id, cpu.practice_id, cpu.id); }}
                            className="text-[11px] border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400">
                            <option value="" disabled>Assign to CPU…</option>
                            {allCpus.map(cpu => <option key={cpu.id} value={cpu.id}>{cpu.practiceName} → {cpu.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-[10px] text-gray-300 italic">create a CPU first</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!domains.length && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-gray-400 text-sm">This framework has no domains yet. Add domains &amp; competencies in the main builder first, then organise them here.</p>
        </div>
      )}

      {configCpu && (
        <CpuConfigPanel cpu={configCpu} onClose={() => setConfigCpu(null)} />
      )}
    </div>
  );
}
