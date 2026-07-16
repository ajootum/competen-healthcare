"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TASK_TYPE_UI, ENTRUSTMENT_LABELS, RISK_CONFIG as RISK_T, METHOD_LABELS as METHOD_T } from "@/lib/ckcm";
import type { AssessorTask } from "@/lib/engines/tasks";

const RISK_CONFIG = RISK_T as Record<string, { label: string; cls: string }>;
const METHOD_LABELS = METHOD_T as Record<string, string>;

const PRIORITY_HEADERS: Record<number, string> = {
  1: "🚨 Urgent — safety restrictions",
  2: "🔑 Blocking independent practice",
  3: "⏰ Expired & orientation",
  4: "🌱 Gaps after assessment",
  5: "🔄 Expiring within 60 days",
  6: "📋 Routine scheduled",
};

export default function SmartQueue({ tasks, workload }: {
  tasks: AssessorTask[];
  workload: { tasks: number; estMinutes: number; learners: number; urgent: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [entrustFor, setEntrustFor] = useState<AssessorTask | null>(null);
  const [level, setLevel] = useState("independent");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = (t: AssessorTask) => `${t.nurseId}:${t.cpuId}`;
  const grouped = new Map<number, AssessorTask[]>();
  for (const t of tasks) {
    if (!grouped.has(t.priority)) grouped.set(t.priority, []);
    grouped.get(t.priority)!.push(t);
  }

  async function decide() {
    if (!entrustFor) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/assessor/entrustment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nurse_id: entrustFor.nurseId, cpu_id: entrustFor.cpuId, entrustment_level: level, rationale }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setEntrustFor(null); setRationale("");
    router.refresh();
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">My Assessment Queue</h2>
        <p className="text-[11px] text-gray-400">
          {workload.tasks} task{workload.tasks !== 1 ? "s" : ""} · {workload.learners} learner{workload.learners !== 1 ? "s" : ""} · ≈{Math.round(workload.estMinutes / 60 * 10) / 10}h estimated
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white rounded-xl border border-green-100 p-6 text-sm text-green-700">
          ✅ Queue clear — no generated assessment work. Tasks appear here from role requirements, evidence gaps, expiries and pending entrustment decisions.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {[...grouped.entries()].map(([priority, list]) => (
            <div key={priority}>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                {PRIORITY_HEADERS[priority] ?? "Other"} ({list.length})
              </p>
              <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
                {list.map(t => {
                  const ui = TASK_TYPE_UI[t.type];
                  const risk = RISK_CONFIG[t.riskCategory];
                  const isOpen = open === key(t);
                  return (
                    <div key={key(t)}>
                      {/* Level 1 — task card */}
                      <button onClick={() => setOpen(isOpen ? null : key(t))}
                        className="w-full text-left px-5 py-3 hover:bg-gray-50/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{ui.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              {t.nurseName} <span className="text-gray-400 font-normal">·</span> {t.cpuName}
                            </p>
                            <p className="text-[11px] text-gray-400">{t.reason}</p>
                          </div>
                          {risk && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded hidden sm:inline ${risk.cls}`}>{risk.label}</span>}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ui.cls}`}>{ui.label}</span>
                          <div className="text-right shrink-0 w-16">
                            <p className="text-sm font-bold text-gray-800">{t.readiness}%</p>
                            <p className="text-[9px] text-gray-400">~{t.estMinutes} min</p>
                          </div>
                          <span className="text-gray-300 text-xs">{isOpen ? "▲" : "▼"}</span>
                        </div>
                      </button>

                      {/* Level 2 — assessment summary */}
                      {isOpen && (
                        <div className="px-5 pb-4 bg-gray-50/40">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Evidence</p>
                              <p className="text-xs text-green-700">✓ {t.evidence.complete} competencies current</p>
                              {t.evidence.gaps.map(g => <p key={g} className="text-xs text-amber-700">→ Gap: {g}</p>)}
                              {t.evidence.expired.map(g => <p key={g} className="text-xs text-red-600">✗ Expired: {g}</p>)}
                              {t.evidence.expiring.map(g => <p key={g} className="text-xs text-amber-600">⏰ Expiring: {g}</p>)}
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Critical safety elements</p>
                              {t.criticalItems.length === 0
                                ? <p className="text-xs text-gray-400">None defined</p>
                                : t.criticalItems.map(c => <p key={c} className="text-xs text-red-600">⛔ {c}</p>)}
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Blueprint methods</p>
                              <div className="flex flex-wrap gap-1">
                                {t.methods.map(m => (
                                  <span key={m} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{METHOD_LABELS[m] ?? m}</span>
                                ))}
                              </div>
                              <p className="text-[10px] text-gray-400 mt-2">Decision required: <b>{t.decisionRequired}</b></p>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            {t.type === "entrustment" ? (
                              <button onClick={() => { setEntrustFor(t); setLevel("independent"); setError(null); }}
                                className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                                🔑 Record entrustment decision
                              </button>
                            ) : (
                              <Link href="/assessor/assess"
                                className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                                ▶ Start assessment
                              </Link>
                            )}
                            <Link href={`/assessor/nurses`}
                              className="text-xs text-gray-500 hover:bg-gray-100 px-3 py-2 rounded-lg transition-colors">
                              View learner
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Entrustment decision panel */}
      {entrustFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEntrustFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Entrustment decision</p>
            <p className="font-bold text-gray-900">{entrustFor.nurseName}</p>
            <p className="text-sm text-gray-500 mb-1">{entrustFor.cpuName}</p>
            <p className="text-[11px] text-green-700 mb-4">✓ {entrustFor.evidence.complete}/{entrustFor.evidence.complete + entrustFor.evidence.gaps.length} competencies current — evidence supports authorization</p>
            {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
            <div className="flex flex-col gap-1.5 mb-4">
              {Object.entries(ENTRUSTMENT_LABELS).map(([k, v]) => (
                <label key={k} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  level === k ? "border-teal-400 bg-teal-50" : "border-gray-100 hover:bg-gray-50"}`}>
                  <input type="radio" name="entrustment" checked={level === k} onChange={() => setLevel(k)} />
                  <span className="text-sm text-gray-800">{v}</span>
                </label>
              ))}
            </div>
            <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              rows={2} placeholder="Rationale (optional)" value={rationale} onChange={e => setRationale(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEntrustFor(null)} className="text-sm text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={busy} onClick={decide}
                className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                {busy ? "Recording…" : "Record decision"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
