"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing } from "../chrome";
import { inputCls } from "./forms";

// The competencies one goal, CPD entry or piece of evidence is linked to -- migration 393, through
// /api/individual/professional/mappings. The person links, accepts or rejects. An AI suggestion stays a
// suggestion until the person accepts it.
//
// ⚠ SELF-DECLARED, NEVER VERIFIED. Amber, like Professional's own evidence classes. Green is kept for what an
// organisation verified, and nothing here is that. Each state is said in words, never in colour alone.

/** review: the clinical review state of the competency in words (owner decision D1), null when no longer offered. */
export type LinkView = { mapId: string; competencyId: string; title: string; source: "person" | "ai"; state: "proposed" | "accepted" | "rejected"; rationale: string | null; review: string | null };
export type OfferedView = { competencyId: string; title: string; catalogue: string; review: string };

const smallBtn = `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

export default function CompetencyLinks({ kind, subjectId, links, offered, accent, idPrefix }: {
  kind: "goal" | "cpd" | "evidence"; subjectId: string; links: LinkView[];
  /** null: what is offered could not be read. []: nothing is offered in Professional yet. */
  offered: OfferedView[] | null; accent: string; idPrefix: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState("");

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That did not work. Try again." }); return; }
      setMsg({ ok: true, text: typeof j?.proposed === "number" ? (j.proposed ? `${j.proposed} suggestion${j.proposed === 1 ? "" : "s"} added below. Accept only the ones that fit.` : "No suggestions fitted this entry.") : done });
      setPick("");
      router.refresh();
    } catch { setMsg({ ok: false, text: "That did not work. Check your connection." }); } finally { setBusy(false); }
  }

  const live = links.filter(l => l.state !== "rejected");
  const linked = new Set(live.map(l => l.competencyId));
  const choices = (offered ?? []).filter(o => !linked.has(o.competencyId));
  // Nothing offered (the default) and nothing linked: the entry stands on its own. Repeating "nothing is
  // offered" under every goal and CPD entry would read as something missing from the person's record.
  if (offered?.length === 0 && live.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">Competencies</p>
      {live.length === 0
        ? <p className="text-[12.5px] text-gray-600">{offered === null ? "None linked. The competencies on offer could not be read just now." : offered.length === 0 ? "None linked. No competency catalogue is offered in Professional yet." : "None linked yet."}</p>
        : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {live.map(l => (
              <li key={l.mapId} className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12.5px] text-amber-950">
                <span className="font-semibold">{l.title}</span>
                {l.review && <span className="rounded-full border border-amber-400 bg-white px-1.5 text-[11px] font-semibold text-amber-900">{l.review}</span>}
                <span className="text-amber-900">
                  {l.state === "proposed" ? "· suggested by AI, not accepted" : l.source === "ai" ? "· AI suggestion you accepted" : "· linked by you"}
                </span>
                {l.state === "proposed" && l.rationale && <span className="w-full text-[12px] text-amber-900">{l.rationale}</span>}
                {l.state === "proposed" && (
                  <button type="button" disabled={busy} className={smallBtn} onClick={() => post({ action: "decide", mapId: l.mapId, decision: "accepted" }, "Accepted.")}>Accept</button>
                )}
                <button type="button" disabled={busy} className={smallBtn}
                  onClick={() => post({ action: "decide", mapId: l.mapId, decision: "rejected" }, l.state === "proposed" ? "Suggestion rejected." : "Link removed.")}>
                  {l.state === "proposed" ? "Reject" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}

      {offered !== null && offered.length > 0 && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label htmlFor={`${idPrefix}-comp`} className="sr-only">Link a competency</label>
          <select id={`${idPrefix}-comp`} value={pick} onChange={e => setPick(e.target.value)} className={`${inputCls} max-w-xs`}>
            <option value="">Link a competency…</option>
            {choices.map(o => <option key={o.competencyId} value={o.competencyId}>{o.title} ({o.catalogue}: {o.review.toLowerCase()})</option>)}
          </select>
          <button type="button" disabled={busy || !pick} className={smallBtn} style={{ color: accent }}
            onClick={() => post({ action: "add", kind, id: subjectId, competencyId: pick }, "Linked.")}>Link</button>
          <button type="button" disabled={busy} className={smallBtn}
            onClick={() => post({ action: "propose", subjects: [{ kind, id: subjectId }] }, "Done.")}>Suggest with AI</button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-[12.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
