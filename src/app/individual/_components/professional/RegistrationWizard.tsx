"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { primaryBtn, secondaryBtn } from "../chrome";
import ContextField, { type FieldProps } from "./ContextField";

// THE PROFESSIONAL REGISTRATION FORM -- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, GO s3 and s9.
//
// Three steps at most: the three required facts, the optional questions configuration asks (skippable), and a
// review that enters Professional. Every step is saved to the server when the person moves on, so leaving at
// any point keeps what they gave and the form resumes there. Progress is said in words, not colour alone.
// Nothing here asks for a registration number, a licence, an employment record or a document.

export type WizardStep = { key: "profession" | "practice" | "review"; title: string; fields: FieldProps[] };

export default function RegistrationWizard({ steps, resumeAt, accent, review }: {
  steps: WizardStep[]; resumeAt: WizardStep["key"]; accent: string;
  /** What is on record, for the review step: label and value (null = not given). */
  review: { label: string; value: string | null; required: boolean }[];
}) {
  const router = useRouter();
  const [at, setAt] = useState(Math.max(0, steps.findIndex(s => s.key === resumeAt)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const step = steps[at];

  async function save(body: Record<string, unknown>, after: "next" | "stay" | "enter") {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/context", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Try again shortly." }); return; }
      if (after === "stay") setMsg({ ok: true, text: "Saved. You can come back and continue at any time." });
      if (after === "next") setAt(i => Math.min(steps.length - 1, i + 1));
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection and try again." }); } finally { setBusy(false); }
  }

  const collect = (form: HTMLFormElement) =>
    ({ step: step.key, ...Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => typeof v === "string")) });

  const missing = review.filter(r => r.required && !r.value);

  return (
    <section aria-labelledby="reg-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="reg-h" className="text-[18px] font-bold text-gray-900">Establish your professional identity</h2>
      <p className="mt-1 text-[14px] text-gray-600">A few details about your practice, in your own words. Everything else can wait: you can add qualifications, registrations and your history later.</p>

      <ol aria-label="Registration progress" className="mt-4 flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={i === at ? "step" : undefined}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${i === at ? "text-white" : i < at ? "border-gray-300 text-gray-800" : "border-gray-200 text-gray-500"}`}
            style={i === at ? { background: accent, borderColor: accent } : undefined}>
            <span className="sr-only">{i < at ? "Done: " : i === at ? "Current: " : "Next: "}</span>
            Step {i + 1} of {steps.length} · {s.title}
          </li>
        ))}
      </ol>

      {step.key !== "review" ? (
        <form key={step.key} onSubmit={e => { e.preventDefault(); save(collect(e.currentTarget), "next"); }} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">{step.fields.map(f => <ContextField key={f.name} {...f} />)}</div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Save and continue"}</button>
            <button type="button" disabled={busy} className={secondaryBtn}
              onClick={e => { const form = e.currentTarget.form; if (form) save(collect(form), "stay"); }}>
              Save and finish later
            </button>
            {step.key === "practice" && !step.fields.some(f => f.required) && (
              <button type="button" disabled={busy} className={secondaryBtn} onClick={() => save({ step: "practice", skip: true }, "next")}>Skip for now</button>
            )}
            {at > 0 && <button type="button" disabled={busy} className="text-[13.5px] font-semibold text-gray-700 underline-offset-2 hover:underline" onClick={() => setAt(i => i - 1)}>Back</button>}
          </div>
        </form>
      ) : (
        <div className="mt-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {review.map(r => (
              <div key={r.label}>
                <dt className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{r.label}</dt>
                <dd className="text-[14.5px] text-gray-900">{r.value ?? <span className="text-gray-500">{r.required ? "Needed" : "Skipped. You can add it later."}</span>}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[12.5px] text-gray-500">Self-declared. Competen has not checked these against any register, and shows them as recorded by you.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || missing.length > 0} className={primaryBtn} style={{ background: accent }} onClick={() => save({ step: "review", complete: true }, "enter")}>
              {busy ? "Saving…" : "Enter Competen Professional"}
            </button>
            <button type="button" disabled={busy} className="text-[13.5px] font-semibold text-gray-700 underline-offset-2 hover:underline" onClick={() => setAt(0)}>Change my answers</button>
          </div>
          {missing.length > 0 && <p role="alert" className="mt-2 text-[13.5px] text-red-700">Still needed: {missing.map(m => m.label).join(", ")}.</p>}
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}
