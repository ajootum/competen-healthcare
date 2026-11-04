"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { input, primary } from "@/app/super-admin/ai/fair-use/_components/FairUseControls";
import { Msg, useResearchSend } from "./ResearchControls";

// SQIE-CLOSE-2026-11 WS-E. Two HQ library controls, both posting to /api/hq/knowledge/educator, which re-checks the capability:
//   CompetencyPicker   pick the competencies a draft teaches from the PUBLISHED controlled catalogues (no typed ids). The
//                      server refuses any id outside them, and 442 freezes the set once the version is submitted.
//   BulkLibraryActions submit drafts, start replacement versions, or (publishers) retire published versions, several at once.
//                      Each item is checked and reported on its own: one refusal never hides or blocks the others.

const EP = "/api/hq/knowledge/educator";
type Option = { id: string; title: string; code: string | null; catalogue: string };

export function CompetencyPicker({ versionId, selected, options, names }: { versionId: string; selected: string[]; options: Option[]; names: Record<string, string> }) {
  const { busy, msg, send } = useResearchSend(EP);
  const [chosen, setChosen] = useState<string[]>(selected);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options.filter(o => !t || o.title.toLowerCase().includes(t) || (o.code ?? "").toLowerCase().includes(t) || o.catalogue.toLowerCase().includes(t)).slice(0, 60);
  }, [q, options]);
  const stale = chosen.filter(id => !options.some(o => o.id === id));
  const toggle = (id: string, on: boolean) => setChosen(on ? [...new Set([...chosen, id])].slice(0, 20) : chosen.filter(x => x !== id));
  if (!options.length) return <p className="text-[12.5px] text-gray-600">No controlled catalogue is published yet, so there are no competencies to choose from.</p>;
  return (
    <div className="space-y-2 text-[12.5px]">
      <p className="text-gray-600">From the published competency catalogues. Up to 20. Frozen once the version is submitted.</p>
      {chosen.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Chosen competencies">{chosen.map(id => (
        <li key={id} className="flex items-center gap-1 rounded border border-teal-600 bg-teal-50 px-1.5 py-0.5 text-teal-950">
          {options.find(o => o.id === id)?.title ?? names[id] ?? "Not in a published catalogue"}
          <button type="button" className="font-semibold underline" aria-label={`Remove ${options.find(o => o.id === id)?.title ?? id}`} onClick={() => toggle(id, false)}>×</button>
        </li>))}</ul>}
      {stale.length > 0 && <p role="note" className="text-amber-950">{stale.length} chosen competenc{stale.length === 1 ? "y is" : "ies are"} not in a published catalogue now. Remove {stale.length === 1 ? "it" : "them"} before saving.</p>}
      <label className="block">Search by title, code or catalogue<input value={q} onChange={e => setQ(e.target.value)} className={`${input} w-full`} /></label>
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 p-1" aria-label="Competencies">{shown.map(o => (
        <li key={o.id}><label className="flex items-start gap-2 px-1 py-0.5">
          <input type="checkbox" checked={chosen.includes(o.id)} onChange={e => toggle(o.id, e.target.checked)} disabled={!chosen.includes(o.id) && chosen.length >= 20} />
          <span>{o.title}{o.code ? <code className="ml-1 text-gray-600">{o.code}</code> : null}<span className="block text-[11.5px] text-gray-600">{o.catalogue}</span></span>
        </label></li>))}
        {shown.length === 0 && <li className="px-1 py-0.5 text-gray-600">Nothing matches.</li>}
      </ul>
      <div className="flex items-center gap-2"><button type="button" className={primary} disabled={busy || stale.length > 0} onClick={() => send({ action: "competencies_set", versionId, competencyIds: chosen }, "Competencies saved.")}>Save competencies</button><Msg msg={msg} /></div>
    </div>
  );
}

export type BulkRow = { resourceId: string; title: string; code: string; draftVersionId: string | null; servedVersionId: string | null; replaceable: boolean };
type Action = "bulk_submit" | "bulk_replace" | "bulk_retire";
const ACTION_LABEL: Record<Action, string> = {
  bulk_submit: "Submit drafts for clinical review", bulk_replace: "Start a replacement version (the published one stays in use until the new one is published)",
  bulk_retire: "Retire the published version (learners are no longer given it)",
};

