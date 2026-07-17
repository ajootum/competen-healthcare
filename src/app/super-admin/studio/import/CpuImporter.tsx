"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ParsedCpu } from "@/lib/import/cpu-parser";

type Opt = { id: string; label: string };

export default function CpuImporter({ practices, domains }: { practices: Opt[]; domains: Opt[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [cpus, setCpus] = useState<ParsedCpu[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [practiceId, setPracticeId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: Record<string, number>; skipped: Record<string, number> } | null>(null);

  const chosen = cpus?.find(c => c.code === selected) ?? null;

  async function preview(payload?: { docxBase64: string }) {
    setBusy(true); setError(null); setResult(null);
    const res = await fetch("/api/import/cpu", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "preview", ...(payload ?? { text }) }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Could not read the document"); return; }
    const data = await res.json();
    setText(data.text ?? text);   // keep the converted text for the commit step
    setCpus(data.cpus);
    setSelected(data.cpus[0]?.code ?? null);
  }

  async function onFile(file: File) {
    if (!/\.docx$/i.test(file.name)) { setError("Please choose a .docx file."); return; }
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    await preview({ docxBase64: btoa(bin) });
  }

  async function commit() {
    if (!chosen) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/import/cpu", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "commit", text, code: chosen.code, practice_id: practiceId, domain_id: domainId }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Import failed"); return; }
    setResult({ created: data.created, skipped: data.skipped });
    router.refresh();
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";

  if (result) {
    return (
      <div className="bg-white rounded-xl border border-green-200 p-6">
        <p className="text-3xl mb-2">✅</p>
        <h2 className="font-bold text-gray-900">Imported “{chosen?.title}”</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 my-4">
          {[
            { k: "competencies", label: "Competencies" },
            { k: "skills", label: "Library skills" },
            { k: "knowledgeObjects", label: "Knowledge objects" },
            { k: "knowledgeRequirements", label: "Knowledge outcomes" },
            { k: "cases", label: "Case studies" },
            { k: "criticalRules", label: "Critical rules" },
            { k: "questions", label: "MCQs" },
          ].map(x => (
            <div key={x.k} className="bg-green-50 rounded-lg p-3">
              <p className="text-2xl font-bold text-green-700">{result.created[x.k] ?? 0}</p>
              <p className="text-[10px] text-green-800/70">{x.label}</p>
            </div>
          ))}
        </div>
        <div className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 pt-3">
          <p className="font-semibold text-gray-700 mb-1">Not imported — needs your attention:</p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li><b>{result.skipped.checklistItems ?? 0}</b> OSCE checklist items — checklists attach to a skill, so build them in the Checklist Builder once skills are assigned.</li>
            <li><b>{result.skipped.unansweredQuestions ?? 0}</b> MCQs without an answer key — add them in the Question Builder.</li>
          </ul>
          <p className="mt-2">Knowledge objects were imported as <b>drafts</b> — review and publish them in Knowledge Objects to make them searchable and citable by the AI.</p>
          <p className="mt-2">Skills were added to the <b>reusable library</b>, not attached to competencies — the document doesn’t say which skill belongs to which competency. Attach them in the Skill Builder.</p>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={() => { setResult(null); setCpus(null); setText(""); }}
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg">Import another</button>
          <a href="/super-admin/studio/cpus" className="text-sm text-teal-700 bg-teal-50 hover:bg-teal-100 px-4 py-2 rounded-lg">View CPU library →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {/* Step 1 — upload or paste */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-2">Step 1 · Supply the document</p>

        <label className="flex items-center gap-3 border-2 border-dashed border-teal-200 rounded-xl px-4 py-5 cursor-pointer hover:bg-teal-50/40 transition-colors">
          <span className="text-2xl">📄</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-800">{fileName ?? "Choose a .docx file"}</p>
            <p className="text-[11px] text-gray-400">Recommended — Word list formatting is preserved, so more is extracted.</p>
          </div>
          <input type="file" accept=".docx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-3 py-1.5 rounded-lg">Browse</span>
        </label>

        <details className="mt-3">
          <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">…or paste the text instead</summary>
          <textarea value={text} onChange={e => { setText(e.target.value); setCpus(null); setFileName(null); }}
            rows={6} placeholder="Paste the document text here…"
            className={`${input} font-mono text-xs mt-2`} />
          <button disabled={busy || !text.trim()} onClick={() => preview()}
            className="mt-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
            {busy && !cpus ? "Reading…" : "Read pasted text"}
          </button>
        </details>

        {busy && !cpus && <p className="text-xs text-teal-600 mt-3">Reading document…</p>}
      </div>

      {/* Step 2 — review */}
      {cpus && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-2">
            Step 2 · Review — {cpus.length} CPU{cpus.length !== 1 ? "s" : ""} found
          </p>
          {cpus.length === 0 && <p className="text-sm text-gray-400">No CPU could be read. Check the document starts with a line like “CPU-DIS-010: Title”.</p>}
          <div className="flex flex-col gap-2">
            {cpus.map(c => {
              const isSel = c.code === selected;
              return (
                <button key={c.code ?? c.title} onClick={() => setSelected(c.code)}
                  className={`text-left rounded-lg border p-3 transition-colors ${isSel ? "border-teal-400 bg-teal-50/50" : "border-gray-100 hover:bg-gray-50"}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" readOnly checked={isSel} />
                    <span className="font-mono text-[10px] text-gray-400">{c.code ?? "no code"}</span>
                    <span className="text-sm font-medium text-gray-800 flex-1 truncate">{c.title ?? "Untitled"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2 ml-6">
                    {[
                      ["competencies", c.competencies.length], ["skills", c.skills.length],
                      ["knowledge objects", c.knowledgeObjects.length], ["knowledge outcomes", c.knowledge.length],
                      ["case studies", c.cases.length], ["red flags", c.redFlags.length],
                      ["MCQs", c.questions.length], ["checklist", c.checklistItems.length],
                    ].map(([label, n]) => (
                      <span key={label as string} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${(n as number) > 0 ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-400"}`}>
                        {n as number} {label as string}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detail of the selected CPU */}
          {chosen && (
            <div className="mt-4 border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Competencies to create</p>
                {chosen.competencies.length ? (
                  <ul className="text-xs text-gray-700 space-y-0.5 max-h-40 overflow-y-auto">
                    {chosen.competencies.map((x, i) => <li key={i}>• {x}</li>)}
                  </ul>
                ) : <p className="text-xs text-gray-400">None found.</p>}
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-3 mb-1.5">Critical-failure rules</p>
                {chosen.redFlags.length ? (
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-28 overflow-y-auto">
                    {chosen.redFlags.map((x, i) => <li key={i}>⛔ {x}</li>)}
                  </ul>
                ) : <p className="text-xs text-gray-400">None found.</p>}
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Skills → reusable library</p>
                {chosen.skills.length ? (
                  <ul className="text-xs text-gray-700 space-y-0.5 max-h-32 overflow-y-auto">
                    {chosen.skills.slice(0, 20).map((x, i) => <li key={i}>• {x}</li>)}
                    {chosen.skills.length > 20 && <li className="text-gray-400">…and {chosen.skills.length - 20} more</li>}
                  </ul>
                ) : <p className="text-xs text-gray-400">None found.</p>}
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-3 mb-1.5">Knowledge objects</p>
                {chosen.knowledgeObjects.length ? (
                  <ul className="text-xs text-gray-700 space-y-0.5 max-h-32 overflow-y-auto">
                    {chosen.knowledgeObjects.map((k, i) => (
                      <li key={i}>🫀 {k.title} <span className="text-gray-400">({k.words.toLocaleString()} words)</span></li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-gray-400">None found.</p>}
              </div>
              {chosen.warnings.length > 0 && (
                <div className="md:col-span-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">Review before importing</p>
                  <ul className="text-[11px] text-amber-900 space-y-0.5">
                    {chosen.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 3 — target + commit */}
      {chosen && (
        <div className="bg-white rounded-xl border border-teal-100 p-5">
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-3">Step 3 · Choose where it lands</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">Practice (the CPU lives here)
              <select className={`${input} mt-1`} value={practiceId} onChange={e => setPracticeId(e.target.value)}>
                <option value="">Choose a practice…</option>
                {practices.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-500">Domain (competencies live here)
              <select className={`${input} mt-1`} value={domainId} onChange={e => setDomainId(e.target.value)}>
                <option value="">Choose a domain…</option>
                {domains.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
          </div>
          <button disabled={busy || !practiceId || !domainId} onClick={commit}
            className="mt-4 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50">
            {busy ? "Importing…" : `Import ${chosen.code ?? "CPU"} as a draft`}
          </button>
          <p className="text-[11px] text-gray-400 mt-2">
            Imports as a <b>draft</b> — nothing is published until you review it in the Studio and take it through approval.
          </p>
        </div>
      )}
    </div>
  );
}
