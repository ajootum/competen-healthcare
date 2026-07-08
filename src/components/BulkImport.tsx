"use client";
import { useRef, useState } from "react";
import type { ImportResult } from "@/app/api/import/route";

type Hospital = { id: string; name: string; country: string };

const ORG_ROLES = [
  "chief_officer","org_admin","manager",
  "educator","charge_nurse","shift_supervisor","leader","healthcare_worker",
];

const COLUMNS = ["#","first_name","middle_name","last_name","email","hospital","org_role"] as const;

function downloadTemplate(hospitals: Hospital[]) {
  const exampleHospital = hospitals[0]?.name ?? "Your Facility Name";
  const rows = [
    COLUMNS.join(","),
    `1,Jane,,Doe,jane.doe@facility.org,${exampleHospital},healthcare_worker`,
    `2,John,Michael,Smith,john.smith@facility.org,${exampleHospital},charge_nurse`,
    `3,Mary,,Educator,mary@facility.org,${exampleHospital},educator`,
  ].join("\n");
  const blob = new Blob([rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "competen_bulk_import.csv";
  a.click();
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"' && !inQ) { inQ = true; continue; }
    if (ch === '"' && inQ)  { inQ = false; continue; }
    if (ch === "," && !inQ) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

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

type PreviewRow = {
  seq: number;
  first_name: string;
  middle_name: string;
  last_name: string;
  email: string;
  hospital: string;
  org_role: string;
  _valid: boolean;
  _errors: string[];
};

export default function BulkImport({
  hospitals,
  lockedHospital,
}: {
  hospitals: Hospital[];
  lockedHospital?: { id: string; name: string }; // educator — single facility only
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [filename, setFilename] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [parseError, setParseError] = useState("");

  const hospitalNames = new Set(hospitals.map(h => h.name.toLowerCase()));

  function validateRow(row: Record<string, string>, seq: number): PreviewRow {
    const errors: string[] = [];
    const fn = row.first_name?.trim() ?? "";
    const mn = row.middle_name?.trim() ?? "";
    const ln = row.last_name?.trim() ?? "";
    const email = row.email?.trim() ?? "";
    const hospital = lockedHospital ? lockedHospital.name : (row.hospital?.trim() ?? "");
    const orgRole = row.org_role?.trim() ?? "";

    if (!fn) errors.push("first_name required");
    if (!ln) errors.push("last_name required");
    if (!email) errors.push("email required");
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("invalid email");
    if (!hospital) errors.push("hospital required");
    else if (!hospitalNames.has(hospital.toLowerCase())) errors.push(`hospital not found: "${hospital}"`);
    if (orgRole && !ORG_ROLES.includes(orgRole.toLowerCase())) errors.push(`unknown org_role: "${orgRole}"`);

    return { seq, first_name: fn, middle_name: mn, last_name: ln, email, hospital, org_role: orgRole, _valid: errors.length === 0, _errors: errors };
  }

  function handleFile(file: File) {
    setParseError(""); setResults(null); setFilename(file.name);
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      try {
        const rows = parseCSV(text);
        if (!rows.length) { setParseError("No data rows found. Check that the file has a header row and at least one data row."); return; }
        const hasEmail = "email" in rows[0];
        if (!hasEmail) { setParseError('Column "email" is required. Check that your first row is the header row.'); return; }
        setPreview(rows.map((r, i) => validateRow(r, i + 1)));
      } catch {
        setParseError("Could not parse the file. Please use a CSV (.csv) file.");
      }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!preview) return;
    const valid = preview.filter(r => r._valid);
    if (!valid.length) return;
    setImporting(true);
    const payload = valid.map(r => ({
      first_name: r.first_name,
      middle_name: r.middle_name || undefined,
      last_name: r.last_name,
      email: r.email,
      hospital: lockedHospital ? lockedHospital.name : r.hospital,
      org_role: r.org_role || undefined,
    }));
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    setImporting(false);
    if (!res.ok) { setParseError((await res.json()).error ?? "Import failed"); return; }
    const { results: r } = await res.json();
    setResults(r);
    setPreview(null);
  }

  function reset() {
    setPreview(null); setResults(null); setFilename("");
    setParseError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const validCount = preview?.filter(r => r._valid).length ?? 0;
  const errorCount = preview?.filter(r => !r._valid).length ?? 0;
  const resultCounts = results ? {
    updated:   results.filter(r => r.status === "updated").length,
    not_found: results.filter(r => r.status === "not_found").length,
    error:     results.filter(r => r.status === "error").length,
  } : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <p className="text-sm font-semibold text-blue-900 mb-3">How bulk import works</p>
        <ol className="flex flex-col gap-2 text-sm text-blue-800 mb-4">
          <li className="flex gap-2"><span className="font-bold shrink-0">1.</span>Download the template and fill in your data — one row per user</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">2.</span>The user must already have a Competen account (matched by email)</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">3.</span>Leave <code className="bg-blue-100 px-1 rounded">middle_name</code> or <code className="bg-blue-100 px-1 rounded">org_role</code> blank to leave those fields unchanged</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">4.</span><code className="bg-blue-100 px-1 rounded">first_name</code>, <code className="bg-blue-100 px-1 rounded">last_name</code>, <code className="bg-blue-100 px-1 rounded">email</code> and <code className="bg-blue-100 px-1 rounded">hospital</code> are required on every row</li>
          <li className="flex gap-2"><span className="font-bold shrink-0">5.</span>Upload → review the preview → confirm</li>
        </ol>
        <div className="flex items-start gap-4 flex-wrap">
          <button onClick={() => downloadTemplate(hospitals)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white text-sm rounded-lg hover:bg-blue-800 font-medium">
            Download Template CSV
          </button>
          <div className="text-xs text-blue-700 bg-blue-100 rounded-lg px-3 py-2 font-mono">
            <span className="font-semibold"># · first_name · middle_name · last_name · email · hospital · org_role</span>
          </div>
        </div>
      </div>

      {/* Org roles reference */}
      <details className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50 list-none flex items-center justify-between">
          <span>Valid org_role values</span>
          <span className="text-gray-400 text-xs">Click to expand</span>
        </summary>
        <div className="px-5 pb-4 pt-2 flex flex-wrap gap-2">
          {ORG_ROLES.map(r => (
            <code key={r} className="text-xs bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-lg text-gray-700">{r}</code>
          ))}
        </div>
      </details>

      {/* Available hospitals */}
      {!lockedHospital && (
        <details className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50 list-none flex items-center justify-between">
            <span>Available facilities ({hospitals.length})</span>
            <span className="text-gray-400 text-xs">Click to expand — use exact name in the CSV</span>
          </summary>
          <div className="px-5 pb-4 pt-2 flex flex-wrap gap-2">
            {hospitals.map(h => (
              <span key={h.id} className="text-xs bg-gray-50 border border-gray-100 px-2.5 py-1 rounded-lg text-gray-600">
                {h.name} <span className="text-gray-400">({h.country})</span>
              </span>
            ))}
            {!hospitals.length && <p className="text-xs text-gray-400">No facilities found.</p>}
          </div>
        </details>
      )}

      {/* Locked facility notice */}
      {lockedHospital && (
        <div className="bg-teal-50 border border-teal-100 rounded-xl px-5 py-3 flex items-center gap-3">
          <span className="text-lg">🏥</span>
          <div>
            <p className="text-sm font-semibold text-teal-800">Importing to: {lockedHospital.name}</p>
            <p className="text-xs text-teal-600">All rows will be assigned to your facility. The hospital column in the CSV is optional and will be ignored.</p>
          </div>
        </div>
      )}

      {/* Upload area */}
      {!preview && !results && (
        <div
          className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center bg-white hover:border-teal-400 hover:bg-teal-50/20 transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
          <p className="text-3xl mb-3">📄</p>
          <p className="text-sm font-semibold text-gray-700 mb-1">Drop your CSV file here, or click to browse</p>
          <p className="text-xs text-gray-400">Supports .csv files · Excel: save as CSV first</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {parseError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">{parseError}</div>
      )}

      {/* Preview table */}
      {preview && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
            <div>
              <p className="font-semibold text-gray-900 text-sm">Preview — {filename}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {validCount} row{validCount !== 1 ? "s" : ""} ready
                {errorCount > 0 && <span className="text-red-500 ml-2">· {errorCount} row{errorCount !== 1 ? "s" : ""} with errors (will be skipped)</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={reset} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={runImport} disabled={importing || validCount === 0}
                className="px-4 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
                {importing ? "Importing…" : `Confirm & Import ${validCount} user${validCount !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {["#","First Name","Middle Name","Last Name","Email","Hospital","Org Role","Status"].map(h => (
                    <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {preview.map(row => (
                  <tr key={row.seq} className={row._valid ? "hover:bg-gray-50/30" : "bg-red-50/40"}>
                    <td className="px-3 py-2.5 text-gray-400 font-mono">{row.seq}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{row.first_name || <span className="text-red-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-gray-500">{row.middle_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{row.last_name || <span className="text-red-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-gray-600">{row.email}</td>
                    <td className="px-3 py-2.5 text-gray-600">{row.hospital || <span className="text-red-400">—</span>}</td>
                    <td className="px-3 py-2.5">
                      {row.org_role
                        ? <code className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">{row.org_role}</code>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
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
            {[
              { label: "Updated",   count: resultCounts.updated,   cls: "bg-teal-50 border-teal-100 text-teal-700" },
              { label: "Not found", count: resultCounts.not_found, cls: "bg-amber-50 border-amber-100 text-amber-700" },
              { label: "Errors",    count: resultCounts.error,     cls: "bg-red-50 border-red-100 text-red-700" },
            ].map(({ label, count, cls }) => (
              <div key={label} className={`border rounded-xl p-4 text-center ${cls}`}>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs font-medium mt-1">{label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-sm">Import Results</p>
              <button onClick={reset} className="px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
                Import Another File
              </button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {["#","Name","Email","Status","Details"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {results.map(r => (
                  <tr key={r.seq} className={r.status === "updated" ? "" : "bg-amber-50/30"}>
                    <td className="px-4 py-2.5 text-gray-400 font-mono">{r.seq}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.name || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.email}</td>
                    <td className="px-4 py-2.5">
                      {r.status === "updated"   && <span className="text-teal-600 font-semibold">Updated</span>}
                      {r.status === "not_found" && <span className="text-amber-600 font-semibold">Not found</span>}
                      {r.status === "error"     && <span className="text-red-500 font-semibold">Error</span>}
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
