"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// CPR-IMP-001 -- the import screen. Choose a file, see exactly what would happen, then let it happen.
//
// ⚠ THE PREVIEW IS NOT A FORMALITY AND THE BUTTON ORDER SAYS SO: there is no commit without a preview
// of the same text. The server re-judges everything at commit anyway (one engine, two modes), so a
// stale preview can overstate but never sneak a write through.
//
// This file is client-safe: it imports ONLY import-columns.ts (imports-nothing by contract), never
// the engine -- patient-import.ts reaches node:crypto and the registration engines, and one client
// import of it would 500 the page with every check green. The template header is DERIVED from the
// same constant the server parses with, so the two cannot drift apart.

import { IMPORT_TEMPLATE_HEADER } from "@/lib/practice/import-columns";
import { formatDateTime } from "@/lib/datetime";

const CARD = "rounded-xl border border-gray-200 bg-white";

// ⚠ THE EXAMPLE ROWS MUST DEMONSTRATE THE CONVENTION THE HEADER STATES. They previously showed ISO
// dates (1988-03-14) while the import's declared convention -- printed in the header hint, on the screen
// and in every error message -- is day-first dd-mm-yyyy. Both parse, so nothing failed; but the one line
// a person copies the shape of was teaching a different format from the one the file asks for, and the
// day a month-first spreadsheet is pasted in that difference is a wrong date of birth.
// 14-03-1988 and 20-08-2026 both have a day above 12, so neither is ambiguous even read the other way.
const TEMPLATE_EXAMPLE =
  IMPORT_TEMPLATE_HEADER + "\n" +
  "Amina,,Okello,14-03-1988,,female,0772000001,,CM-1988-1234,,,,,Hypertension review,Main clinic,20-08-2026,09:30,scheduled_followup,ROW-001\n" +
  "Kato,,Ssebunya,,7,male,,,,Grace Ssebunya,mother,0772000002,,Well-child visit,,,,,ROW-002\n";

type PreviewRow = {
  rowNumber: number; name: string; verdict: string; problems: string[]; notes: string[];
  candidates?: { id: string; displayName: string }[];
};
type Preview = { fileProblems: string[]; rows: PreviewRow[]; counts: Record<string, number>; rowCount: number };
type CommitRow = { rowNumber: number; name: string; outcome: string; patientId: string | null; appointmentId: string | null; detail: string };
type Report = { runId: string; rows: CommitRow[]; registered: number; booked: number; skipped: number; errors: number };
type Run = {
  id: string; file_name: string | null; row_count: number; registered_count: number; booked_count: number;
  skipped_count: number; error_count: number; status: string; created_at: string;
};

const VERDICT_LABEL: Record<string, { text: string; cls: string }> = {
  register: { text: "Will register", cls: "bg-emerald-50 text-emerald-700" },
  register_and_book: { text: "Will register + book", cls: "bg-emerald-50 text-emerald-700" },
  skip_duplicate: { text: "Skip: duplicate", cls: "bg-amber-50 text-amber-700" },
  skip_already_imported: { text: "Skip: already imported", cls: "bg-amber-50 text-amber-700" },
  error: { text: "Will not import", cls: "bg-red-50 text-red-700" },
  REGISTERED: { text: "Registered", cls: "bg-emerald-50 text-emerald-700" },
  REGISTERED_AND_BOOKED: { text: "Registered + booked", cls: "bg-emerald-50 text-emerald-700" },
  SKIPPED_DUPLICATE: { text: "Skipped: duplicate", cls: "bg-amber-50 text-amber-700" },
  SKIPPED_ALREADY_IMPORTED: { text: "Skipped: already imported", cls: "bg-amber-50 text-amber-700" },
  ERROR: { text: "Not imported", cls: "bg-red-50 text-red-700" },
};

