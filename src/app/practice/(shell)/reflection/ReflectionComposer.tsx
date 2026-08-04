"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The composer.
//
// SIX WAYS TO START A REFLECTION IN THE COMP; TWO OF THEM CANNOT BE HONOURED.
//   From Recent Encounter · From Procedure · General Reflection   -- all three are this one form, with
//                                                                    or without something attached.
//   AI Guided Reflection    -- the four questions it would generate are constants. They are below.
//   Voice Reflection        -- "speak your reflection and we'll transcribe" implies a transcription
//                              service. There is none. CPR-130's dictation is the browser's own
//                              recogniser, and in Chrome the audio goes to the browser vendor -- which
//                              is a disclosure worth making deliberately against a clinical note, and
//                              not one to make silently against a private reflection.
//   Upload Reflection       -- there is no file storage in this product (CPR-320 said so and meant it).
//
// The two refusals are stated on the form rather than left as buttons that do nothing.

type Prompt = { field: string; label: string; hint: string };

export default function ReflectionComposer(props: {
  encounterId: string;
  categories: { key: string; label: string }[];
  prompts: Prompt[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(props.categories[0]?.key ?? "clinical_outcome");
  const [encounterId, setEncounterId] = useState(props.encounterId);
  const [values, setValues] = useState<Record<string, string>>({});

  const written = Object.values(values).join("").trim().length;

  if (!open) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <h2 className="text-[13px] font-bold text-gray-900">Write a reflection</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Four questions, a couple of minutes, and nobody else sees it unless you say so.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white">
            Start
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Write a reflection</h2>

      <div className="mt-2 grid sm:grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-gray-600">
          What kind
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800">
            {props.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          About a consultation (optional)
          <input value={encounterId} onChange={e => setEncounterId(e.target.value)}
            placeholder="Leave blank to reflect on the week"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
        </label>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {props.prompts.map(p => (
          <label key={p.field} className="text-[11px] font-semibold text-gray-600">
            {p.label}
            <span className="ml-1 font-normal text-gray-400">{p.hint}</span>
            <textarea
              rows={2}
              value={values[p.field] ?? ""}
              onChange={e => setValues(v => ({ ...v, [p.field]: e.target.value }))}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800"
            />
          </label>
        ))}
      </div>

      {error && <p className="mt-2 text-[11px] text-[var(--cmp-text-danger)]">{error}</p>}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          // TWENTY CHARACTERS ACROSS EVERYTHING, matched by the engine and by a database constraint. An
          // empty reflection would still count on a page somewhere.
          disabled={busy || written < 20}
          onClick={async () => {
            setBusy(true); setError(null);
            const camel = (f: string) => f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            const r = await fetch("/api/v1/practice/reflections", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({
                category, encounterId: encounterId.trim() || undefined,
                ...Object.fromEntries(Object.entries(values).map(([k, v]) => [camel(k), v])),
              }),
            });
            const body = await r.json().catch(() => ({}));
            setBusy(false);
            if (!r.ok) { setError(body.error?.message ?? "it could not be saved"); return; }
            setValues({}); setOpen(false); router.refresh();
          }}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save, privately"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        {written > 0 && written < 20 && (
          <span className="text-[10px] text-gray-500">a little more &mdash; {20 - written} characters</span>
        )}
      </div>

      <p className="mt-2 text-[10px] text-gray-500">
        Saved privately. You can share it, or lock it so you cannot change it later &mdash; both are your
        choice and neither happens on its own. The design also offers voice capture and file upload;
        there is no transcription service and no file storage here, so neither is offered.
      </p>
    </section>
  );
}
