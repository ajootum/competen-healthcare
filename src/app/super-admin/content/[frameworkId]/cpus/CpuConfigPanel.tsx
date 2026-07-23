"use client";
import { useEffect, useState } from "react";
import { METHOD_LABELS, EVIDENCE_TYPES, CONSENSUS_LABELS, type ConsensusRule } from "@/lib/ckcm";

type Cpu = { id: string; name: string; reassessment_months: number };
type Blueprint = { id: string; min_score: number; min_assessors: number; consensus_rule: string; reassessment_months: number };
type Method = { method: string; weight: number; is_required: boolean; min_evidence: number };
type EvidenceRow = { evidence_type: string; min_quantity: number; weight: number; validity_months: number; is_critical: boolean; min_assessors: number };
type Critical = { id: string; description: string };

const ALL_METHODS = Object.keys(METHOD_LABELS);

export default function CpuConfigPanel({ cpu, onClose }: { cpu: Cpu; onClose: () => void }) {
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [methods, setMethods] = useState<Method[]>([]);
  const [matrix, setMatrix] = useState<EvidenceRow[]>([]);
  const [critical, setCritical] = useState<Critical[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"blueprint" | "evidence" | "critical">("blueprint");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/content/cpus/${cpu.id}/config`);
    if (res.ok) {
      const d = await res.json();
      setBlueprint(d.blueprint);
      setMethods(d.methods ?? []);
      setMatrix(d.matrix ?? []);
      setCritical(d.critical ?? []);
    }
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [cpu.id]);

  async function patch(body: object) {
    await fetch(`/api/content/cpus/${cpu.id}/config`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    load();
  }
  async function del(kind: string, value: string) {
    await fetch(`/api/content/cpus/${cpu.id}/config?kind=${kind}&value=${encodeURIComponent(value)}`, { method: "DELETE" });
    load();
  }

  const methodMap = new Map(methods.map(m => [m.method, m]));
  const matrixMap = new Map(matrix.map(m => [m.evidence_type, m]));
  const totalMethodWeight = methods.reduce((s, m) => s + (m.weight || 0), 0);
  const totalEvidenceWeight = matrix.reduce((s, m) => s + (m.weight || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-gray-900">Configure CPU</h2>
            <p className="text-sm text-gray-400">{cpu.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </div>

        <div className="flex gap-1 px-6 pt-4">
          {([["blueprint", "Assessment Blueprint"], ["evidence", "Evidence Matrix"], ["critical", "Critical Failures"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${tab === k ? "bg-teal-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="p-6">
            {/* ── BLUEPRINT ── */}
            {tab === "blueprint" && blueprint && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Min Score (0–6)">
                    <input type="number" min={0} max={6} defaultValue={blueprint.min_score}
                      onBlur={e => patch({ type: "blueprint", min_score: parseInt(e.target.value) || 0 })}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                  </Field>
                  <Field label="Min Assessors">
                    <input type="number" min={1} defaultValue={blueprint.min_assessors}
                      onBlur={e => patch({ type: "blueprint", min_assessors: parseInt(e.target.value) || 1 })}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                  </Field>
                  <Field label="Reassess (months)">
                    <input type="number" min={1} defaultValue={blueprint.reassessment_months}
                      onBlur={e => patch({ type: "blueprint", reassessment_months: parseInt(e.target.value) || 12 })}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                  </Field>
                </div>
                <Field label="Consensus Rule">
                  <select defaultValue={blueprint.consensus_rule}
                    onChange={e => patch({ type: "blueprint", consensus_rule: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                    {(Object.keys(CONSENSUS_LABELS) as ConsensusRule[]).map(r => <option key={r} value={r}>{CONSENSUS_LABELS[r]}</option>)}
                  </select>
                </Field>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Required Methods &amp; Weighting</p>
                    <span className={`text-[10px] font-semibold ${totalMethodWeight === 100 ? "text-green-600" : "text-amber-600"}`}>Total: {totalMethodWeight}%</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {ALL_METHODS.map(m => {
                      const cfg = methodMap.get(m);
                      const enabled = !!cfg;
                      return (
                        <div key={m} className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                            <input type="checkbox" checked={enabled} className="accent-teal-500"
                              onChange={e => e.target.checked ? patch({ type: "method", method: m, weight: 0 }) : del("method", m)} />
                            <span className={`text-xs ${enabled ? "text-gray-800" : "text-gray-400"}`}>{METHOD_LABELS[m as keyof typeof METHOD_LABELS]}</span>
                          </label>
                          {enabled && (
                            <input type="number" min={0} max={100} defaultValue={cfg!.weight} title="Weight %"
                              onBlur={e => patch({ type: "method", method: m, weight: parseInt(e.target.value) || 0, is_required: cfg!.is_required, min_evidence: cfg!.min_evidence })}
                              className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                          )}
                          {enabled && <span className="text-[10px] text-gray-400">%</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── EVIDENCE MATRIX ── */}
            {tab === "evidence" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-400">Required evidence per CKCM hierarchy (strongest first)</p>
                  <span className={`text-[10px] font-semibold ${totalEvidenceWeight === 100 ? "text-green-600" : "text-amber-600"}`}>Total: {totalEvidenceWeight}%</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {EVIDENCE_TYPES.map(et => {
                    const row = matrixMap.get(et.key);
                    const enabled = !!row;
                    return (
                      <div key={et.key} className={`rounded-lg border px-3 py-2 ${enabled ? "border-teal-100 bg-teal-50/30" : "border-gray-100"}`}>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                            <input type="checkbox" checked={enabled} className="accent-teal-500"
                              onChange={e => e.target.checked ? patch({ type: "evidence", evidence_type: et.key }) : del("evidence", et.key)} />
                            <span className={`text-xs font-medium ${enabled ? "text-gray-800" : "text-gray-400"}`}>{et.label}</span>
                            <span className="text-[9px] text-gray-400">({et.strength})</span>
                          </label>
                          {enabled && (
                            <label className="flex items-center gap-1 text-[10px] text-gray-500">
                              <input type="checkbox" checked={row!.is_critical} className="accent-red-500"
                                onChange={e => patch({ type: "evidence", evidence_type: et.key, min_quantity: row!.min_quantity, weight: row!.weight, validity_months: row!.validity_months, is_critical: e.target.checked, min_assessors: row!.min_assessors })} />
                              critical
                            </label>
                          )}
                        </div>
                        {enabled && (
                          <div className="flex items-center gap-3 mt-2 pl-6">
                            <NumField label="Min qty" value={row!.min_quantity} onSave={v => patch({ type: "evidence", evidence_type: et.key, min_quantity: v, weight: row!.weight, validity_months: row!.validity_months, is_critical: row!.is_critical, min_assessors: row!.min_assessors })} />
                            <NumField label="Weight %" value={row!.weight} onSave={v => patch({ type: "evidence", evidence_type: et.key, min_quantity: row!.min_quantity, weight: v, validity_months: row!.validity_months, is_critical: row!.is_critical, min_assessors: row!.min_assessors })} />
                            <NumField label="Valid (mo)" value={row!.validity_months} onSave={v => patch({ type: "evidence", evidence_type: et.key, min_quantity: row!.min_quantity, weight: row!.weight, validity_months: v, is_critical: row!.is_critical, min_assessors: row!.min_assessors })} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── CRITICAL FAILURES ── */}
            {tab === "critical" && (
              <div>
                <p className="text-xs text-gray-400 mb-3">Non-negotiable safety failures that block competency regardless of overall score.</p>
                <div className="flex flex-col gap-1.5 mb-3">
                  {critical.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2">
                      <span className="text-xs text-gray-700">{c.description}</span>
                      <button onClick={() => del("critical", c.id)} className="text-red-400 hover:text-red-600 text-sm leading-none">×</button>
                    </div>
                  ))}
                  {!critical.length && <p className="text-[11px] text-gray-300 italic">None defined</p>}
                </div>
                <button
                  onClick={() => { const d = prompt("Critical failure (e.g. Wrong patient identification):"); if (d?.trim()) patch({ type: "critical", description: d.trim() }); }}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-50 text-red-600 border border-red-100 rounded-lg hover:bg-red-100">
                  + Add Critical Failure
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">{label}</label>
      {children}
    </div>
  );
}

function NumField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-gray-500">
      {label}
      <input type="number" min={0} defaultValue={value}
        onBlur={e => onSave(parseInt(e.target.value) || 0)}
        className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-right" />
    </label>
  );
}
