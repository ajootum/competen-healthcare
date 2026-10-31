"use client";

import { useState } from "react";
import { ghost, input, Message, primary, useSend } from "./FairUseControls";

// "Clinical educational content review rules" on /super-admin/ai/fair-use (SCHOLAR-FLASHCARDS-QA-01 c, owner GO
// 31 Oct 2026). The same editing pattern as the clinical risk rules (FairUseControls RiskEditor): one rule per row,
// term groups one per line. Posts to /api/hq/ai-governance (hq.platform.ai.manage), which validates the draft strictly
// and stores it through CONFIG-002 in its own scope; publish and roll back are that scope's own, with version history.
// ⚠ These rules only FLAG learner content for checking against local guidelines. They never block or rewrite it, and
// never decide clinical correctness, grounding, model eligibility or risk tier.

type Kind = "unit" | "percent" | "range" | "comparison";
type Action = "flag" | "flag_strong" | "note_only";
export type ReviewRuleForm = { id: string; label: string; all: string[][]; numeric: Kind[]; topics: string[]; professions: string[]; action: Action; marker: string | null };
export type ReviewDoc = { rules: ReviewRuleForm[]; units: string[]; exclusions: string[]; markers: Record<Action | "reviewed", string> };
export type ReviewVersionRow = { id: string; when: string; label: string | null; note: string | null; publishedBy: string | null };

const KINDS: { code: Kind; label: string }[] = [
  { code: "unit", label: "a number with a clinical unit" }, { code: "percent", label: "a percentage" },
  { code: "range", label: "a range" }, { code: "comparison", label: "a comparison (above 5, >= 88)" },
];
const ACTIONS: { code: Action; label: string }[] = [
  { code: "flag", label: "Flag on the card" }, { code: "flag_strong", label: "Flag strongly on the card" }, { code: "note_only", label: "Points to Verify only" },
];
const RULE = /^[a-z][a-z0-9_.-]{1,60}$/;
const splitList = (v: string) => v.split(",").map(x => x.trim()).filter(Boolean);
const area = "mt-0.5 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-[13px]";

/** Text that commits on blur, so typing a comma or a new line never loses what is half written. */
function Draft({ value, onCommit, className, multiline = false, label }: { value: string; onCommit: (v: string) => void; className: string; multiline?: boolean; label?: string }) {
  const [v, setV] = useState(value);
  return multiline
    ? <textarea aria-label={label} rows={2} value={v} onChange={e => setV(e.target.value)} onBlur={() => onCommit(v)} className={className} />
    : <input aria-label={label} value={v} onChange={e => setV(e.target.value)} onBlur={() => onCommit(v)} className={className} />;
}

