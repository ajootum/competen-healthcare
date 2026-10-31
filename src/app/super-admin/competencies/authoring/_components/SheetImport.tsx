"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canConfirm, formatSheetError, previewSummary, type SheetPreview } from "@/lib/competency/diff-format";
import { Msg, ui } from "./AuthoringControls";

// FRAMEWORK-DESIGN-STUDIO-02 S2 (capability 5): "Add competencies from a spreadsheet" into this DRAFT framework.
// Download the template, upload the CSV, read the preview (adds, unchanged, row errors), then confirm. Both steps post to
// /api/hq/competency/authoring/sheet (the preview is dryRun, the confirmation writes in append mode and records authorship
// like any import). Nothing existing is changed, and nothing is reviewed, approved or published.

const SHEET = "/api/hq/competency/authoring/sheet";
const MAX_BYTES = 2_000_000;

export default function SheetImport({ frameworkCode, componentLabels }: { frameworkCode: string; componentLabels: Record<string, string> }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(dryRun: boolean) {
    if (csv === null) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(SHEET, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv, frameworkCode, dryRun }) });
      const j = await res.json().catch(() => ({}));
      if (dryRun) {
        if (res.ok && j?.adds) setPreview(j as SheetPreview);
        else { setPreview(null); setMsg({ ok: false, text: j?.error ?? "The sheet could not be checked. Nothing has changed." }); }
        return;
      }
      if (res.ok) {
        setMsg({ ok: true, text: `Added ${j.competencies ?? 0} competencies and ${j.criteria ?? 0} criteria to the draft. They are not clinically reviewed.` });
        setPreview(null); setCsv(null); setFileName(""); if (input.current) input.current.value = "";
        router.refresh();
      } else {
        if (Array.isArray(j?.errors)) setPreview(p => (p ? { ...p, errors: j.errors } : p));
        setMsg({ ok: false, text: j?.error ?? "The sheet was not imported. Nothing has changed." });
      }
    } catch { setMsg({ ok: false, text: "The sheet could not be sent. Check your connection. Nothing has changed." }); } finally { setBusy(false); }
  }

  async function pick(file: File | undefined) {
    setPreview(null); setMsg(null); setCsv(null); setFileName("");
    if (!file) return;
    if (file.size > MAX_BYTES) { setMsg({ ok: false, text: "That file is larger than 2 MB. Split it into smaller sheets." }); return; }
    setFileName(file.name); setCsv(await file.text());
  }

  const labelOf = (code: string) => componentLabels[code] ?? code;
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-gray-600">Adds new competencies and their criteria to this draft, one row per criterion. Competencies already in the draft are never changed. Save the sheet as CSV.</p>
      <div className="flex flex-wrap items-center gap-2">
        <a href={SHEET} download className={ui.ghost}>Download the template</a>
        <label className={`${ui.ghost} cursor-pointer`}>
          Choose a CSV file
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={e => void pick(e.target.files?.[0])} />
        </label>
        {fileName && <span className="break-all text-[12.5px] text-gray-700">{fileName}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ui.primary} disabled={busy || csv === null} onClick={() => void post(true)}>Check the sheet</button>
      </div>

      {preview && (
        <div className="space-y-3 rounded-xl border border-gray-200 p-3" aria-live="polite">
          <p className={`text-[13.5px] font-semibold ${preview.errors.length ? "text-red-700" : "text-gray-900"}`}>{previewSummary(preview)}</p>
          {preview.errors.length > 0 && (
            <ul role="alert" className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-[12.5px] text-red-700">
              {preview.errors.map((e, i) => <li key={i}>{formatSheetError(e)}</li>)}
            </ul>
          )}
          {preview.adds.competencies.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-[12.5px]">
                <caption className="sr-only">Competencies the sheet would add</caption>
                <thead><tr className="border-b border-gray-200 text-gray-500"><th scope="col" className="py-1.5 pr-2 font-semibold">Row</th><th scope="col" className="py-1.5 pr-2 font-semibold">Competency</th><th scope="col" className="py-1.5 pr-2 font-semibold">Domain</th><th scope="col" className="py-1.5 font-semibold">Criteria</th></tr></thead>
                <tbody>
                  {preview.adds.competencies.map(c => (
                    <tr key={`${c.row}-${c.code}`} className="border-b border-gray-100 align-top">
                      <td className="py-1.5 pr-2 text-gray-600">{c.row}</td>
                      <td className="py-1.5 pr-2 text-gray-900"><span className="font-mono text-[11.5px] text-gray-600">{c.code}</span> {c.name}</td>
                      <td className="py-1.5 pr-2 text-gray-900">{c.domain}{c.newDomain ? <span className="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-900">new</span> : null}</td>
                      <td className="py-1.5 text-gray-700">{Object.entries(c.criteria).map(([k, n]) => `${labelOf(k)} ${n}`).join(", ") || "none"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.adds.criteria.total > 0 && (
            <p className="text-[12.5px] text-gray-700">Criteria by section: {Object.entries(preview.adds.criteria.byComponent).map(([k, n]) => `${labelOf(k)} ${n}`).join(", ")}.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ui.primary} disabled={busy || !canConfirm(preview)} onClick={() => void post(false)}>Confirm import</button>
            <span className="text-[12px] text-gray-600">Added as a draft, not clinically reviewed.</span>
          </div>
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}
