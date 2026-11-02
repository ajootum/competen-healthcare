"use client";

import Link from "next/link";
import { useState } from "react";
import { Btn, focusRing, mutedText } from "@/components/assessment/ui";
import { AskAbout } from "../../(app)/[experience]/(scholar)/study/_components/ask-panel";
import { learningLinks } from "@/lib/assessment/adapters/scholar/compare";

// What a learner can DO about a gap or a difference, through functions that already exist: Learn on the competency, Revise, Apply, Evaluate, "Ask about
// this" (the Personal AI panel, with the criterion wording as its context) and "Add to My Plan" (a study session in the learner's own calendar, linked
// to the competency). Nothing here changes a rating, and nothing here is an assessment.

const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function AddToPlan({ competencyId, title }: { competencyId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(tomorrow);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  async function add() {
    setState("busy"); setMessage("");
    try {
      const res = await fetch("/api/individual/scholar/plan/entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryType: "study_session", title: `Study ${title}`.slice(0, 120), entryDate: date, durationMinutes: 30, link: { kind: "competency", id: competencyId, label: title.slice(0, 190) } }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { setState("done"); setMessage("Added to My Plan."); return; }
      setState("error"); setMessage(typeof json.error === "string" ? json.error : "It could not be added just now.");
    } catch { setState("error"); setMessage("It could not be added just now. Check your connection."); }
  }
  if (!open) return <Btn size="sm" onClick={() => setOpen(true)}>Add to My Plan</Btn>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label className={`flex items-center gap-1.5 text-[12.5px] ${mutedText}`}>
        <span>Study on</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="min-h-9 rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-2 text-[13px] text-[var(--cmp-app-text)] pointer-coarse:min-h-[var(--cmp-touch-min)]" />
      </label>
      <Btn size="sm" kind="primary" disabled={state === "busy" || state === "done"} onClick={add}>{state === "busy" ? "Adding..." : "Add"}</Btn>
      {message && <span role={state === "error" ? "alert" : "status"} className={`text-[12.5px] ${state === "error" ? "text-[var(--cmp-text-error)]" : mutedText}`}>{message}</span>}
    </span>
  );
}

export default function GapActions({ competencyId, title, wording, myPlanOn, study }: { competencyId: string; title: string; wording?: string | null; myPlanOn: boolean; study: string | null }) {
  const links = learningLinks(competencyId, study);
  const refLabel = `Self-assessment: ${title}`.slice(0, 120);
  const prefill = wording ? `Help me understand and improve this criterion: ${wording}`.slice(0, 400) : `Help me understand what to practise to improve at ${title}.`;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`Next steps for ${title}`}>
      {links.map(l => (
        <Link key={l.key} href={l.href} className={`inline-flex min-h-9 items-center rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-3 text-[13px] font-semibold text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{l.label}</Link>
      ))}
      <AskAbout surface="learn" refLabel={refLabel} prefill={prefill} label="Ask about this" />
      {myPlanOn && <AddToPlan competencyId={competencyId} title={title} />}
    </div>
  );
}
