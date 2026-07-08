"use client";
import { useRef, useState } from "react";
import type { ImportRow, ImportResult } from "@/app/api/super-admin/import/route";

type Hospital = { id: string; name: string; country: string };

const TEMPLATE_HEADERS = ["email", "full_name", "hospital", "org_role"] as const;
const VALID_ROLES = ["nurse", "assessor", "educator", "hospital_admin", "super_admin"];
const VALID_ORG_ROLES = [
  "chief_officer","org_admin","manager",
  "educator","charge_nurse","shift_supervisor","leader","healthcare_worker",
];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));
  return lines.slice(1).map(line => {
    const cells = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim().replace(/^["']|["']$/g, ""); });
    return row;
  });
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQ) { inQ = true; continue; }
    if (ch === '"' && inQ) { inQ = false; continue; }
    if (ch === "," && !inQ) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function downloadTemplate() {
  const rows = [
    TEMPLATE_HEADERS.join(","),
    "jane.doe@hospital.org,Jane Doe,Aga Khan Hospital Nairobi,charge_nurse",
    "john.smith@hospital.org,John Smith,Kenyatta National Hospital,shift_supervisor",
    "mary.educator@clinic.org,,City Clinic,educator",
    "ceo@org.com,CEO Name,,chief_officer",
  ].join("\n");
  const blob = new Blob([rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "competen_bulk_import_template.csv";
  a.click();
}

type PreviewRow = ImportRow & { _valid: boolean; _errors: string[] };

export default function BulkImport({ hospitals }: { hospitals: Hospital[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [filename, setFilename] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [parseError, setParseError] = useState("");

  const hospitalNames = new Set(hospitals.map(h => h.name.toLowerCase()));

  function validateRow(row: Record<string, string>): PreviewRow {
    const errors: string[] = [];
    if (!row.email) errors.push("email required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("invalid email");
    if (row.role && !VALID_ROLES.includes(row.role.toLowerCase())) errors.push(`unknown role "${row.role}"`);
    if (row.org_role && !VALID_ORG_ROLES.includes(row.org_role.toLowerCase())) errors.push(`unknown org_role "${row.org_role}"`);
    if (row.hospital && !hospitalNames.has(row.hospital.toLowerCase())) errors.push(`hospital not found "${row.hospital}"`);
    return {
      email: row.email ?? "",
      full_name: row.full_name || undefined,
      hospital: row.hospital || undefined,
      role: row.role || undefined,
      org_role: row.org_role || undefined,
      _valid: errors.length === 0,
      _errors: errors,
    };
  }

  function handleFile(file: File) {
    setParseError("");
    setResults(null);
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      try {
        const rows = parseCSV(text);
        if (!rows.length) { setParseError("No data rows found. Make sure the file has a header row and at least one data row."); return; }
        const hasEmail = rows[0].hasOwnProperty("email");
        if (!hasEmail) { setParseError('Column "email" is required. Check that your first row is the header row.'); return; }
        setPreview(rows.map(validateRow));
      } catch {
        setParseError("Could not parse the file. Please use a CSV file (.csv).");
      }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!preview) return;
    const valid = preview.filter(r => r._valid);
    if (!valid.length) return;
    setImporting(true);
    const rows: ImportRow[] = valid.map(({ email, full_name, hospital, role, org_role }) => ({
      email, full_name, hospital, role, org_role,
    }));
    const res = await fetch("/api/super-admin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    setImporting(false);
    if (!res.ok) { setParseError((await res.json()).error ?? "Import failed"); return; }
    const { results: r } = await res.json();
    setResults(r);
    setPreview(null);
  }

  const validCount = preview?.filter(r => r._valid).length ?? 0;
  const errorCount = preview?.filter(r => !r._valid).length ?? 0;

  const resultCounts = results
    ? {
        updated: results.filter(r => r.status === "updated").length,
        not_found: results.filter(r => r.status === "not_found").length,
        error: results.filter(r => r.status === "error").length,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Instructions + template */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <p className="text-sm font-semibold text-blue-900 mb-3">How bulk import works</p>
        <ol className="flex flex-col gap-2 text-sm text-blue-800 mb-4">
          <li className="flex gap-2"><span className="font-bold shrink-0">1.</span>Download the template and fill in your data</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">2.</span>Each row = one user, matched by their email address</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">3.</span>The user must already have an account — import updates existing users, it does not create new ones</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">4.</span>Leave a cell blank to leave that field unchanged</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">5.</span>Upload, review the preview, then confirm</li>
        </ol>
        <div className="flex items-start gap-4 flex-wrap">
          <button onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 font-medium">
            Download Template CSV
          </button>
          <div className="text-xs text-blue-700 bg-blue-100 rounded-lg px-3 py-2 font-mono leading-relaxed">
            <span className="font-semibold">Columns:</span> email · full_name · hospital · org_role
          </div>
        </div>
      </div>

      {/* Hospitals reference */}
      <details className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50 list-none flex items-center justify-between">
          <span>Available facility names ({hospitals.length})</span>
          <span className="text-gray-400 text-xs">Click to expand</span>
        </summary>
        <div className="px-5 pb-4 pt-2 flex flex-wrap gap-2">
          {hospitals.map(h => (
            <span key={h.id} className="text-xs bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-lg text-gray-600">
              {h.name} <span className="text-gray-400">({h.country})</span>
            </span>
          ))}
          {!hospitals.length && <p className="text-xs text-gray-400">No facilities yet — add them under Organisations first.</p>}
        </div>
      </details>

      {/* Upload area */}
      {!preview && !results && (
        <div
          className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center bg-white hover:border-teal-400 hover:bg-teal-50/20 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <p className="text-3xl mb-3">📄</p>
          <p className="text-sm font-semibold text-gray-700 mb-1">Drop your CSV file here, or click to browse</p>
          <p className="text-xs text-gray-400">Supports .csv files · Excel: save as CSV before uploading</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {parseError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {parseError}
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <p className="font-semibold text-gray-900 text-sm">Preview — {filename}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {validCount} valid row{validCount !== 1 ? "s" : ""} will be updated
                {errorCount > 0 && <span className="text-red-500 ml-2">· {errorCount} row{errorCount !== 1 ? "s" : ""} with errors (skipped)</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setPreview(null); setFilename(""); if (fileRef.current) fileRef.current.value = ""; }}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={runImport} disabled={importing || validCount === 0}
                className="px-4 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {importing ? "Importing…" : `Confirm & Import ${validCount} users`}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">#</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Email</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Hospital / Facility</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Sub-Role</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {preview.map((row, i) => (
                  <tr key={i} className={row._valid ? "hover:bg-gray-50/30" : "bg-red-50/40"}>
                    <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{row.email}</td>
                    <td className="px-4 py-2.5 text-gray-600">{row.full_name ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-gray-600">{row.hospital ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5">
                      {row.role
                        ? <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 font-semibold">{row.role}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{row.org_role ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5">
                      {row._valid
                        ? <span className="text-teal-600 font-medium">Ready</span>
                        : <span className="text-red-500">{row._errors.join("; ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Results */}
      {results && resultCounts && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-teal-700">{resultCounts.updated}</p>
              <p className="text-xs text-teal-600 font-medium mt-1">Updated</p>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{resultCounts.not_found}</p>
              <p className="text-xs text-amber-600 font-medium mt-1">Not found</p>
            </div>
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-red-700">{resultCounts.error}</p>
              <p className="text-xs text-red-600 font-medium mt-1">Errors</p>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-sm">Import Results</p>
              <button onClick={() => { setResults(null); setFilename(""); if (fileRef.current) fileRef.current.value = ""; }}
                className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
                Import Another File
              </button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Email</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {results.map((r, i) => (
                  <tr key={i} className={r.status === "updated" ? "" : "bg-amber-50/30"}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.email}</td>
                    <td className="px-4 py-2.5">
                      {r.status === "updated" && <span className="text-teal-600 font-semibold">Updated</span>}
                      {r.status === "not_found" && <span className="text-amber-600 font-semibold">Not found</span>}
                      {r.status === "error" && <span className="text-red-500 font-semibold">Error</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