function Badge({ verdict }: { verdict: string }) {
  const v = VERDICT_LABEL[verdict] ?? { text: verdict, cls: "bg-gray-100 text-gray-600" };
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${v.cls}`}>{v.text}</span>;
}

export default function ImportClient() {
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [runsFailed, setRunsFailed] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The exact text the shown preview was computed from -- commit is only offered for THIS text. */
  const [previewedText, setPreviewedText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/v1/practice/patient-import")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (live) setRuns(d.runs ?? []); })
      .catch(() => { if (live) setRunsFailed(true); });
    return () => { live = false; };
  }, [report]);

  const onFile = (f: File | null) => {
    if (!f) return;
    setError(null); setPreview(null); setReport(null); setPreviewedText(null);
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.onerror = () => setError("the file could not be read by the browser");
    reader.readAsText(f);
  };

  const run = async (mode: "preview" | "commit") => {
    setBusy(mode); setError(null);
    try {
      const r = await fetch("/api/v1/practice/patient-import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, fileName, mode }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setError(d?.error?.message ?? d?.error ?? `the server refused (${r.status})`);
        if (mode === "commit") { setPreview(null); setPreviewedText(null); }
        return;
      }
      if (mode === "preview") { setPreview(d); setPreviewedText(csv); setReport(null); }
      else { setReport(d); setPreview(null); setPreviewedText(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_EXAMPLE], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "competen-patient-import-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const committable = preview !== null && previewedText === csv &&
    (preview.counts.register ?? 0) + (preview.counts.register_and_book ?? 0) > 0 &&
    preview.fileProblems.length === 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Import patients</h1>
          <p className="mt-1 text-[13px] text-gray-600">
            Move an existing patient list into this practice from a CSV file. Every row goes through the
            same checks as the New patient screen — duplicates are skipped and reported, never guessed at.
          </p>
        </div>
        <Link href="/practice/patients" className="text-[13px] font-semibold text-blue-700 hover:underline">
          ← Patients
        </Link>
      </div>

      {/* ── The file ── */}
      <section className={`${CARD} mt-5 p-4`}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">
            Choose CSV file
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => onFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" onClick={downloadTemplate}
            className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-50">
            Download the template
          </button>
          {fileName && <span className="text-[12.5px] text-gray-600">{fileName} — {csv.length.toLocaleString()} characters</span>}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-gray-500">
          Any one name column is enough; each row needs a date of birth or an estimated age, and a phone
          or email (a guardian&apos;s contact counts for a child). <strong>location</strong>,{" "}
          <strong>appointment_date</strong> and <strong>appointment_time</strong> are optional — if an
          appointment cannot be honoured, the patient is still registered and the report says why.{" "}
          <strong>external_id</strong> is your own row key from the old system: rows that carry one can
          never import twice.
        </p>
        <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-600">
          <strong>Date formats</strong> — <code>1988-03-14</code>, <code>14-03-1988</code> (or with
          slashes), <code>14 Mar 1988</code>. All-numeric dates are read <strong>day-first</strong>;
          where that could go two ways the check step shows exactly how each date was read, so look
          there before importing a file from a month-first system. Two-digit years are refused.{" "}
          <strong>Times</strong> — <code>14:30</code> or <code>2:30 pm</code>, in your practice&apos;s
          own clock.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!csv || busy !== null} onClick={() => run("preview")}
            className="rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
            {busy === "preview" ? "Checking…" : "Check the file"}
          </button>
          <button type="button" disabled={!committable || busy !== null} onClick={() => run("commit")}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
            title={committable ? undefined : "Check the file first — the import button unlocks when the check shows at least one importable row."}>
            {busy === "commit" ? "Importing…" : preview ? `Import ${(preview.counts.register ?? 0) + (preview.counts.register_and_book ?? 0)} patient(s)` : "Import"}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}
      </section>

      {/* ── Preview ── */}
      {preview && (
        <section className={`${CARD} mt-4 p-4`}>
          <h2 className="text-[14px] font-bold text-gray-900">
            What would happen — {preview.rowCount} row(s)
          </h2>
          {preview.fileProblems.length > 0 && (
            <div className="mt-2 rounded-lg bg-red-50 p-3 text-[12.5px] text-red-700">
              <p className="font-semibold">The file itself has problems, so nothing can be imported until they are fixed:</p>
              <ul className="mt-1 list-disc pl-5">{preview.fileProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
          )}
          <p className="mt-2 text-[12.5px] text-gray-600">
            {(preview.counts.register ?? 0) + (preview.counts.register_and_book ?? 0)} will register
            ({preview.counts.register_and_book ?? 0} with an appointment attempt),{" "}
            {(preview.counts.skip_duplicate ?? 0) + (preview.counts.skip_already_imported ?? 0)} will be
            skipped, {preview.counts.error ?? 0} cannot import as written.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1.5 pr-3">Row</th><th className="py-1.5 pr-3">Name</th>
                <th className="py-1.5 pr-3">Verdict</th><th className="py-1.5">Why / notes</th>
              </tr></thead>
              <tbody>
                {preview.rows.map(r => (
                  <tr key={r.rowNumber} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-3 text-gray-500">{r.rowNumber}</td>
                    <td className="py-1.5 pr-3 font-medium text-gray-800">{r.name}</td>
                    <td className="py-1.5 pr-3"><Badge verdict={r.verdict} /></td>
                    <td className="py-1.5 text-gray-600">
                      {[...r.problems, ...r.notes].map((n, i) => <p key={i}>{n}</p>)}
                      {r.candidates && r.candidates.length > 0 && (
                        <p>Matches: {r.candidates.map(c => c.displayName).join(", ")}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Report ── */}
      {report && (
        <section className={`${CARD} mt-4 p-4`}>
          <h2 className="text-[14px] font-bold text-gray-900">Import complete</h2>
          <p className="mt-1 text-[12.5px] text-gray-600">
            {report.registered} registered ({report.booked} with an appointment), {report.skipped} skipped,{" "}
            {report.errors} not imported. This report is kept — every row&apos;s outcome is on the run ledger below.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1.5 pr-3">Row</th><th className="py-1.5 pr-3">Name</th>
                <th className="py-1.5 pr-3">Outcome</th><th className="py-1.5">Detail</th>
              </tr></thead>
              <tbody>
                {report.rows.map(r => (
                  <tr key={r.rowNumber} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-3 text-gray-500">{r.rowNumber}</td>
                    <td className="py-1.5 pr-3 font-medium text-gray-800">
                      {r.patientId ? <Link className="text-blue-700 hover:underline" href={`/practice/patients/${r.patientId}`}>{r.name}</Link> : r.name}
                    </td>
                    <td className="py-1.5 pr-3"><Badge verdict={r.outcome} /></td>
                    <td className="py-1.5 text-gray-600">{r.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Past runs ── */}
      <section className={`${CARD} mt-4 p-4`}>
        <h2 className="text-[14px] font-bold text-gray-900">Past imports</h2>
        {runsFailed ? (
          <p className="mt-2 text-[12.5px] text-gray-500">The run ledger could not be read just now. This says nothing about whether imports exist.</p>
        ) : runs === null ? (
          <p className="mt-2 text-[12.5px] text-gray-400">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-gray-500">No imports yet. Each import is recorded here with its per-row outcomes.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1.5 pr-3">When</th><th className="py-1.5 pr-3">File</th>
                <th className="py-1.5 pr-3">Rows</th><th className="py-1.5 pr-3">Registered</th>
                <th className="py-1.5 pr-3">Booked</th><th className="py-1.5 pr-3">Skipped</th>
                <th className="py-1.5">Errors</th>
              </tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-600">{formatDateTime(r.created_at)}</td>
                    <td className="py-1.5 pr-3 text-gray-800">{r.file_name ?? "—"}</td>
                    <td className="py-1.5 pr-3">{r.row_count}</td>
                    <td className="py-1.5 pr-3">{r.registered_count}</td>
                    <td className="py-1.5 pr-3">{r.booked_count}</td>
                    <td className="py-1.5 pr-3">{r.skipped_count}</td>
                    <td className="py-1.5">{r.error_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
