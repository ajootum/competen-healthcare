"use client";

import { useState } from "react";
import { AI_DRAFT_MODES, AI_DRAFT_TASKS } from "@/lib/practice/documents-workspace-constants";

// CPR-DOC-002 s12, PHASE 3: ASK THE ASSISTANT FOR A DRAFT.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS PANEL IS DRAWN ONLY WHEN IT WOULD WORK. The server decides -- draftAvailability() -- and when
// the answer is no, the page renders NOTHING rather than a greyed-out button with an apology under it.
// s18 forbids "not built" messages in production UI and this codebase forbids controls that do nothing;
// not drawing the control is the single move that satisfies both. The two cases that DO produce a
// sentence are the two a reader can act on: this document is not linked to a consultation, and the
// practice has not switched the assistant on.
//
// ⚠ IT IMPORTS FROM documents-workspace-constants.ts AND NOTHING ELSE. The engine imports the AI client
// and the audit writer, both of which reach the server.
//
// ⚠ WHAT THIS PANEL SAYS BEFORE IT RUNS, AND WHY IT SAYS IT EVERY TIME. Pressing this sends the content
// of the consultation -- the patient's details and the clinical notes -- to a model provider outside
// this system. CPR-210 records that disclosure in the access log as an export. A practitioner should not
// have to remember which buttons do that.
//
// ⚠ AND WHAT IT SAYS AFTER. If the attribution did not reach the audit trail, the text is in the
// document and nothing anywhere records that a machine wrote it -- which is precisely the state s12's
// labelling rule exists to prevent. That is rendered in red rather than swallowed.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function AiDraftPanel({ documentId, hasBody, provider, model, blocker, available }: {
  documentId: string;
  hasBody: boolean;
  provider: string | null;
  model: string | null;
  blocker: string | null;
  available: boolean;
}) {
  const [task, setTask] = useState(AI_DRAFT_TASKS[0].key);
  const [mode, setMode] = useState<"replace" | "append">(hasBody ? "append" : "replace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // The one honest sentence, on the one document it is about. Not a feature announcement.
  if (!available)
    return blocker ? (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Drafting help</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-500">{blocker}</p>
      </section>
    ) : null;

  async function run() {
    setBusy(true); setError(null); setWarning(null);
    try {
      const res = await fetch("/api/v1/practice/documents/ai-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, task, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error?.message ?? data?.error ?? "That did not work."); return; }
      if (data?.draft?.attributionRecorded === false) {
        // ⚠ NO RELOAD. The one message a practitioner must read before they look at the text is this one,
        // and a reload would throw it away.
        setWarning(
          "The draft was written into this document and the record of where it came from DID NOT SAVE. "
          + "Nothing in this system now says these words were machine-written. Rewrite them yourself, or "
          + "clear the body and try again, before marking this ready.",
        );
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  }

  const chosen = AI_DRAFT_TASKS.find(t => t.key === task);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Drafting help</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
        The assistant rewrites what the consultation behind this document already records. It does not
        add clinical facts, and it never signs anything.
      </p>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">What to write</span>
        <select
          value={task} onChange={e => setTask(e.target.value)}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--cp-primary)]"
        >
          {AI_DRAFT_TASKS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      {chosen && <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{chosen.blurb}</p>}

      {hasBody && (
        <fieldset className="mt-3">
          <legend className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500">
            There is already text here
          </legend>
          {AI_DRAFT_MODES.map(m => (
            <label key={m.key} className="mt-1 flex items-start gap-1.5">
              <input
                type="radio" name="ai-mode" value={m.key} checked={mode === m.key}
                onChange={() => setMode(m.key as "replace" | "append")}
                className="mt-0.5 accent-[var(--cp-primary)]"
              />
              <span>
                <span className="text-[12px] font-semibold text-gray-800">{m.label}</span>
                <span className="block text-[10.5px] text-gray-500">{m.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <button
        type="button" onClick={run} disabled={busy}
        className="mt-3 w-full rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-40"
      >
        {busy ? "Writing…" : "Write a draft"}
      </button>

      {/* THE DISCLOSURE, EVERY TIME, BESIDE THE BUTTON THAT PERFORMS IT. */}
      <p className="mt-2 text-[10.5px] leading-relaxed text-gray-500">
        This sends the consultation behind this document &mdash; the patient&rsquo;s details and the
        clinical notes &mdash; to {provider ?? "a model provider"} outside this system, and records that
        it did so in this practice&rsquo;s access log.
        {model ? ` The model is ${model}.` : ""} What comes back is a draft, it is labelled as
        machine-written until you edit it, and it can never be signed by anything but a person.
      </p>

      {error && <p className="mt-2 text-[11.5px] font-semibold text-rose-700">{error}</p>}
      {warning && (
        <p className="mt-2 rounded-lg border border-rose-400 bg-rose-50 px-2.5 py-2 text-[11.5px] font-semibold text-rose-800">
          {warning}
        </p>
      )}
    </section>
  );
}
