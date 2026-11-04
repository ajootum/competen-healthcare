"use client";

import { useState } from "react";
import { TIMELINE_DEFAULT_COSTS, type Timeline } from "@/lib/cases/timeline";

// LEARNING-CLOSE-2026-11 CE-04C: authoring a case version's deterioration timeline in Case Studio. The timeline is part of the
// blueprint, so it is saved with the draft, checked by validateBlueprint on save and on submission, and approved with the exact
// version by the clinical reviewer (422). It is written as structured text (JSON) with an example to start from; nothing in it is
// generated. The case plays it only in the library, and only where HQ has switched scholar_case_deterioration on.

const EXAMPLE: Timeline = {
  costs: { ...TIMELINE_DEFAULT_COSTS },
  optionMinutes: [],
  events: [{ id: "t1", at: 15, label: "His breathing is faster and he is drowsier", updates: [{ factId: "f_rr", value: "32" }], reveals: [] }],
  escalation: [{ id: "w1", label: "Call for an urgent medical review", escalate: [{ decisionPointId: "d2", optionIds: ["a"] }], closesAt: 20, safetyCritical: true }],
};

export function TimelineField({ value, onChange, input, small, ghost }: { value: Timeline | null | undefined; onChange: (t: Timeline | null) => void; input: string; small: string; ghost: string }) {
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ""));
  const [error, setError] = useState("");
  const apply = () => {
    if (!text.trim()) { setError(""); onChange(null); return; }
    try {
      const t = JSON.parse(text);
      if (!t || typeof t !== "object" || Array.isArray(t)) { setError("The timeline is one object with events and escalation lists."); return; }
      setError(""); onChange(t as Timeline);
    } catch { setError("That is not valid structured text (JSON). Check the commas and quotes."); }
  };
  return (
    <fieldset className="rounded-lg border border-gray-200 p-3 text-[12.5px]">
      <legend className={small}>Deterioration timeline (optional, server-side only, approved with this version)</legend>
      <p className={small}>
        Observations that change as simulated time passes, and the escalation the case expects by a given minute. Simulated time moves on only with what
        the learner does: each decision ({TIMELINE_DEFAULT_COSTS.answer} min by default), each finding asked for ({TIMELINE_DEFAULT_COSTS.reveal} min) and each question
        to the patient ({TIMELINE_DEFAULT_COSTS.talkTurn} min), plus any minutes you give a choice (optionMinutes, e.g. &quot;recheck in 30 minutes&quot;). Only an observation,
        examination or result may change. The learner never sees an event before its minute or a window before the case ends.
      </p>
      <label className="mt-2 block font-semibold text-gray-800">Timeline (JSON)
        <textarea rows={10} spellCheck={false} className={`${input} mt-1 block w-full font-mono text-[12px]`} value={text} onChange={e => setText(e.target.value)} onBlur={apply} />
      </label>
      {error && <p role="alert" className="mt-1 font-semibold text-red-800">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={ghost} onClick={apply}>Use this timeline</button>
        {!text.trim() && <button type="button" className={ghost} onClick={() => setText(JSON.stringify(EXAMPLE, null, 2))}>Start from an example</button>}
        {text.trim() && <button type="button" className={ghost} onClick={() => { setText(""); setError(""); onChange(null); }}>Remove the timeline</button>}
      </div>
    </fieldset>
  );
}
