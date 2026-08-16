"use client";

import { useState } from "react";
import { STAGE_COMPLETION_RULES } from "@/lib/practice/pathways-constants";
import { FOLLOW_UP_CATEGORIES, FOLLOW_UP_PRIORITIES } from "@/lib/practice/follow-up-constants";
import { BUTTON } from "@/lib/practice/palette";

// CPR-FUP-003 s5 -- authoring a template. `pathway.design`, which is a different capability from
// `pathway.assign`: configuring the practice and making a clinical decision are different acts.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ TIMING IS AN OFFSET IN DAYS FROM THE PREVIOUS STAGE, NOT A DATE.
//
// s6's example is "review after 2 weeks", "after 3 months". A template cannot know when a patient will
// actually reach stage 2, and dating stage 3 from the pathway's start would put a patient who arrived
// three weeks late permanently behind a schedule describing a journey nobody took. The offset is
// applied to the day the patient really got there.
//
// ⚠ A STAGE THAT RAISES NOTHING IS ALLOWED AND IS THE DEFAULT FOR THE FIRST. "Procedure completed" is a
// milestone, not an obligation -- forcing every stage to raise a follow-up would put a review on the
// board for something that has already happened.
//
// THE COMPLETION RULE IS AN EXPECTATION, NOT A GATE. Whatever it says, a practitioner can always advance
// the stage by hand -- s8 lists manual advance as a peer of the three automatic routes, and s2 forbids
// protocol enforcement.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type StageDraft = {
  name: string; offsetDays: number; requiredAction: string;
  completionRule: string; followUpKind: string; followUpPriority: string;
};

const blankStage = (): StageDraft => ({
  name: "", offsetDays: 30, requiredAction: "",
  completionRule: "encounter", followUpKind: "review", followUpPriority: "routine",
});

export default function TemplateDesigner({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [entryCriteria, setEntryCriteria] = useState("");
  const [exitCriteria, setExitCriteria] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([{ ...blankStage(), offsetDays: 0, followUpKind: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStage = (i: number, patch: Partial<StageDraft>) =>
    setStages(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/v1/practice/pathways", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, specialty: specialty || null,
        entryCriteria: entryCriteria || null, exitCriteria: exitCriteria || null,
        stages: stages.map(s => ({
          name: s.name, offsetDays: Number(s.offsetDays),
          requiredAction: s.requiredAction || null,
          completionRule: s.completionRule,
          followUpKind: s.followUpKind || null,
          followUpPriority: s.followUpKind ? s.followUpPriority : null,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data?.error?.message ?? "That did not work."); setBusy(false); return; }
    window.location.reload();
  }

  const field = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
  const small = "rounded-lg border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-[var(--cp-primary)]";

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-3">
      <h2 className="text-[13px] font-bold text-gray-900">New pathway template</h2>
      <p className="mt-0.5 max-w-3xl text-[11.5px] leading-relaxed text-gray-500">
        A sequence of stages with timing. Each stage&rsquo;s date is worked out from the day the patient
        actually reaches the stage before it &mdash; so a patient who arrives late is not permanently
        behind a schedule nobody kept.
      </p>

      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Name</span>
          <input required value={name} onChange={e => setName(e.target.value)} className={field} placeholder="VP Shunt follow-up" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Specialty (optional)</span>
          <input value={specialty} onChange={e => setSpecialty(e.target.value)} className={field} placeholder="Paediatric neurosurgery" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Entry criteria</span>
          <input value={entryCriteria} onChange={e => setEntryCriteria(e.target.value)} className={field}
            placeholder="Shunt inserted or revised" />
          <span className="text-[10.5px] text-gray-400">
            ⚠ Text somebody reads before assigning. It is never evaluated &mdash; a machine-checked
            criterion would decide who goes on this plan, and that is a practitioner&rsquo;s decision.
          </span>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-gray-600">Exit criteria</span>
          <input value={exitCriteria} onChange={e => setExitCriteria(e.target.value)} className={field}
            placeholder="Five years of stable surveillance" />
        </label>
      </div>

      <h3 className="mt-3 text-[12px] font-bold text-gray-800">Stages</h3>
      <ol className="mt-1.5 flex flex-col gap-2">
        {stages.map((s, i) => (
          <li key={i} className="rounded-lg border border-gray-200 bg-white p-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--cp-primary)]/12 text-[12px] font-bold text-[var(--cp-primary-deep)]">
                {i + 1}
              </span>
              <label className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                <span className="text-[10.5px] font-semibold text-gray-600">Stage name</span>
                <input required value={s.name} onChange={e => setStage(i, { name: e.target.value })} className={small}
                  placeholder={i === 0 ? "Procedure completed" : "Review after 3 months"} />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10.5px] font-semibold text-gray-600">
                  {i === 0 ? "Days after assignment" : "Days after the previous stage"}
                </span>
                <input type="number" min={0} max={3650} value={s.offsetDays}
                  onChange={e => setStage(i, { offsetDays: Number(e.target.value) })} className={`${small} w-28`} />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10.5px] font-semibold text-gray-600">Closed by</span>
                <select value={s.completionRule} onChange={e => setStage(i, { completionRule: e.target.value })} className={small}>
                  {STAGE_COMPLETION_RULES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10.5px] font-semibold text-gray-600">Raises</span>
                <select value={s.followUpKind} onChange={e => setStage(i, { followUpKind: e.target.value })} className={small}>
                  <option value="">Nothing</option>
                  {FOLLOW_UP_CATEGORIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </select>
              </label>
              {s.followUpKind && (
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] font-semibold text-gray-600">Priority</span>
                  <select value={s.followUpPriority} onChange={e => setStage(i, { followUpPriority: e.target.value })} className={small}>
                    {FOLLOW_UP_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
              )}
              {stages.length > 1 && (
                <button type="button" onClick={() => setStages(x => x.filter((_, j) => j !== i))}
                  className="ml-auto rounded border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
                  Remove
                </button>
              )}
            </div>
            <label className="mt-1.5 flex flex-col gap-0.5">
              <span className="text-[10.5px] font-semibold text-gray-600">What has to happen (optional)</span>
              <input value={s.requiredAction} onChange={e => setStage(i, { requiredAction: e.target.value })} className={small}
                placeholder="Shunt series and head circumference" />
            </label>
            <p className="mt-1 text-[10.5px] text-gray-400">
              &ldquo;Closed by&rdquo; records what was expected to settle this stage. Whatever it says, this
              stage can always be advanced, skipped, repeated, delayed or cancelled by hand.
            </p>
          </li>
        ))}
      </ol>

      <button type="button" onClick={() => setStages(s => [...s, blankStage()])}
        className={`mt-2 rounded-lg px-2.5 py-1 text-[12px] font-semibold ${BUTTON.quiet}`}>
        + Add a stage
      </button>

      {error && <p className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.primary}`}>
          Create template
        </button>
        <button type="button" onClick={onClose} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${BUTTON.quiet}`}>
          Cancel
        </button>
      </div>
    </form>
  );
}