export function BulkLibraryActions({ rows, canRetire }: { rows: BulkRow[]; canRetire: boolean }) {
  const router = useRouter();
  const actions: Action[] = canRetire ? ["bulk_submit", "bulk_replace", "bulk_retire"] : ["bulk_submit", "bulk_replace"];
  const [action, setAction] = useState<Action>("bulk_submit");
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; text: string; failed: { title: string; error: string }[] } | null>(null);
  const idOf = (r: BulkRow) => (action === "bulk_submit" ? r.draftVersionId : action === "bulk_replace" ? (r.replaceable ? r.resourceId : null) : r.servedVersionId);
  const eligible = rows.filter(r => idOf(r));
  const picked = eligible.filter(r => chosen.includes(r.resourceId));
  async function run() {
    setBusy(true); setOut(null);
    try {
      const res = await fetch(EP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids: picked.map(idOf), ...(action === "bulk_retire" ? { reason } : {}) }) });
      const j = await res.json().catch(() => ({}));
      if (!Array.isArray(j?.results)) { setOut({ ok: false, text: j?.error ?? "That could not be done. Nothing has changed.", failed: [] }); return; }
      const byId = new Map(picked.map(r => [idOf(r), r.title]));
      const failed = (j.results as { id: string; ok: boolean; error?: string }[]).filter(x => !x.ok).map(x => ({ title: byId.get(x.id) ?? x.id, error: x.error ?? "Refused." }));
      setOut({ ok: j.done > 0, text: `${j.done} of ${j.of} done.`, failed });
      setChosen([]);
      router.refresh();
    } catch { setOut({ ok: false, text: "That could not be done. Check your connection.", failed: [] }); } finally { setBusy(false); }
  }
  return (
    <details className="rounded-lg border border-gray-200 p-3 text-[13px]">
      <summary className="cursor-pointer font-semibold text-teal-800">Bulk actions on the questions shown</summary>
      <div className="mt-2 space-y-2">
        <label className="block text-[12.5px]">Action<select value={action} onChange={e => { setAction(e.target.value as Action); setChosen([]); setOut(null); }} className={`${input} w-full`}>
          {actions.map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}</select></label>
        <p className="text-[12.5px] text-gray-600">Each question is checked on its own exactly as when done singly (rights, likely duplicates, educator review, separation of duties). {eligible.length} of {rows.length} shown can take this action.</p>
        {eligible.length > 0 && <>
          <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={picked.length === eligible.length} onChange={e => setChosen(e.target.checked ? eligible.map(r => r.resourceId).slice(0, 50) : [])} /> Select all ({Math.min(eligible.length, 50)})</label>
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 p-1">{eligible.map(r => (
            <li key={r.resourceId}><label className="flex items-center gap-2 px-1 py-0.5"><input type="checkbox" checked={chosen.includes(r.resourceId)} disabled={!chosen.includes(r.resourceId) && chosen.length >= 50}
              onChange={e => setChosen(e.target.checked ? [...chosen, r.resourceId] : chosen.filter(x => x !== r.resourceId))} />{r.title} <code className="text-gray-600">{r.code}</code></label></li>))}</ul>
        </>}
        {action === "bulk_retire" && <label className="block text-[12.5px]">Reason, recorded on every version (10 to 500 characters)<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className={`${input} w-full`} /></label>}
        <button type="button" className={primary} disabled={busy || !picked.length || (action === "bulk_retire" && reason.trim().length < 10)} onClick={run}>{busy ? "Working…" : `Apply to ${picked.length}`}</button>
        {out && <div role={out.ok ? "status" : "alert"} className={`text-[12.5px] ${out.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
          <p>{out.text}</p>
          {out.failed.length > 0 && <ul className="ml-4 list-disc text-[var(--cmp-text-critical)]">{out.failed.map((f, i) => <li key={i}>{f.title}: {f.error}</li>)}</ul>}
        </div>}
      </div>
    </details>
  );
}
