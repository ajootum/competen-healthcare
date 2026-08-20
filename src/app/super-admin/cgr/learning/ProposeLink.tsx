"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CGR-027 — propose a learning link (migration 150). A link asserts that a signal CAUSED a competency change,
// so the form insists on the things that make it evidence: a real signal, a real target, and a rationale.
// Structured signals/competencies are picked from live candidates so source_id/target_id are true FKs — the
// unique edge index and the causal signal→improvement duration both depend on that. "Other signal" stays
// available for guidelines and regulatory changes that have no record in the platform, and is labelled as such.

type Signal = { id: string; label: string; date: string | null; severity: string | null };
type Competency = { id: string; name: string };

const SOURCE_TYPES = [
  { v: "audit_finding", l: "Audit finding" },
  { v: "quality_indicator", l: "Quality indicator" },
  { v: "assessment_trend", l: "Assessment trend" },
  { v: "external_guideline", l: "External guideline" },
  { v: "regulatory_change", l: "Regulatory change" },
  { v: "feedback", l: "Feedback" },
  { v: "other", l: "Other" },
];
const LINK_TYPES = [
  { v: "triggered_review", l: "Triggered a review" },
  { v: "caused_change", l: "Caused a change" },
  { v: "informed_evidence", l: "Informed the evidence" },
  { v: "no_action_required", l: "No action required" },
];

export default function ProposeLink({ signals, competencies }: { signals: Signal[]; competencies: Competency[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"incident" | "other">(signals.length ? "incident" : "other");
  const [signalId, setSignalId] = useState("");
  const [sourceType, setSourceType] = useState("audit_finding");
  const [sourceRef, setSourceRef] = useState("");
  const [signalDate, setSignalDate] = useState("");
  const [targetId, setTargetId] = useState("");
  const [linkType, setLinkType] = useState("triggered_review");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const chosen = signals.find((s) => s.id === signalId);
  const targetName = competencies.find((c) => c.id === targetId)?.name ?? null;
  const valid = rationale.trim().length > 0 && !!targetId && (mode === "incident" ? !!signalId : sourceRef.trim().length > 0);

  function reset() {
    setSignalId(""); setSourceRef(""); setSignalDate(""); setTargetId(""); setRationale(""); setLinkType("triggered_review"); setErr(null);
  }

  async function submit() {
    setBusy(true); setErr(null); setOk(false);
    const body = mode === "incident"
      ? { sourceType: "incident", sourceId: signalId, sourceRef: chosen?.label ?? null, signalDate: signalDate || chosen?.date || null, targetType: "competency", targetId, targetName, linkType, rationale }
      : { sourceType, sourceRef: sourceRef.trim(), signalDate: signalDate || null, targetType: "competency", targetId, targetName, linkType, rationale };
    const r = await fetch("/api/cgr/learning-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setErr(j.error ?? "Failed to propose link"); return; }
    setOk(true); reset(); router.refresh();
  }

  const input = "border border-gray-200 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white";
  const lbl = "text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 block";

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(true)} className="text-[11px] font-semibold text-emerald-700 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] hover:bg-[var(--cmp-surface-success)] rounded-lg px-3 py-1.5 transition-colors">+ Propose a link</button>
        {ok && <span className="text-[11px] text-[var(--cmp-text-success)] font-medium">Link proposed — awaiting governance confirmation.</span>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--cmp-color-success)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-gray-800">Propose a learning link</p>
        <button onClick={() => { setOpen(false); reset(); }} className="text-[11px] text-gray-500 hover:text-gray-600">Close</button>
      </div>

      {/* Source */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={lbl + " mb-0"}>Signal</span>
          <div className="flex gap-1">
            <button onClick={() => setMode("incident")} disabled={!signals.length}
              className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border disabled:opacity-40 ${mode === "incident" ? "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" : "text-gray-500 border-gray-200"}`}>Recorded event</button>
            <button onClick={() => setMode("other")}
              className={`text-[10px] font-semibold rounded px-1.5 py-0.5 border ${mode === "other" ? "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" : "text-gray-500 border-gray-200"}`}>Other signal</button>
          </div>
        </div>

        {mode === "incident" ? (
          signals.length ? (
            <select value={signalId} onChange={(e) => { setSignalId(e.target.value); setSignalDate(signals.find((s) => s.id === e.target.value)?.date ?? ""); }} className={`${input} w-full`}>
              <option value="">Select an unlinked event…</option>
              {signals.map((s) => <option key={s.id} value={s.id}>{s.date ? `${s.date} · ` : ""}{s.label}{s.severity ? ` [${s.severity}]` : ""}</option>)}
            </select>
          ) : <p className="text-[11px] text-gray-500">No unlinked events available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={input}>
              {SOURCE_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <input value={sourceRef} onChange={(e) => setSourceRef(e.target.value)} placeholder="Reference (e.g. NICE NG51, Finding 4.2)" className={`${input} sm:col-span-2`} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <span className={lbl}>Signal date</span>
          <input type="date" value={signalDate} onChange={(e) => setSignalDate(e.target.value)} className={`${input} w-full`} />
          <p className="text-[9px] text-gray-500 mt-0.5">Starts the time-to-improvement clock.</p>
        </div>
        <div className="sm:col-span-2">
          <span className={lbl}>Competency affected</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={`${input} w-full`}>
            <option value="">Select a competency…</option>
            {competencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-3">
        <span className={lbl}>Transformation</span>
        <div className="flex flex-wrap gap-1.5">
          {LINK_TYPES.map((t) => (
            <button key={t.v} onClick={() => setLinkType(t.v)}
              className={`text-[11px] font-medium rounded-md px-2 py-1 border transition-colors ${linkType === t.v ? "text-emerald-700 bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]" : "text-gray-500 border-gray-200 hover:bg-gray-50"}`}>{t.l}</button>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <span className={lbl}>Rationale <span className="text-rose-500 normal-case">· required</span></span>
        <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2}
          placeholder="Why does this signal map to this competency change? This is a governance assertion and is retained as evidence."
          className={`${input} w-full resize-none`} />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!valid || busy}
          className="text-[11px] font-semibold text-white bg-[var(--cmp-color-success)] hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-[var(--cmp-color-success)] rounded-lg px-3 py-1.5 transition-colors">
          {busy ? "Proposing…" : "Propose link"}
        </button>
        <span className="text-[10px] text-gray-500">Proposed links require governance confirmation before they count as closed.</span>
        {err && <span className="text-[11px] text-[var(--cmp-text-error)] font-medium">{err}</span>}
      </div>
    </div>
  );
}
