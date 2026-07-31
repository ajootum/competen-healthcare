"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";

// AI Configuration Copilot (NCP-014) — describe what you want in natural language; the copilot proposes ONE
// governed configuration artifact, schema-validated. It never writes to production: "Author as governed draft"
// routes the proposal through the normal Studio path (create identity + save definition) so it enters governance,
// the dependency gate and version history like any hand-authored object.
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const HREF: Record<string, string> = { METRIC: "/super-admin/platform-ops/metrics", FORM: "/super-admin/platform-ops/forms", BUSINESS_RULE: "/super-admin/platform-ops/rules", PAGE: "/super-admin/platform-ops/pages", WORKFLOW: "/super-admin/platform-ops/workflows", DASHBOARD: "/super-admin/platform-ops/reports", REPORT: "/super-admin/platform-ops/reports", PERMISSION: "/super-admin/platform-ops/permissions", NAVIGATION_SECTION: "/super-admin/platform-ops/navigation" };
const EXAMPLES = [
  "A metric for 30-day readmission rate, lower is better, green under 5%, amber under 8%",
  "A falls risk assessment form with a patient lookup, a 1–5 risk rating and a mitigation plan textarea",
  "A permission set letting ward nurses view but not edit dashboards, only when competency status is verified",
  "A dashboard with bed occupancy, staffing ratio and incident count tiles",
];

export default function Copilot({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [authored, setAuthored] = useState<string | null>(null);

  async function generate() {
    if (!prompt.trim()) return;
    setBusy(true); setMsg(null); setResult(null); setAuthored(null);
    const r = await fetch("/api/config/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok || j.artifact) setResult(j); else setMsg(j?.error || "Generation failed.");
  }

  async function author() {
    if (!result?.artifact) return;
    const a = result.artifact;
    setBusy(true); setMsg(null);
    const c = await fetch("/api/config/objects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_type: a.object_type, object_key: a.object_key, display_name: a.display_name, description: a.description }) });
    const cj = await c.json().catch(() => ({}));
    if (!c.ok) { setBusy(false); setMsg(cj?.error || "Could not create the object."); return; }
    const p = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: a.object_key, definition: a.definition }) });
    const pj = await p.json().catch(() => ({}));
    setBusy(false);
    if (p.ok) { setAuthored(a.object_key); setMsg(`✓ Authored "${a.display_name}" as a governed draft.`); router.refresh(); }
    else setMsg(`Object created, but saving the definition failed: ${pj?.error ?? "unknown"}.`);
  }

  const card = "bg-white rounded-xl border border-gray-200";
  const a = result?.artifact;

  return (
    <div className="space-y-4">
      {!configured && <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4 text-sm text-amber-800">⚠ No AI provider is configured on this environment (<span className="font-mono text-xs">ANTHROPIC_API_KEY</span> not set). The Copilot will return a configuration error until a key is present.</div>}

      <div className={`${card} p-5`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Describe the configuration you want</p>
        <textarea className={`${input} w-full h-24 resize-y`} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. A metric for medication administration accuracy, higher is better, green above 98%…" />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {EXAMPLES.map((ex, i) => <button key={i} onClick={() => setPrompt(ex)} className="text-[10px] bg-gray-50 border border-gray-100 text-gray-600 rounded-full px-2.5 py-1 hover:bg-gray-100">{ex.length > 46 ? ex.slice(0, 46) + "…" : ex}</button>)}
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={generate} disabled={busy || !prompt.trim()} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Thinking…" : "✨ Generate"}</button>
          {result?.usage && <span className="text-[10px] text-gray-400">{result.model} · {result.usage.input}+{result.usage.output} tok</span>}
        </div>
      </div>

      {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}

      {a && (
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">{a.object_type}</span>
            <h3 className="text-sm font-semibold text-gray-900">{a.display_name || <span className="text-gray-300">untitled</span>}</h3>
            <span className="text-[10px] text-gray-400 font-mono ml-auto">{a.object_key}</span>
          </div>
          {result.rationale && <p className="text-[11px] text-gray-500 mb-3 italic">{result.rationale}</p>}

          <div className={`text-xs font-medium mb-2 ${result.valid ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{result.valid ? "✓ Schema-valid — ready to author as a governed draft" : "✕ The proposal has schema issues"}</div>
          {result.problems?.length > 0 && <div className="mb-2 space-y-0.5">{result.problems.map((p: string, i: number) => <p key={i} className="text-[11px] text-[var(--cmp-text-error)]">• {p}</p>)}</div>}
          {result.issues?.filter((i: any) => i.severity === "error").length > 0 && <div className="mb-2 space-y-0.5">{result.issues.filter((i: any) => i.severity === "error").map((i: any, k: number) => <p key={k} className="text-[11px] text-[var(--cmp-text-error)] font-mono">{i.path}: {i.message}</p>)}</div>}

          <p className="text-[11px] font-semibold text-gray-500 mb-1">Proposed definition</p>
          <pre className="text-[11px] bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-x-auto text-gray-700 max-h-72">{JSON.stringify(a.definition, null, 2)}</pre>

          <div className="flex items-center justify-between mt-4">
            <p className="text-[10px] text-gray-400">Authoring creates a governed DRAFT — it flows through governance, the dependency gate and version history before going live.</p>
            {authored ? (
              <a href={HREF[a.object_type] ?? "/super-admin/platform-ops/registry"} className="text-sm font-medium text-emerald-700 border border-[var(--cmp-color-success)] rounded-lg px-4 py-2 hover:bg-[var(--cmp-surface-success)]">Open in designer →</a>
            ) : (
              <button onClick={author} disabled={busy || !result.valid} title={!result.valid ? "Resolve schema issues first" : "Create as a governed draft"} className="text-sm font-medium text-white bg-[var(--cmp-color-success)] hover:bg-emerald-700 rounded-lg px-4 py-2 disabled:opacity-40">Author as governed draft</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
