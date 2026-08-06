"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The console: either the consent switch, or the ask form.
//
// THE COMP'S PROMPT CHIPS ARE GONE. They read "What are the red flags for low back pain?" and "Show
// similar cases with disc herniation". The first asks the model to originate a clinical fact, which is
// the one thing this module refuses. The second is Case Memory (CPR-220), which already answers it from
// the practice's own records and can show WHY each case matched -- a better answer than a model's.
//
// THE MICROPHONE IS GONE TOO. There is no speech capability in this product, and a microphone icon that
// does nothing is a promise the page cannot keep.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-PI-001 s8's FIVE CONTEXTS ARE A SELECTOR, NOT FIVE FORMS.
//
// "Patient context... encounter context... document context... follow-up context... practice context."
// Each one is a different thing to be POINTED AT and the same question asked against it, so the form
// asks which context and then asks for the one identifier that context needs.
//
// ⚠ THERE IS STILL NO UNGROUNDED MODE, AND THE FORM SAYS SO RATHER THAN LETTING SOMEBODY DISCOVER IT AS
// AN ERROR. Four of the five contexts require an id and the button stays disabled without one. The
// fifth -- the practice's own aggregates -- needs no id because the grounding IS the practice's
// figures, and the server still refuses when there are none.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Task = { key: string; label: string; blurb: string; needs: string };
type Context = { key: string; label: string; blurb: string; param: string };

/** Which contexts each task can work from. A task asking for a consultation cannot run over a cohort. */
const TASK_CONTEXTS: Record<string, string[]> = {
  summarise_encounter: ["encounter"],
  summarise_history: ["patient"],
  draft_referral: ["encounter"],
  patient_instructions: ["encounter"],
  tidy_note: ["encounter"],
  // The one task that serves all five. See CONTEXT_KINDS in ai-assistant.ts.
  ask: ["encounter", "patient", "document", "follow_up", "practice"],
};

const LABEL: Record<string, string> = {
  encounter: "Consultation id", patient: "Patient id",
  document: "Document id", follow_up: "Follow-up id",
};

export default function AssistantConsole(props: {
  mode: "enable" | "ask";
  noticeVersion?: string;
  encounterId?: string;
  patientId?: string;
  sessionId?: string;
  /** Prefilled from the workspace's Ask field. */
  question?: string;
  /** Where to send the practitioner once an answer exists. */
  returnTo?: string;
  tasks?: Task[];
  contexts?: Context[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [task, setTask] = useState(props.encounterId ? "summarise_encounter" : "ask");
  const [context, setContext] = useState(
    props.encounterId ? "encounter" : props.patientId ? "patient" : "practice");
  const [subjectId, setSubjectId] = useState(props.encounterId ?? props.patientId ?? "");
  const [question, setQuestion] = useState(props.question ?? "");

  if (props.mode === "enable") {
    return (
      <div className="mt-3">
        <label className="flex items-start gap-2 text-[12px] text-gray-700">
          <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}
            className="mt-0.5" />
          <span>I have read the three points above and I am turning this on for the practice.</span>
        </label>
        {error && <p className="mt-2 text-[11px] text-[var(--cmp-text-danger)]">{error}</p>}
        <button
          type="button"
          // UNCHECKED MEANS UNCLICKABLE. The server refuses an unacknowledged enable as well; this only
          // saves the round trip.
          disabled={!acknowledged || busy}
          onClick={async () => {
            setBusy(true); setError(null);
            const r = await fetch("/api/v1/practice/assistant", {
              method: "PATCH", headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled: true, acknowledgedNoticeVersion: props.noticeVersion }),
            });
            setBusy(false);
            if (!r.ok) { setError((await r.json().catch(() => ({}))).error?.message ?? "could not turn it on"); return; }
            router.refresh();
          }}
          className="mt-3 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Turn on the assistant
        </button>
      </div>
    );
  }

  const chosenTask = props.tasks?.find(t => t.key === task);
  const allowed = TASK_CONTEXTS[task] ?? ["encounter"];
  // A task change can invalidate the chosen context. Corrected here rather than sent to a server that
  // would refuse it with a message about a form the practitioner cannot see.
  const activeContext = allowed.includes(context) ? context : allowed[0];
  const chosenContext = props.contexts?.find(c => c.key === activeContext);
  const needsId = activeContext !== "practice";
  const ready = !busy && (!needsId || subjectId.trim().length > 0)
    && (task !== "ask" || question.trim().length >= 3);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Ask about a record</h2>

      <div className="mt-2 flex flex-col gap-2">
        <label className="text-[11px] font-semibold text-gray-600">
          What do you want done
          <select value={task} onChange={e => setTask(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800">
            {(props.tasks ?? []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
        {chosenTask && <p className="text-[11px] text-gray-500">{chosenTask.blurb}</p>}

        <fieldset>
          <legend className="text-[11px] font-semibold text-gray-600">What should it work from</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(props.contexts ?? []).filter(c => allowed.includes(c.key)).map(c => (
              <button key={c.key} type="button" onClick={() => { setContext(c.key); setSubjectId(""); }}
                aria-pressed={c.key === activeContext}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                  c.key === activeContext
                    ? "border-sky-500 bg-sky-600 text-white"
                    : "border-gray-200 bg-white text-sky-700 hover:bg-sky-50"
                }`}>
                {c.label}
              </button>
            ))}
          </div>
          {chosenContext && <p className="mt-1 text-[11px] text-gray-500">{chosenContext.blurb}</p>}
        </fieldset>

        {needsId ? (
          <>
            <label className="text-[11px] font-semibold text-gray-600">
              {LABEL[activeContext] ?? "Record id"}
              <input value={subjectId} onChange={e => setSubjectId(e.target.value)}
                placeholder="Open the record and use Ask the assistant, or paste its id"
                className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
            </label>
            <p className="text-[11px] text-gray-500">
              Required. The assistant works from a record; without one there is nothing to reorganise and
              it would be answering from its own memory.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-gray-500">
            No id needed: the grounding is your own practice&rsquo;s counts, each one arriving with the
            calculation that produced it. If nothing about this practice can be counted yet, the
            assistant refuses rather than answering.
          </p>
        )}

        {task === "ask" && (
          <label className="text-[11px] font-semibold text-gray-600">
            Your question
            <input value={question} onChange={e => setQuestion(e.target.value)}
              placeholder={activeContext === "practice"
                ? "How many follow-ups did I close last month?"
                : "What did I decide about the physiotherapy?"}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
          </label>
        )}

        {error && <p className="text-[11px] text-[var(--cmp-text-danger)]">{error}</p>}

        <div>
          <button
            type="button"
            disabled={!ready}
            onClick={async () => {
              setBusy(true); setError(null);
              const id = subjectId.trim();
              const body: Record<string, unknown> = {
                task,
                question: question.trim() || undefined,
                sessionId: props.sessionId || undefined,
              };
              if (activeContext === "encounter") body.encounterId = id;
              if (activeContext === "patient") body.patientId = id;
              if (activeContext === "document") body.documentId = id;
              if (activeContext === "follow_up") body.followUpId = id;
              if (activeContext === "practice") body.practice = true;

              const r = await fetch("/api/v1/practice/assistant", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              });
              const payload = await r.json().catch(() => ({}));
              setBusy(false);
              if (!r.ok) { setError(payload.error?.message ?? "the assistant could not answer"); return; }
              const base = props.returnTo ?? "/practice/assistant";
              router.push(`${base}${base.includes("?") ? "&" : "?"}sessionId=${payload.sessionId}`);
              router.refresh();
            }}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
      </div>
    </section>
  );
}
