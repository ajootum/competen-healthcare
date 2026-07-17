"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ClinicalCase = {
  id: string; code: string | null; title: string;
  scenario: string | null; findings: string | null; discussion: string | null;
  questions: string[]; learningPoints: string[];
  difficulty: string; status: string; source: string | null; cpuName: string | null;
};

const DIFFICULTY_UI: Record<string, { label: string; cls: string }> = {
  foundation:   { label: "Foundation",   cls: "bg-green-50 text-green-700" },
  intermediate: { label: "Intermediate", cls: "bg-blue-50 text-blue-700" },
  advanced:     { label: "Advanced",     cls: "bg-violet-50 text-violet-700" },
};
const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  retired: "bg-gray-100 text-gray-400",
};

export default function CaseLibrary({ cases }: { cases: ClinicalCase[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState<Record<string, boolean>>({});

  const q = search.trim().toLowerCase();
  const visible = cases.filter(c => !q || c.title.toLowerCase().includes(q) || (c.scenario ?? "").toLowerCase().includes(q));

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/clinical-cases?id=${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    router.refresh();
  }

  if (!cases.length) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
        <p className="text-3xl mb-2">🧑‍⚕️</p>
        <p className="text-sm font-semibold text-gray-700">No case studies yet</p>
        <p className="text-xs text-gray-400 mt-1">
          Import a CPU document — its worked case studies are extracted automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5">{error}</div>}

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search cases…"
        className="border border-gray-200 rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30" />

      <div className="flex flex-col gap-2">
        {visible.map(c => {
          const isOpen = open === c.id;
          const d = DIFFICULTY_UI[c.difficulty] ?? DIFFICULTY_UI.intermediate;
          const answersShown = showAnswers[c.id];
          return (
            <div key={c.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : c.id)}
                className="w-full text-left px-5 py-3.5 hover:bg-gray-50/60 transition-colors flex items-center gap-3">
                <span className="text-lg">🧑‍⚕️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.title}
                    {c.code && <span className="ml-2 text-[10px] font-mono text-gray-300">{c.code}</span>}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {c.cpuName ?? "unlinked"}{c.questions.length ? ` · ${c.questions.length} questions` : ""}
                    {c.learningPoints.length ? ` · ${c.learningPoints.length} learning points` : ""}
                  </p>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${d.cls}`}>{d.label}</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded capitalize ${STATUS_CLS[c.status] ?? STATUS_CLS.draft}`}>{c.status}</span>
                <span className="text-gray-300 text-xs">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 bg-gray-50/40 border-t border-gray-50 pt-4">
                  {c.scenario && (
                    <section className="mb-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Clinical scenario</p>
                      <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">{c.scenario}</p>
                    </section>
                  )}
                  {c.findings && (
                    <section className="mb-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Assessment findings</p>
                      <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed">{c.findings}</p>
                    </section>
                  )}
                  {c.questions.length > 0 && (
                    <section className="mb-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Questions</p>
                      <ol className="text-xs text-gray-700 list-decimal ml-4 space-y-0.5">
                        {c.questions.map((x, i) => <li key={i}>{x}</li>)}
                      </ol>
                    </section>
                  )}

                  {(c.discussion || c.learningPoints.length > 0) && (
                    <>
                      <button onClick={() => setShowAnswers(s => ({ ...s, [c.id]: !s[c.id] }))}
                        className="text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg mb-3">
                        {answersShown ? "Hide expert discussion" : "Reveal expert discussion"}
                      </button>
                      {answersShown && (
                        <div className="bg-white rounded-lg border border-teal-100 p-4">
                          {c.discussion && (
                            <>
                              <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-1">Discussion</p>
                              <p className="text-xs text-gray-700 whitespace-pre-line leading-relaxed mb-3">{c.discussion}</p>
                            </>
                          )}
                          {c.learningPoints.length > 0 && (
                            <>
                              <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-1">Learning points</p>
                              <ul className="text-xs text-gray-700 space-y-0.5">
                                {c.learningPoints.map((x, i) => <li key={i}>💡 {x}</li>)}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex gap-2 mt-4 pt-3 border-t border-gray-100">
                    {c.status !== "active" ? (
                      <button disabled={busy} onClick={() => patch(c.id, { status: "active" })}
                        className="text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg">Publish</button>
                    ) : (
                      <button disabled={busy} onClick={() => patch(c.id, { status: "draft" })}
                        className="text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg">Unpublish</button>
                    )}
                    <select disabled={busy} value={c.difficulty} onChange={e => patch(c.id, { difficulty: e.target.value })}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
                      {Object.entries(DIFFICULTY_UI).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <button disabled={busy} onClick={() => patch(c.id, { status: "retired" })}
                      className="text-xs text-gray-400 hover:text-red-500 px-3 py-1.5 rounded-lg ml-auto">Retire</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
