"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { secondaryBtn } from "../chrome";
import { AiNoticeText, aiNotice, type AiNotice } from "./ai-refusal";
import { AiGate } from "../ai/AiGate";

// AI help with one competency (COMPETEN-PROFESSIONAL-COMPETENCY-01 S12). The Holdings Personal AI, under AI fair use and
// model eligibility. Explanations, reflection questions and summaries are advisory text, never stored. A mapping
// suggestion becomes an evidence link ONLY when the person clicks Add, and the link then records the model and prompt
// version it came from. AI never verifies, never assesses, and never sees a reflection.

const small = "inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
type Kind = "explore" | "reflect" | "map" | "summary";
const ASK: [Kind, string][] = [["explore", "Explain this competency"], ["reflect", "Questions to reflect on"], ["map", "Suggest evidence mappings"], ["summary", "Summarise my evidence"]];
type Mapping = { kind: string; sourceId: string; title: string; outcome: string | null; relation: string; basis: string };

export default function CompetencyAssist({ entryId, accent }: { entryId: string; accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  const [out, setOut] = useState<{ kind: Kind; text?: string; items?: Mapping[]; model?: string; promptVersion?: string; note?: string } | null>(null);
  const [added, setAdded] = useState<Record<number, string>>({});

  async function ask(kind: Kind) {
    setBusy(kind); setNotice(null); setOut(null); setAdded({});
    try {
      const res = await fetch("/api/individual/professional/competency-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryId, kind }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(aiNotice(j, "The assistant could not answer just now.")); return; }
      setOut({ kind, text: j.text, items: j.items, model: j.model, promptVersion: j.promptVersion, note: j.note });
    } catch { setNotice({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setBusy(null); }
  }
  async function accept(i: number, m: Mapping) {
    setAdded(a => ({ ...a, [i]: "…" }));
    try {
      const res = await fetch("/api/individual/professional/competency-evidence", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, kind: m.kind, sourceId: m.sourceId, outcome: m.outcome ?? "", relation: m.relation, model: out?.model, promptVersion: out?.promptVersion }) });
      const j = await res.json().catch(() => ({}));
      setAdded(a => ({ ...a, [i]: res.ok ? "Added" : j?.error ?? "Could not be added" }));
      if (res.ok) router.refresh();
    } catch { setAdded(a => ({ ...a, [i]: "Could not be added" })); }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <AiGate activity="assistant" experience="professional">{g => ASK.map(([k, label]) => (
          <button key={k} type="button" onClick={() => ask(k)} disabled={busy !== null || g.off} aria-describedby={g.describedBy} className={secondaryBtn} style={{ color: accent }}>{busy === k ? "Thinking…" : `✦ ${label}`}</button>
        ))}</AiGate>
      </div>
      {notice && <AiNoticeText notice={notice} className="mt-2" />}
      {out && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI suggestion · advisory · not verification · nothing is saved unless you add it</p>
          {out.text !== undefined && <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{out.text}</p>}
          {out.note && <p className="mt-1 text-[13px] text-gray-700">{out.note}</p>}
          {out.items && out.items.length > 0 && (
            <ul className="mt-2 space-y-2">
              {out.items.map((m, i) => (
                <li key={i} className="text-[13.5px]">
                  <p className="font-semibold text-gray-900">{m.title} → {m.outcome ?? "the competency as a whole"} ({m.relation})</p>
                  <p className="text-[12.5px] text-gray-600">Why: {m.basis}</p>
                  <button type="button" disabled={!!added[i]} onClick={() => accept(i, m)} className={`${small} mt-1`}>{added[i] ?? "Add this link"}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