export function ContentReviewEditor({ product, doc, hasDraft }: { product: string; doc: ReviewDoc; hasDraft: boolean }) {
  const [d, setD] = useState<ReviewDoc>(doc);
  const [newId, setNewId] = useState("");
  const { busy, msg, send } = useSend();
  const setRule = (i: number, r: ReviewRuleForm) => setD(x => ({ ...x, rules: x.rules.map((y, j) => (j === i ? r : y)) }));
  return (
    <div className="space-y-3">
      {hasDraft && <p className="text-[13px] text-amber-900">An unpublished draft is shown: publish to make it effective.</p>}
      {d.rules.length === 0 && <p className="text-[13px] text-amber-900">No rules: no card will be flagged.</p>}
      <ul className="space-y-2">
        {d.rules.map((r, i) => (
          <li key={r.id} className="rounded-lg border border-gray-100 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <span className="font-mono text-[12px] text-gray-500">{r.id}</span>
              <label className="text-[12.5px] text-gray-700">Label<input value={r.label} maxLength={120} onChange={e => setRule(i, { ...r, label: e.target.value })} className={`${input} ml-1 w-56`} /></label>
              <label className="text-[12.5px] text-gray-700">Review action<select value={r.action} onChange={e => setRule(i, { ...r, action: e.target.value as Action })} className={`${input} ml-1`}>
                {ACTIONS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}</select></label>
              <button type="button" className={ghost} onClick={() => setD(x => ({ ...x, rules: x.rules.filter((_, j) => j !== i) }))}>Remove rule</button>
            </div>
            <label className="mt-1 block text-[12.5px] text-gray-700">Sensitive terms (one group of comma-separated terms per line; every line must match; a term ending in * matches a word start)
              <Draft multiline label={`${r.id} sensitive terms`} value={r.all.map(g => g.join(", ")).join("\n")} onCommit={v => setRule(i, { ...r, all: v.split("\n").map(splitList).filter(g => g.length) })} className={area} />
            </label>
            <fieldset className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-gray-700">
              <legend className="sr-only">{r.id}: clinical numerical values</legend>
              <span>and states</span>
              {KINDS.map(k => (
                <label key={k.code} className="inline-flex items-center gap-1 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                  <input type="checkbox" checked={r.numeric.includes(k.code)} onChange={e => setRule(i, { ...r, numeric: e.target.checked ? [...r.numeric, k.code] : r.numeric.filter(x => x !== k.code) })} />{k.label}
                </label>
              ))}
              <span className="text-gray-500">(none ticked: no value needed)</span>
            </fieldset>
            <div className="mt-1 flex flex-wrap gap-2">
              <label className="text-[12.5px] text-gray-700">and a topic matching<Draft label={`${r.id} topic patterns`} value={r.topics.join(", ")} onCommit={v => setRule(i, { ...r, topics: splitList(v) })} className={`${input} ml-1 w-56`} /></label>
              <label className="text-[12.5px] text-gray-700">Applies to professions (empty: all)<Draft label={`${r.id} professions`} value={r.professions.join(", ")} onCommit={v => setRule(i, { ...r, professions: splitList(v) })} className={`${input} ml-1 w-56`} /></label>
            </div>
            <label className="mt-1 block text-[12.5px] text-gray-700">Marker the learner sees (empty: the action&apos;s default below)
              <Draft label={`${r.id} marker`} value={r.marker ?? ""} onCommit={v => setRule(i, { ...r, marker: v.trim() || null })} className={`${input} block w-full`} />
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12.5px] text-gray-700">New rule id<input value={newId} maxLength={61} onChange={e => setNewId(e.target.value.trim())} className={`${input} ml-1 w-48 font-mono`} /></label>
        <button type="button" className={ghost} disabled={!RULE.test(newId) || d.rules.some(r => r.id === newId)} onClick={() => {
          setD(x => ({ ...x, rules: [...x.rules, { id: newId, label: newId, all: [], numeric: [], topics: [], professions: [], action: "flag", marker: null }] }));
          setNewId("");
        }}>Add rule</button>
      </div>
      <details className="rounded-lg border border-gray-100 p-2">
        <summary className="cursor-pointer text-[13px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">Clinical units, exclusions and default markers</summary>
        <label className="mt-2 block text-[12.5px] text-gray-700">Clinical units (comma-separated; %, percent and per cent are percentages)
          <Draft multiline label="clinical units" value={d.units.join(", ")} onCommit={v => setD(x => ({ ...x, units: splitList(v) }))} className={area} />
        </label>
        <label className="mt-2 block text-[12.5px] text-gray-700">A number followed by one of these is not a clinical value (ages, durations)
          <Draft label="numeric exclusions" value={d.exclusions.join(", ")} onCommit={v => setD(x => ({ ...x, exclusions: splitList(v) }))} className={`${input} block w-full`} />
        </label>
        {(["flag", "flag_strong", "note_only", "reviewed"] as const).map(k => (
          <label key={k} className="mt-2 block text-[12.5px] text-gray-700">
            {k === "reviewed" ? "Marker on clinically reviewed library content ({published} becomes the publication date)" : `Default marker: ${ACTIONS.find(a => a.code === k)!.label.toLowerCase()}`}
            <Draft label={`${k} marker`} value={d.markers[k]} onCommit={v => setD(x => ({ ...x, markers: { ...x.markers, [k]: v } }))} className={`${input} block w-full`} />
          </label>
        ))}
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={primary} onClick={() => send({ action: "content_review_save", product, rules: d }, "Draft saved. Publish to make it effective.")}>Save {product} draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function ContentReviewPublish({ pending, versions }: { pending: number; versions: ReviewVersionRow[] | null }) {
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, msg, send } = useSend();
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-gray-200 p-4">
        <h3 className="text-[15px] font-bold text-gray-900">Publish the content review rules</h3>
        <label htmlFor="cr-note" className="block text-[12.5px] font-semibold text-gray-700">Why this change (recorded with the version)</label>
        <textarea id="cr-note" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
        <button type="button" className={primary} disabled={busy || pending === 0} onClick={() => send({ action: "content_review_publish", note }, "Published. New downloads and study sessions use it.")}>
          {pending === 0 ? "Nothing to publish" : "Publish the rules"}
        </button>
        <Message msg={msg} />
      </div>
      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-[15px] font-bold text-gray-900">Version history</h3>
        {versions === null ? <p className="text-[13px] text-amber-900">Versions could not be read just now.</p>
          : versions.length === 0 ? <p className="text-[13px] text-gray-700">Nothing has been published yet: the built-in rules apply.</p> : (
            <ul className="mt-2 divide-y divide-gray-100">
              {versions.map(v => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <span>{v.when} UTC · {v.label ?? "Version"} · {v.publishedBy ?? "unknown"}{v.note ? ` · ${v.note}` : ""}</span>
                  {confirm === v.id ? (
                    <span className="flex gap-2">
                      <button type="button" className={primary} disabled={busy} onClick={() => { setConfirm(null); send({ action: "content_review_rollback", versionId: v.id }, "Rolled back. New downloads and study sessions use the restored rules."); }}>Roll back now</button>
                      <button type="button" className={ghost} onClick={() => setConfirm(null)}>Cancel</button>
                    </span>
                  ) : <button type="button" className={ghost} disabled={busy} onClick={() => setConfirm(v.id)}>Roll back to this</button>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
