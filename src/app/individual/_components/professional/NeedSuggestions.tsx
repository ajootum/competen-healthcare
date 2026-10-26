"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { secondaryBtn } from "../chrome";
import { inputCls } from "./forms";
import { AiNoticeText, aiNotice, type AiNotice } from "./ai-refusal";
import { AiGate } from "../ai/AiGate";

// Development-need suggestions (COMPETEN-PROFESSIONAL-NEEDS-01 N7). A suggestion says why it was made, stays private,
// and becomes a need only when the person accepts it -- with their own wording if they change it. Dismiss and defer
// create nothing. "Suggest with AI" goes through the Holdings Personal AI, under AI fair use and model eligibility.

const small = "inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/individual/professional/need-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { res, j: await res.json().catch(() => ({})) };
}

export function SuggestionDecision({ suggestionId, ruleKey, title, accent }: { suggestionId?: string; ruleKey?: string; title: string; accent: string }) {
  const router = useRouter();
  const [text, setText] = useState(title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function decide(decision: "accepted" | "dismissed" | "deferred") {
    setBusy(true); setErr(null);
    try {
      const { res, j } = await post({ action: "decide", suggestionId, ruleKey, decision, title: decision === "accepted" ? text : undefined });
      if (!res.ok) { setErr(j?.error ?? "That did not work. Try again."); return; }
      router.refresh();
    } catch { setErr("That did not work. Check your connection."); } finally { setBusy(false); }
  }
  const id = `sg-${suggestionId ?? ruleKey}`.replace(/[^a-z0-9-]/gi, "-");
  return (
    <div className="mt-2 space-y-2">
      <label htmlFor={id} className="sr-only">Edit the suggestion before accepting it</label>
      <input id={id} value={text} onChange={e => setText(e.target.value)} maxLength={200} className={inputCls} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || text.trim().length < 3} onClick={() => decide("accepted")} className={small} style={{ color: accent }}>Accept as a need</button>
        <button type="button" disabled={busy} onClick={() => decide("deferred")} className={small}>Later</button>
        <button type="button" disabled={busy} onClick={() => decide("dismissed")} className={small}>Dismiss</button>
        {err && <span role="alert" className="text-[12px] text-red-700">{err}</span>}
      </div>
    </div>
  );
}

export function GenerateSuggestions({ accent }: { accent: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function go() {
    setBusy(true); setNotice(null); setOk(null);
    try {
      const { res, j } = await post({ action: "generate" });
      if (!res.ok) { setNotice(aiNotice(j, "The assistant could not answer just now.")); return; }
      setOk(j.count ? `${j.count} suggestion${j.count === 1 ? "" : "s"} added below. Nothing becomes a need unless you accept it.` : j.note ?? "No suggestions this time.");
      router.refresh();
    } catch { setNotice({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setBusy(false); }
  }
  return (
    <div>
      <AiGate activity="assistant" experience="professional">{g => (<button type="button" onClick={go} disabled={busy || g.off} aria-describedby={g.describedBy} className={secondaryBtn} style={{ color: accent }}>{busy ? "Thinking…" : "✦ Suggest development needs with AI"}</button>)}</AiGate>
      {notice && <AiNoticeText notice={notice} className="mt-2" />}
      {ok && <p role="status" className="mt-2 text-[13px] text-green-800">{ok}</p>}
    </div>
  );
}

export function SummariseReflection({ id, accent }: { id: string; accent: string }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  async function go() {
    setBusy(true); setNotice(null); setAnswer(null);
    try {
      const res = await fetch("/api/individual/professional/reflections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "summarise", id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setNotice(aiNotice(j, "The assistant could not answer just now."));
      else setAnswer(j.answer ?? "");
    } catch { setNotice({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setBusy(false); }
  }
  return (
    <div className="mt-2">
      <AiGate activity="assistant" experience="professional">{g => (<button type="button" onClick={go} disabled={busy || g.off} aria-describedby={g.describedBy} className={small} style={{ color: accent }}>{busy ? "Thinking…" : "✦ Summarise with AI"}</button>)}</AiGate>
      {notice && <AiNoticeText notice={notice} className="mt-2" />}
      {answer !== null && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI summary · advisory · not saved</p>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{answer}</p>
          <p className="mt-2 text-[12px] text-gray-500">Only this reflection was sent, because you asked. To keep a need it points to, add it yourself.</p>
        </div>
      )}
    </div>
  );
}
