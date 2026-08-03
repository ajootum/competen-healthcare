"use client";

import { useState } from "react";
import { TEMPLATE_KINDS } from "@/lib/practice/document-constants";

// CPR-330 QUICK CREATE -- the comp's 3x3 grid, made of the document kinds this product actually has.
//
// Six kinds, plus Use a template, plus Bulk generation, plus the AI tile that stays disabled because
// CPR-210 is not built. Nine tiles, one of which says so.
//
// THE UNRESOLVED-FIELD REFUSAL IS THE POINT OF THIS SCREEN. Generation stops when a merge field cannot
// be filled and names the fields; "Generate anyway" produces the draft with visible [[markers]] to fill
// by hand. Neither path can produce a letter with a silent hole in it.

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";

type Template = { id: string; title: string; kind: string; mergeable: boolean };
type Patient = { id: string; displayName?: string; display_name?: string };

const DOC_KINDS = TEMPLATE_KINDS.filter(([k]) => k !== "encounter_note");

export default function GenerateConsole({ templates, canAuthor, canFindPatients }: {
  templates: Template[]; canAuthor: boolean; canFindPatients: boolean;
}) {
  const [mode, setMode] = useState<"single" | "bulk" | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [picked, setPicked] = useState<Patient[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err" | "gap"; text: string } | null>(null);

  // Only templates with a body can be generated from: the section-based ones fill a consultation's SOAP
  // segments and have nothing to merge into.
  const usable = templates.filter(t => t.mergeable && t.kind !== "encounter_note");
  const shown = kind ? usable.filter(t => t.kind === kind) : usable;

  function open(nextMode: "single" | "bulk", nextKind: string | null) {
    setMode(nextMode); setKind(nextKind); setNotice(null); setPicked([]); setResults([]); setQuery("");
    const only = nextKind ? usable.filter(t => t.kind === nextKind) : usable;
    setTemplateId(only.length === 1 ? only[0].id : "");
  }

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const res = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({}));
    setResults(res.ok ? ((data.results ?? []) as Patient[]).slice(0, 6) : []);
  }

  const nameOf = (p: Patient) => p.displayName ?? p.display_name ?? "Unnamed";

  async function generate(allowUnresolved: boolean) {
    if (!templateId || picked.length === 0) return;
    setBusy(true); setNotice(null);

    if (mode === "bulk") {
      const res = await fetch("/api/v1/practice/documents/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, patientIds: picked.map(p => p.id), allowUnresolved }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." }); return; }
      const b = data.batch;
      // BOTH NUMBERS, ALWAYS. A run that produced 38 of 40 must not report as "done".
      setNotice({
        kind: b.failed > 0 ? "gap" : "ok",
        text: b.failed > 0
          ? `${b.generated} generated, ${b.failed} could not be. The ones that failed are not in the record; try them singly to see why.`
          : `${b.generated} generated.`,
      });
      return;
    }

    const res = await fetch("/api/v1/practice/documents/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, patientId: picked[0].id, allowUnresolved }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNotice({
        kind: data?.error?.code === "UNRESOLVED_FIELDS" ? "gap" : "err",
        text: data?.error?.message ?? "That did not work.",
      });
      return;
    }
    window.location.href = `/practice/documents/${data.document.id}`;
  }

  const tile = "flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-3 text-[11px] font-semibold text-gray-700 hover:border-[var(--cp-primary)] hover:bg-gray-50";

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Quick create</h2>

      {!canAuthor && (
        <p className="mt-1 text-[11px] text-gray-500">
          You can read reports but not author documents, so these are shown and not enabled.
        </p>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2">
        {DOC_KINDS.map(([k, label]) => (
          <button key={k} type="button" disabled={!canAuthor} onClick={() => open("single", k)}
            className={`${tile} ${!canAuthor ? "opacity-40 cursor-not-allowed" : ""}`}>
            <span className="text-center leading-tight">{label.replace(/ \(.*\)/, "")}</span>
            <span className="text-[9px] font-normal text-gray-400">
              {usable.filter(t => t.kind === k).length} ready
            </span>
          </button>
        ))}
        <button type="button" disabled={!canAuthor} onClick={() => open("single", null)}
          className={`${tile} ${!canAuthor ? "opacity-40 cursor-not-allowed" : ""}`}>
          <span>Any template</span>
          <span className="text-[9px] font-normal text-gray-400">{usable.length} ready</span>
        </button>
        <button type="button" disabled={!canAuthor} onClick={() => open("bulk", null)}
          className={`${tile} ${!canAuthor ? "opacity-40 cursor-not-allowed" : ""}`}>
          <span>Bulk generation</span>
          <span className="text-[9px] font-normal text-gray-400">up to 200</span>
        </button>
        {/* The comp's ninth tile. Disabled and labelled rather than removed -- see the page header. */}
        <span className={`${tile} cursor-not-allowed border-dashed text-gray-400`} title="CPR-210 is not built">
          <span>AI draft</span>
          <span className="text-[9px] font-normal">not built</span>
        </span>
      </div>

      {usable.length === 0 && canAuthor && (
        <p className="mt-2 text-[11px] text-gray-500">
          No template has a body to merge into yet. Add one under Templates &mdash; a template with only
          section headings fills a consultation note, not a letter.
        </p>
      )}

      {mode && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {notice && (
            <p className={`mb-2 rounded-lg px-2.5 py-2 text-[11px] ${
              notice.kind === "ok" ? "bg-emerald-50 text-emerald-800"
                : notice.kind === "gap" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-800"}`}>
              {notice.text}
            </p>
          )}

          <label className="block text-[11px] font-semibold text-gray-600">Template</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={`${input} mt-1`}>
            <option value="">Choose a template</option>
            {shown.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>

          <label className="mt-2 block text-[11px] font-semibold text-gray-600">
            {mode === "bulk" ? "Patients" : "Patient"}
          </label>
          {!canFindPatients ? (
            <p className="mt-1 text-[11px] text-gray-500">
              Finding a patient needs patient access, which you do not hold.
            </p>
          ) : (
            <input value={query} onChange={e => search(e.target.value)} placeholder="Search by name or identifier"
              className={`${input} mt-1`} />
          )}

          {results.length > 0 && (
            <ul className="mt-1 flex flex-col rounded-lg border border-gray-200">
              {results.map(p => (
                <li key={p.id}>
                  <button type="button" className="w-full px-2.5 py-1.5 text-left text-[12px] hover:bg-gray-50"
                    onClick={() => {
                      setPicked(prev => mode === "bulk"
                        ? (prev.some(x => x.id === p.id) ? prev : [...prev, p]) : [p]);
                      setResults([]); setQuery("");
                    }}>
                    {nameOf(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picked.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {picked.map(p => (
                <button key={p.id} type="button" onClick={() => setPicked(prev => prev.filter(x => x.id !== p.id))}
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-200">
                  {nameOf(p)} &times;
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button type="button" disabled={busy || !templateId || picked.length === 0} onClick={() => generate(false)}
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
              {busy ? "Generating..." : mode === "bulk" ? `Generate ${picked.length}` : "Generate"}
            </button>
            {notice?.kind === "gap" && (
              <button type="button" disabled={busy} onClick={() => generate(true)}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-50">
                Generate anyway
              </button>
            )}
            <button type="button" onClick={() => setMode(null)}
              className="text-[12px] text-gray-500 hover:underline">Cancel</button>
          </div>

          <p className="mt-2 text-[10px] text-gray-500">
            A generated document arrives as a DRAFT. It is not signed, not issued, and nothing has been
            sent &mdash; this product has no sending channel.
          </p>
        </div>
      )}
    </section>
  );
}
