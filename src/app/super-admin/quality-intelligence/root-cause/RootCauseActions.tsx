"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RCA_CATEGORIES, CATEGORY_LABEL, type RcaCategory } from "@/lib/qie/root-cause";

// QIE-005 write surface. The API and the analysis->action loop were proven by harness before this
// existed, which is the right order, but until a quality manager can open an investigation from the
// browser the engine is only reachable by someone with a service key.
//
// Deliberately NOT a wizard. An investigation is not filled in top to bottom in one sitting: it is opened
// when the incident is noticed, factors are added as they are found over days, and it is completed when
// somebody is confident. So the surface is: open from the backlog, add factors in place, complete when
// there is a finding. Each step is its own request and survives the page being closed.

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export function StartInvestigation({ incidentId, label }: { incidentId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setBusy(true); setErr(null);
    const { ok, json } = await call("/api/qie/investigations", "POST", {
      incident_id: incidentId, title: label.slice(0, 160), method: "fishbone",
    });
    setBusy(false);
    // A duplicate is not a failure worth alarming anyone about — it means somebody is already on it.
    if (!ok) { setErr(json.duplicate ? "Someone is already investigating this." : (json.error ?? "Could not start.")); return; }
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5 shrink-0">
      <button onClick={start} disabled={busy}
        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white disabled:opacity-50">
        {busy ? "…" : "Investigate"}
      </button>
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
    </span>
  );
}

export function InvestigationPanel({ id, status, hasRootCause }: { id: string; status: string; hasRootCause: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RcaCategory>("process");
  const [description, setDescription] = useState("");
  const [isRoot, setIsRoot] = useState(false);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const done = ["completed", "closed"].includes(status);

  async function addFactor() {
    if (!description.trim()) return;
    setBusy(true); setNote(null);
    const { ok, json } = await call("/api/qie/investigations", "PUT", {
      investigation_id: id, category, description: description.trim(), is_root_cause: isRoot,
    });
    setBusy(false);
    if (!ok) { setNote({ tone: "error", text: json.error ?? "Could not add the factor." }); return; }
    setDescription(""); setIsRoot(false);
    router.refresh();
  }

  async function complete() {
    setBusy(true); setNote(null);
    const { ok, json } = await call(`/api/qie/investigations?id=${id}`, "PATCH", {
      status: "completed", root_cause_summary: summary.trim() || undefined,
    });
    setBusy(false);
    if (!ok) {
      // The 422 the route raises when an investigation has found nothing — surfaced as the instruction it
      // actually is, rather than as a generic failure.
      setNote({ tone: "error", text: json.needsFinding ? json.error : (json.error ?? "Could not complete.") });
      return;
    }
    setNote({ tone: "ok", text: json.capa_created ? "Completed — a corrective action was opened from the root cause." : "Completed. No root cause was named, so no action was opened." });
    router.refresh();
  }

  if (done) return null;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] text-teal-700 hover:underline mt-2">
        Add a factor or complete →
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-start">
        <select value={category} onChange={e => setCategory(e.target.value as RcaCategory)}
          className="text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white">
          {RCA_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <input value={description} onChange={e => setDescription(e.target.value)}
          placeholder="What contributed to this?"
          className="flex-1 min-w-[180px] text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
        <label className="flex items-center gap-1.5 text-[11px] text-gray-600 py-1.5">
          <input type="checkbox" checked={isRoot} onChange={e => setIsRoot(e.target.checked)} className="rounded border-gray-300" />
          Root cause
        </label>
        <button onClick={addFactor} disabled={busy || !description.trim()}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50">Add</button>
      </div>
      <p className="text-[10px] text-gray-500">
        A contributing factor is not a root cause. Tick the box only for the one (or few) you would act on.
      </p>

      <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-2 items-start">
        <input value={summary} onChange={e => setSummary(e.target.value)}
          placeholder={hasRootCause ? "Summary (optional)" : "Summary — required if no root cause is named"}
          className="flex-1 min-w-[200px] text-[11px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
        <button onClick={complete} disabled={busy}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white disabled:opacity-50">
          {busy ? "…" : "Complete"}
        </button>
        <button onClick={() => { setOpen(false); setNote(null); }}
          className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">Close</button>
      </div>
      <p className="text-[10px] text-gray-500">
        Completing with a root cause opens a corrective action automatically. Completing without one is allowed —
        &ldquo;no single cause&rdquo; is a real conclusion — and opens nothing.
      </p>
      {note && <p className={`text-[11px] ${note.tone === "error" ? "text-[var(--cmp-text-error)]" : "text-[var(--cmp-text-success)]"}`}>{note.text}</p>}
    </div>
  );
}
