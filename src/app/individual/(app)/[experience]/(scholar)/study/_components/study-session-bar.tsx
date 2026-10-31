"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { STUDY_DEVICE_NOTE, askHref, stageHref, type StudyBarView, type StudyStage } from "@/lib/individual/scholar/study-carry";

// THE STUDY SESSION BAR -- SCHOLAR-SESSION-AI-02 slice B (PLAN.md section 5). One slim bar under the Learning spaces
// tabs while a connected study session is open: its focus and objective, the four stage chips with a progress mark
// each, Ask Personal AI and End session. Rendered by StudyNav only; the data comes from the server (study-context.ts
// loadStudy, database reads only), so opening a stage makes no AI call.
// CPR-MOB-001: below md one row (title, current stage, Ask, and a More menu holding the stages and End session); from md
// the title, objective, four chips and the actions. pointer-coarse sizes the touch targets. No other breakpoint.
// Owner D3: the Personal AI conversation stays on this device; the session, saved explanations and attempts do not.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const action = `inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;


function Mark({ s }: { s: StudyStage }) {
  // The mark is never colour alone: a filled circle with a tick, a dot, or an empty ring, and its words for screen readers.
  return (
    <span aria-hidden className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
      style={s.mark === "done" ? { background: accent, borderColor: accent, color: "#fff" } : s.mark === "started" ? { borderColor: accent, color: accent } : { borderColor: "var(--cmp-app-border, #d1d5db)" }}>
      {s.mark === "done" ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
        : s.mark === "started" ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} /> : null}
    </span>
  );
}

function Chip({ s, id, current }: { s: StudyStage; id: string; current: boolean }) {
  return (
    <Link href={stageHref(s.space, id)} aria-current={current ? "page" : undefined}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${current ? "bg-[var(--cmp-theme-soft)]" : "bg-white hover:bg-gray-50"}`}
      style={current ? { borderColor: accent, color: accent } : { borderColor: "var(--cmp-app-border, #e5e7eb)", color: "#374151" }}>
      <Mark s={s} />{s.label}<span className="sr-only">: {s.detail}</span>
    </Link>
  );
}

export function StudySessionBar({ bar }: { bar: StudyBarView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = bar.stages.find(s => s.space === bar.current) ?? null;

  // End session: the existing Learn session update (PATCH status completed). The page then reopens without ?study=.
  async function end() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/individual/scholar/learn/sessions/${bar.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
      if (!res.ok) { setError("Your session could not be ended just now."); setBusy(false); return; }
      const u = new URL(window.location.href);
      u.searchParams.delete("study");
      router.replace(`${u.pathname}${u.search}${u.hash}`);
      router.refresh();
    } catch { setError("Competen could not be reached. Check your connection and try again."); setBusy(false); }
  }

  return (
    <section aria-label="Study session" data-testid="study-session-bar" className="mb-5 rounded-2xl border bg-white px-3 py-2.5 md:px-4 md:py-3" style={{ borderColor: "var(--cmp-theme-border, #d1d5db)" }}>
      <div className="flex min-w-0 items-center gap-2 md:items-start md:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em]" style={{ color: accent }}>Study session{bar.status === "completed" ? " · ended" : ""}</p>
          <h2 className="truncate text-[15px] font-bold text-gray-900" title={bar.title}>{bar.title}</h2>
          {bar.objective && <p className="hidden truncate text-[12.5px] text-gray-600 md:block" title={bar.objective}><span className="font-semibold">Objective: </span>{bar.objective}</p>}
          {current && <p className="truncate text-[12.5px] text-gray-600 md:hidden">Now in {current.label} · {current.detail}</p>}
        </div>
        <Link href={askHref(bar.id)} className={`${action} text-white hover:opacity-90`} style={{ background: accent }}>
          Ask<span className="hidden md:inline">&nbsp;Personal AI</span>
        </Link>
        {/* Below md: the stages and End session in one More menu, so the bar stays one row. */}
        <details className="relative md:hidden">
          <summary className={`${action} cursor-pointer list-none border border-gray-300 text-gray-800`} aria-label="More for this study session">More</summary>
          <div className="absolute right-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            <ul className="space-y-1.5">
              {bar.stages.map(s => <li key={s.space} className="flex items-center justify-between gap-2"><Chip s={s} id={bar.id} current={s.space === bar.current} /><span className="text-[12px] text-gray-600">{s.detail}</span></li>)}
            </ul>
            <p className="mt-2 text-[12px] text-gray-600">{STUDY_DEVICE_NOTE}</p>
            {bar.status === "active" && <button type="button" onClick={end} disabled={busy} className={`${action} mt-2 w-full border border-gray-300 text-gray-800 disabled:opacity-50`}>{busy ? "Ending…" : "End session"}</button>}
          </div>
        </details>
        {bar.status === "active" && <button type="button" onClick={end} disabled={busy} className={`${action} hidden border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50 md:inline-flex`}>{busy ? "Ending…" : "End session"}</button>}
      </div>
      <div className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-2 md:flex">
        <ol aria-label="Stages of this session" className="flex flex-wrap gap-1.5">
          {bar.stages.map(s => <li key={s.space}><Chip s={s} id={bar.id} current={s.space === bar.current} /></li>)}
        </ol>
        <p className="text-[12px] text-gray-600">{STUDY_DEVICE_NOTE}</p>
      </div>
      {error && <p role="alert" className="mt-1.5 text-[13px] font-semibold text-red-800">{error}</p>}
    </section>
  );
}
