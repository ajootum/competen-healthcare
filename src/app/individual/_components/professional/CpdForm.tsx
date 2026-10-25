"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_MAX_LABEL } from "@/lib/individual/professional/vocabulary";
import type { CpdOptions } from "./edit-forms";
import { focusRing, primaryBtn } from "../chrome";
import { Field, RefusalNote, inputCls, refusalMsg, type RefusalMsg } from "./forms";
import { experienceHref } from "@/lib/individual/experiences";
import { aiNotice } from "./ai-refusal";

// The CPD entry form, with reflection drafting (COMPETEN-IND-007 s4 and s7).
//
// "Draft with AI" sends the activity's name, type and whatever the person has typed in the reflection box
// to the Professional assistant, and puts the draft INTO THE BOX for them to edit. It is saved only if they
// press "Add to my CPD log" -- the AI writes nothing, and an unedited draft is labelled as one until then.

export default function CpdForm({ accent, today, goals, options }: { accent: string; today: string; goals: { id: string; title: string }[]; options: CpdOptions }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [reflection, setReflection] = useState("");
  const [drafted, setDrafted] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; continuity?: boolean } | null>(null);
  // A refused save (a course already in the record through Competen Learning), with its link and override.
  const [refused, setRefused] = useState<RefusalMsg | null>(null);

  async function draft() {
    const f = ref.current; if (!f) return;
    const title = (f.elements.namedItem("title") as HTMLInputElement).value;
    const activityType = (f.elements.namedItem("activityType") as HTMLSelectElement).value;
    setDrafting(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "reflection", title, activityType, notes: reflection }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, ...aiNotice(j, "The assistant could not draft a reflection just now. You can write it yourself.") });
      else { setReflection(j.answer ?? ""); setDrafted(true); }
    } catch { setMsg({ ok: false, text: "The assistant could not be reached." }); } finally { setDrafting(false); }
  }

  async function submit(e: React.FormEvent<HTMLFormElement> | null, overrideField?: string) {
    e?.preventDefault();
    const form = ref.current; if (!form) return;
    setBusy(true); setMsg(null); setRefused(null);
    const fd = new FormData(form);
    if (overrideField) fd.set(overrideField, "yes");
    try {
      const res = await fetch("/api/individual/professional/cpd", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { if (j?.override) setRefused(refusalMsg(j, "That could not be saved.")); else setMsg({ ok: false, text: j?.error ?? "That could not be saved." }); return; }
      ref.current?.reset(); setReflection(""); setDrafted(false);
      // A link to the plan that failed after the entry was saved: the entry stays, and the person is told.
      if (typeof j.planNote === "string") setMsg({ ok: false, text: j.planNote });
      else setMsg({ ok: true, text: j.evidenceClass === "source_linked" ? "Added, with your document attached." : "Added." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <form ref={ref} onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What did you do?" htmlFor="cpd-title"><input id="cpd-title" name="title" required minLength={3} maxLength={200} className={inputCls} placeholder="e.g. Sepsis recognition workshop" /></Field>
        <Field label="Kind of activity" htmlFor="cpd-type">
          <select id="cpd-type" name="activityType" required className={inputCls} defaultValue={options.types.some(t => t.code === "course") ? "course" : options.types[0]?.code}>
            {options.types.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="When did it happen?" htmlFor="cpd-date" hint="The date of the activity. You can record it any time after."><input id="cpd-date" name="activityDate" type="date" required max={today} defaultValue={today} className={inputCls} /></Field>
        <Field label={options.flexible ? "Hours (optional)" : "Hours"} htmlFor="cpd-hours"><input id="cpd-hours" name="hours" type="number" required={!options.flexible} min={0.1} max={1000} step={0.1} inputMode="decimal" className={inputCls} /></Field>
        <Field label={options.flexible ? "CPD credits (optional)" : "CPD points (optional)"} htmlFor="cpd-points" hint="Only if the provider awarded them."><input id="cpd-points" name="cpdPoints" type="number" min={0} max={1000} step={options.flexible ? 0.1 : 1} inputMode="decimal" className={inputCls} /></Field>
        <Field label="Provider (optional)" htmlFor="cpd-provider"><input id="cpd-provider" name="provider" maxLength={160} className={inputCls} /></Field>
        <Field label="Goal in your plan (optional)" htmlFor="cpd-goal" hint={options.plan ? "Linked in your development plan. You can add more goals from the entry." : undefined}>
          <select id="cpd-goal" name="goalId" className={inputCls} defaultValue="">
            <option value="">Not linked to a goal</option>
            {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        {options.plan && options.plan.activities.length > 0 && (
          <Field label="Planned activity it completes (optional)" htmlFor="cpd-activity" hint="Marks that activity in your plan as done, pointing at this entry.">
            <select id="cpd-activity" name="activityId" className={inputCls} defaultValue="">
              <option value="">None</option>
              {options.plan.activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Certificate (optional)" htmlFor="cpd-doc" hint={`PDF or image, up to ${DOCUMENT_MAX_LABEL}. Attaching it does not verify the entry.`}>
          <input id="cpd-doc" name="document" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className={`${inputCls} py-2.5`} />
        </Field>
      </div>
      <Field label="Reflection (optional)" htmlFor="cpd-reflection" hint="What you learned and how it changes your practice. Never include patient-identifiable details.">
        <textarea id="cpd-reflection" name="reflection" rows={6} maxLength={5000} value={reflection}
          onChange={e => { setReflection(e.target.value); }} className={inputCls} />
      </Field>
      {drafted && <p className="text-[12.5px] font-medium text-gray-600">✦ AI draft from your notes only. Edit it so it is yours. Nothing is saved until you add the entry.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Add to my CPD log"}</button>
        <button type="button" onClick={draft} disabled={drafting}
          className={`inline-flex min-h-[44px] items-center rounded-xl border border-gray-300 bg-white px-4 text-[14px] font-semibold hover:bg-gray-50 disabled:opacity-50 ${focusRing}`} style={{ color: accent }}>
          {drafting ? "Drafting…" : "✦ Draft the reflection with AI"}
        </button>
        {refused && <RefusalNote msg={refused} busy={busy} onOverride={f => void submit(null, f)} />}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}{msg.continuity && <> <a href={experienceHref("professional", "ai-allowance")} className="font-semibold underline underline-offset-2">See your AI allowance</a></>}</p>}
      </div>
    </form>
  );
}
