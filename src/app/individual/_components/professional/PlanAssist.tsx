"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { secondaryBtn } from "../chrome";
import { AiNoticeText, aiNotice, type AiNotice } from "./ai-refusal";

// AI help with one goal (COMPETEN-PROFESSIONAL-PLAN-01). The Holdings Personal AI, under AI fair use and model
// eligibility, about the person's own goal. NOTHING IS SAVED until the person accepts a suggestion: "Add" posts it
// through the ordinary plan forms, exactly as if they had typed it. Evidence summaries and review questions are
// advisory text, never stored. Private reflections are never sent.

const small = "inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

type Kind = "activities" | "milestones" | "structure" | "evidence" | "review";
const ASK: [Kind, string][] = [
  ["structure", "Help me shape this goal"], ["activities", "Suggest activities"], ["milestones", "Suggest milestones"],
  ["evidence", "Summarise my evidence"], ["review", "Questions for my review"],
];
const STRUCTURE_FIELD: Record<string, string> = { outcome: "outcome", evidence: "expectedEvidence", motivation: "motivation" };

async function send(url: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, j: await res.json().catch(() => ({})) };
}

function Accept({ label, onAccept }: { label: string; onAccept: () => Promise<string | null> }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={state !== "idle"} className={small} onClick={async () => {
        setState("busy"); setErr(null);
        const e = await onAccept();
        if (e) { setErr(e); setState("idle"); } else setState("done");
      }}>{state === "done" ? "Added" : state === "busy" ? "…" : label}</button>
      {err && <span role="alert" className="text-[12px] text-red-700">{err}</span>}
    </span>
  );
}

export default function PlanAssist({ goalId, accent }: { goalId: string; accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  const [out, setOut] = useState<{ kind: Kind; items?: { title: string; basis: string }[]; text?: string; note?: string } | null>(null);

  async function ask(kind: Kind) {
    setBusy(kind); setNotice(null); setOut(null);
    try {
      const { res, j } = await send("/api/individual/professional/plan-suggestions", "POST", { goalId, kind });
      if (!res.ok) { setNotice(aiNotice(j, "The assistant could not answer just now.")); return; }
      setOut({ kind, items: j.items, text: j.text, note: j.note });
    } catch { setNotice({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setBusy(null); }
  }
  const accept = async (url: string, method: string, body: Record<string, unknown>) => {
    try {
      const { res, j } = await send(url, method, body);
      if (!res.ok) return j?.error ?? "That could not be added.";
      router.refresh();
      return null;
    } catch { return "That could not be added. Check your connection."; }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ASK.map(([k, label]) => (
          <button key={k} type="button" onClick={() => ask(k)} disabled={busy !== null} className={secondaryBtn} style={{ color: accent }}>
            {busy === k ? "Thinking…" : `✦ ${label}`}
          </button>
        ))}
      </div>
      {notice && <AiNoticeText notice={notice} className="mt-2" />}
      {out && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI suggestion · advisory · nothing is saved unless you add it</p>
          {out.text !== undefined && <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{out.text}</p>}
          {out.note && <p className="mt-1 text-[13px] text-gray-700">{out.note}</p>}
          {out.items && out.items.length > 0 && (
            <ul className="mt-2 space-y-2">
              {out.items.map((i, n) => (
                <li key={n} className="text-[13.5px]">
                  <p className="font-semibold text-gray-900">{out.kind === "structure" ? `${i.title}: ${i.basis}` : i.title}</p>
                  {out.kind !== "structure" && <p className="text-[12.5px] text-gray-600">Why: {i.basis}</p>}
                  <div className="mt-1">
                    {out.kind === "activities" && <Accept label="Add to my plan" onAccept={() => accept("/api/individual/professional/activities", "POST", { goalId, title: i.title, detail: i.basis, suggested: "ai" })} />}
                    {out.kind === "milestones" && <Accept label="Add milestone" onAccept={() => accept("/api/individual/professional/milestones", "POST", { goalId, title: i.title, suggested: "ai" })} />}
                    {out.kind === "structure" && STRUCTURE_FIELD[i.title.toLowerCase()] && (
                      <Accept label="Use this" onAccept={() => accept(`/api/individual/professional/goals?id=${goalId}`, "PUT", { stage3: "true", [STRUCTURE_FIELD[i.title.toLowerCase()]]: i.basis.slice(0, 1000) })} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
