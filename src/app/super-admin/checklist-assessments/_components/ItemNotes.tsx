"use client";

import { useState } from "react";
import { Btn, fieldBase, mutedText } from "@/components/assessment/ui";
import type { CommentView, EvidenceView } from "@/lib/assessment/assessor/instances";

// Evidence and comments for one item (or the whole assessment when itemKey is null). Both are append-only on the server.
// Evidence is a note or a reference to a record: HQ has no upload path to reuse, so there is no file upload here.

const API = (id: string) => `/api/hq/checklist-assessments/instances/${id}`;
const KIND_LABEL: Record<string, string> = { comment: "Comment", safety_concern: "Safety concern", strength: "Strength", recommendation: "Recommendation" };

async function post(url: string, body: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, id: String(b.id ?? "") } : { ok: false, error: b.error ?? "That could not be saved." };
  } catch { return { ok: false, error: "There is no connection. Try again." }; }
}

export function EvidencePanel({ instanceId, itemKey, evidence, disabled, onAdded }: {
  instanceId: string; itemKey: string; evidence: EvidenceView[]; disabled?: boolean; onAdded: (e: EvidenceView) => void;
}) {
  const [kind, setKind] = useState<"note" | "record_ref">("note");
  const [note, setNote] = useState("");
  const [refKind, setRefKind] = useState("");
  const [refId, setRefId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = evidence.filter(e => e.item_key === itemKey);
  async function add() {
    setBusy(true); setError(null);
    const r = await post(`${API(instanceId)}/evidence`, kind === "note" ? { itemKey, kind, note } : { itemKey, kind, refKind, refId });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onAdded({ id: r.id, item_key: itemKey, kind, note: kind === "note" ? note : null, ref_kind: kind === "record_ref" ? refKind : null, ref_id: kind === "record_ref" ? refId : null, created_at: new Date().toISOString() });
    setNote(""); setRefKind(""); setRefId("");
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--cmp-app-border)] p-3" data-evidence-panel={itemKey}>
      <p className="text-sm font-semibold text-[var(--cmp-app-text)]">Evidence ({mine.length})</p>
      {mine.length ? (
        <ul className="flex flex-col gap-1 text-sm text-[var(--cmp-app-text)]">
          {mine.map(e => <li key={e.id}>{e.kind === "note" ? e.note : `${e.ref_kind} ${e.ref_id}`} <span className={mutedText}>({e.kind === "note" ? "note" : "record"})</span></li>)}
        </ul>
      ) : <p className={`text-sm ${mutedText}`}>Nothing attached yet.</p>}
      {disabled ? null : (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Kind of evidence" className="inline-flex gap-2">
            <Btn size="sm" aria-pressed={kind === "note"} kind={kind === "note" ? "primary" : "secondary"} onClick={() => setKind("note")}>Note</Btn>
            <Btn size="sm" aria-pressed={kind === "record_ref"} kind={kind === "record_ref" ? "primary" : "secondary"} onClick={() => setKind("record_ref")}>Record reference</Btn>
          </div>
          {kind === "note"
            ? <textarea aria-label="Evidence note" rows={3} maxLength={4000} value={note} onChange={e => setNote(e.target.value)} className={`${fieldBase} min-h-[5rem]`} />
            : (
              <div className="grid gap-2 sm:grid-cols-2">
                <input aria-label="Kind of record" placeholder="Kind of record, for example observation_form" value={refKind} onChange={e => setRefKind(e.target.value)} className={fieldBase} />
                <input aria-label="Record id" placeholder="Record id (uuid)" value={refId} onChange={e => setRefId(e.target.value)} className={fieldBase} />
              </div>
            )}
          <div><Btn size="sm" onClick={add} disabled={busy || (kind === "note" ? !note.trim() : !refKind.trim() || !refId.trim())}>{busy ? "Adding" : "Add evidence"}</Btn></div>
          <p className={`text-xs ${mutedText}`}>A note or a reference to a record. Files cannot be uploaded here.</p>
          {error ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{error}</p> : null}
        </div>
      )}
    </div>
  );
}

export function CommentPanel({ instanceId, itemKey, comments, disabled, onAdded, heading }: {
  instanceId: string; itemKey: string | null; comments: CommentView[]; disabled?: boolean; onAdded: (c: CommentView) => void; heading?: string;
}) {
  const [kind, setKind] = useState("comment");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = comments.filter(c => (c.item_key ?? null) === itemKey);
  async function add() {
    setBusy(true); setError(null);
    const r = await post(`${API(instanceId)}/comments`, { itemKey, kind, body });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onAdded({ id: r.id, item_key: itemKey, kind, body, author_id: null, created_at: new Date().toISOString() });
    setBody("");
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--cmp-app-border)] p-3" data-comment-panel={itemKey ?? "general"}>
      {heading ? <p className="text-sm font-semibold text-[var(--cmp-app-text)]">{heading} ({mine.length})</p> : null}
      {mine.length ? (
        <ul className="flex flex-col gap-1 text-sm text-[var(--cmp-app-text)]">
          {mine.map(c => <li key={c.id}><span className="font-semibold">{KIND_LABEL[c.kind] ?? c.kind}:</span> {c.body}</li>)}
        </ul>
      ) : null}
      {disabled ? null : (
        <div className="flex flex-col gap-2">
          <label className={`flex flex-col gap-1 text-xs font-semibold ${mutedText}`}>
            <span>Kind</span>
            <select value={kind} onChange={e => setKind(e.target.value)} className={fieldBase}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <textarea aria-label={itemKey ? "Comment on this item" : "Comment on the whole assessment"} rows={3} maxLength={4000} value={body} onChange={e => setBody(e.target.value)} className={`${fieldBase} min-h-[5rem]`} />
          <div><Btn size="sm" onClick={add} disabled={busy || !body.trim()}>{busy ? "Adding" : "Add"}</Btn></div>
          {error ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
