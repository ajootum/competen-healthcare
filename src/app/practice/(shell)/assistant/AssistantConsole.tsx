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

type Task = { key: string; label: string; blurb: string; needs: string };

export default function AssistantConsole(props: {
  mode: "enable" | "ask";
  noticeVersion?: string;
  encounterId?: string;
  sessionId?: string;
  tasks?: Task[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [task, setTask] = useState(props.tasks?.[0]?.key ?? "summarise_encounter");
  const [encounterId, setEncounterId] = useState(props.encounterId ?? "");
  const [question, setQuestion] = useState("");

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

  const chosen = props.tasks?.find(t => t.key === task);

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
        {chosen && <p className="text-[11px] text-gray-500">{chosen.blurb}</p>}

        <label className="text-[11px] font-semibold text-gray-600">
          Which consultation
          <input value={encounterId} onChange={e => setEncounterId(e.target.value)}
            placeholder="Open a consultation and use Ask the assistant, or paste its id"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
        </label>
        {/* THERE IS NO UNGROUNDED MODE, and the form says so rather than letting somebody discover it
            as an error. */}
        <p className="text-[11px] text-gray-500">
          Required. The assistant works from a record; without one there is nothing to reorganise and it
          would be answering from its own memory.
        </p>

        {task === "ask" && (
          <label className="text-[11px] font-semibold text-gray-600">
            Your question about that record
            <input value={question} onChange={e => setQuestion(e.target.value)}
              placeholder="What did I decide about the physiotherapy?"
              className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
          </label>
        )}

        {error && <p className="text-[11px] text-[var(--cmp-text-danger)]">{error}</p>}

        <div>
          <button
            type="button"
            disabled={busy || !encounterId.trim()}
            onClick={async () => {
              setBusy(true); setError(null);
              const r = await fetch("/api/v1/practice/assistant", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  task, encounterId: encounterId.trim(),
                  question: question.trim() || undefined,
                  sessionId: props.sessionId || undefined,
                }),
              });
              const body = await r.json().catch(() => ({}));
              setBusy(false);
              if (!r.ok) { setError(body.error?.message ?? "the assistant could not answer"); return; }
              router.push(`/practice/assistant?sessionId=${body.sessionId}`);
              router.refresh();
            }}
            className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
      </div>
    </section>
  );
}
