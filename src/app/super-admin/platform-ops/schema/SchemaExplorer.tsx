"use client";
import { useState } from "react";

// Schema & Object Model explorer (NCP-016) — browse the canonical contract for each object type (registry
// envelope + per-type definition shape, with required flags + enum vocabularies) and validate a candidate
// definition against it live via POST /api/config/schema.
type FieldSpec = { key: string; label: string; type: string; required?: boolean; enum?: string[]; of?: string; keyed?: boolean; note?: string };
type ObjectSchema = { type: string; title: string; icon: string; envelope: FieldSpec[]; definition: FieldSpec[]; note?: string };
type Issue = { path: string; severity: "error" | "warning"; message: string };

const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";

function FieldTable({ fields }: { fields: FieldSpec[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="text-gray-500 text-left"><th className="font-medium py-1 pr-3">Field</th><th className="font-medium py-1 pr-3">Type</th><th className="font-medium py-1 pr-3">Req</th><th className="font-medium py-1">Notes</th></tr></thead>
        <tbody>
          {fields.map(f => (
            <tr key={f.key} className="border-t border-gray-100 align-top">
              <td className="py-1 pr-3"><span className="font-mono text-gray-700">{f.key}</span><span className="text-gray-500 block text-[10px]">{f.label}</span></td>
              <td className="py-1 pr-3"><span className="text-indigo-600">{f.type}{f.of ? `<${f.of}>` : ""}</span>{f.keyed && <span className="text-[9px] text-gray-500 block">keyed</span>}</td>
              <td className="py-1 pr-3">{f.required ? <span className="text-[var(--cmp-text-error)]">●</span> : <span className="text-gray-500">○</span>}</td>
              <td className="py-1 text-gray-500">{f.enum ? <span className="text-[10px] font-mono text-gray-500">{f.enum.join(" · ")}</span> : (f.note ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SchemaExplorer({ schemas, counts }: { schemas: ObjectSchema[]; counts: Record<string, number> }) {
  const [sel, setSel] = useState(schemas[0]?.type ?? "");
  const s = schemas.find(x => x.type === sel) ?? schemas[0];
  const [json, setJson] = useState("{\n  \n}");
  const [res, setRes] = useState<{ ok: boolean; errors: number; warnings: number; issues: Issue[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function validate() {
    setBusy(true); setRes(null);
    const r = await fetch("/api/config/schema", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_type: sel, definition: json }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) setRes(j); else setRes({ ok: false, errors: 1, warnings: 0, issues: [{ path: "definition", severity: "error", message: j?.error || "Validation failed" }] });
  }

  const card = "bg-white rounded-xl border border-gray-200";
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Object types ({schemas.length})</p>
        <div className="space-y-1">
          {schemas.map(x => (
            <button key={x.type} onClick={() => { setSel(x.type); setRes(null); }} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors flex items-center gap-2 ${sel === x.type ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}>
              <span className="text-sm">{x.icon}</span>
              <span className="flex-1 min-w-0"><span className="text-xs font-medium text-gray-800 block truncate">{x.title}</span><span className="text-[10px] text-gray-500 font-mono">{x.type}</span></span>
              <span className="text-[10px] text-gray-500 tabular-nums">{counts[x.type] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {s && (
          <>
            <div className="flex items-center gap-2 mb-1"><span className="text-xl">{s.icon}</span><h3 className="text-sm font-semibold text-gray-900">{s.title}</h3><span className="text-[10px] text-gray-500 font-mono">{s.type}</span><span className="text-[10px] text-gray-500 ml-auto">{counts[s.type] ?? 0} in registry</span></div>
            {s.note && <p className="text-[11px] text-gray-500 mb-3">{s.note}</p>}

            <p className="text-[11px] font-semibold text-gray-500 mb-1">Definition contract</p>
            <div className="mb-4"><FieldTable fields={s.definition} /></div>

            <details className="mb-4">
              <summary className="text-[11px] font-semibold text-gray-500 cursor-pointer">Registry envelope (shared) — {s.envelope.length} fields</summary>
              <div className="mt-2"><FieldTable fields={s.envelope} /></div>
            </details>

            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Validate a definition</p>
              <textarea className={`${input} w-full font-mono h-28 resize-y`} value={json} onChange={e => setJson(e.target.value)} spellCheck={false} placeholder={`{ "formula": "..." }`} />
              <div className="flex items-center gap-3 mt-2">
                <button onClick={validate} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 disabled:opacity-50">{busy ? "Validating…" : "Validate"}</button>
                {res && <span className={`text-xs font-medium ${res.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{res.ok ? "✓ Valid against schema" : `✕ ${res.errors} error(s)`}{res.warnings ? ` · ${res.warnings} warning(s)` : ""}</span>}
              </div>
              {res && res.issues.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {res.issues.map((i, k) => <div key={k} className={`text-[11px] flex items-start gap-1.5 ${i.severity === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-warning)]"}`}><span className="font-mono shrink-0">{i.severity === "error" ? "✕" : "!"}</span><span className="font-mono text-gray-500">{i.path}</span><span>— {i.message}</span></div>)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
