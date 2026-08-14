"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES } from "@/lib/practice/follow-up-constants";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP PLAN TEMPLATE AUTHORING -- THE SCREEN THAT WAS THE REAL BLOCKER ON PLANS.
//
// ⚠ THE ENGINE AND THE API HAVE BEEN COMPLETE SINCE MIGRATION 206, AND NOTHING COULD REACH THEM.
// createPlanTemplate, setTemplateActive and listPlanTemplates had zero UI callers; migration 206 seeds
// no templates; so the encounter tab's "Or apply a plan" control -- wired weeks later -- was invisible
// in every practice, because no practice could ever have a template. The whole feature was one screen
// away from existing, and this is the screen.
//
// ⚠ A TEMPLATE IS A WORKFLOW SHORTCUT, NOT CLINICAL GUIDANCE, and the words on this screen keep saying
// so. Applying one raises ordinary follow-ups, each its own obligation, each removable. Competen ships
// none and recommends none: every template here was written by somebody in this practice, and the
// screen names that provenance rather than letting a supplied-looking list accrue false authority.
//
// ⚠ OFFSETS ARE FROM THE PLAN'S START, NOT FROM THE PREVIOUS STEP. The engine is built that way
// (dueDateFrom(startsOn, offsetDays) per step) and the copy under the field says it, because "2 weeks,
// then 6 weeks" reads equally as cumulative -- and a wound-review plan misread cumulatively books its
// six-week check at eight.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

type Step = { offsetDays: string; reason: string; kind: string; priority: string };

type Template = {
  id: string; code: string; title: string; description: string | null; active: boolean;
  steps: { position: number; offset_days: number; reason: string; kind: string; priority: string }[];
};

const input =
  "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const LABEL = "text-[10.5px] font-semibold uppercase tracking-wide text-gray-600";
const QUIET =
  "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const AMBER = "border-amber-300 bg-[var(--cmp-surface-warning)]";

const KIND_LABEL = Object.fromEntries(FOLLOW_UP_KINDS as readonly (readonly [string, string])[]);

/** The engine's own slug rule, mirrored so the code shown is the code stored. */
const slugOf = (title: string) => title.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");

const newStep = (): Step => ({ offsetDays: "", reason: "", kind: "review", priority: "routine" });

export default function TemplateStudio(props: { templates: Template[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [authoring, setAuthoring] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [steps, setSteps] = useState<Step[]>([newStep()]);

  const active = props.templates.filter(t => t.active);
  const retired = props.templates.filter(t => !t.active);

  // ── THE ENGINE'S RULES, MIRRORED FIELD BY FIELD ─────────────────────────────────────────────────
  //
  // ⚠ EVERY CHECK BELOW IS A COPY OF ONE IN validateSteps() OR createPlanTemplate(), AND NONE IS AN
  // INVENTION. The server still rules; this is s17-style pre-emption so the refusal is worn by the
  // field that causes it -- today's Follow-up composer lesson, applied on the day it was learned.
  const stepIssue = (s: Step): string | null => {
    if (!s.reason.trim()) return "say what this step is for";
    const n = Number(s.offsetDays);
    if (s.offsetDays.trim() === "" || !Number.isInteger(n) || n < 0)
      return "a whole number of days, 0 or more";
    if (n > 3650) return "beyond ten years is almost certainly a typo";
    return null;
  };
  const offsets = steps.map(s => Number(s.offsetDays));
  const duplicateOffsets = new Set(offsets.filter((d, i) => !Number.isNaN(d) && offsets.indexOf(d) !== i));
  const blocked =
    !form.title.trim() ? "Give the plan a title."
      : steps.some(s => stepIssue(s) !== null) ? "Finish the amber step fields."
        : duplicateOffsets.size > 0 ? "Two steps fall on the same day; give them different offsets."
          : null;

  async function create() {
    if (blocked) return;
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/follow-up-plans", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: {
            code: slugOf(form.title), title: form.title, description: form.description.trim() || undefined,
            steps: steps.map(s => ({
              offsetDays: Number(s.offsetDays), reason: s.reason, kind: s.kind, priority: s.priority,
            })),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: data?.error?.message ?? "That template was not created." });
        return;
      }
      setAuthoring(false);
      setForm({ title: "", description: "" });
      setSteps([newStep()]);
      setNotice({ kind: "ok", text: "Template created. It is now offered wherever plans are applied." });
      router.refresh();
    } finally { setBusy(false); }
  }

  async function setActive(templateId: string, activeNow: boolean) {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/follow-up-plans", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, active: activeNow }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: "err", text: data?.error?.message ?? "That was not changed." });
        return;
      }
      // ⚠ RETIRING TOUCHES NO EXISTING PLAN. The engine leaves running plans exactly as they are; a
      // retired template only stops being offered for NEW ones -- and the notice says so, because
      // "retire" otherwise reads as something happening to patients.
      setNotice({
        kind: "ok",
        text: activeNow
          ? "Restored. It is offered again for new plans."
          : "Retired. Plans already running from it are untouched; it is no longer offered for new ones.",
      });
      router.refresh();
    } finally { setBusy(false); }
  }

  const templateCard = (t: Template) => (
    <li key={t.id} className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-semibold text-gray-900">{t.title}</span>
        <span className="font-mono text-[10px] text-gray-500">{t.code}</span>
        {!t.active && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">retired</span>
        )}
        {props.canManage && (
          <button type="button" disabled={busy} onClick={() => setActive(t.id, !t.active)}
            className={`ml-auto ${QUIET}`}>
            {t.active ? "Retire" : "Restore"}
          </button>
        )}
      </div>
      {t.description && <p className="mt-1 text-[12px] text-gray-600">{t.description}</p>}
      {/* The steps ARE the template, so the card shows them rather than a count nobody can review. */}
      <ul className="mt-2 flex flex-col gap-1">
        {t.steps.map(s => (
          <li key={s.position} className="flex items-baseline gap-2 text-[12px] text-gray-700">
            <span className="w-16 shrink-0 font-mono text-[11px] text-gray-500">
              {s.offset_days === 0 ? "day 0" : `+${s.offset_days}d`}
            </span>
            <span className="min-w-0">{s.reason}</span>
            <span className="ml-auto shrink-0 text-[10.5px] text-gray-500">
              {KIND_LABEL[s.kind] ?? s.kind}{s.priority !== "routine" ? ` · ${s.priority}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );

  return (
    <div className="mt-3 flex flex-col gap-3">
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">This practice&apos;s plans</h2>
        {active.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-600">
            None yet. Competen supplies no plan templates &mdash; a review schedule is a clinical
            judgement, so every plan here is written by this practice. Write the first one below.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">{active.map(templateCard)}</ul>
        )}
        {retired.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              {retired.length} retired
            </summary>
            <ul className="mt-2 flex flex-col gap-2">{retired.map(templateCard)}</ul>
          </details>
        )}
      </section>

      {props.canManage && !authoring && (
        <button type="button" onClick={() => setAuthoring(true)}
          className="self-start rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
          Write a plan template
        </button>
      )}

      {props.canManage && authoring && (
        <section className="rounded-xl border-2 border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04] p-4">
          <h2 className="text-[13px] font-bold text-gray-900">New plan template</h2>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="tpl-title">Title *</label>
              <input id="tpl-title" value={form.title} disabled={busy}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Post-operative wound review"
                className={`${input} mt-1 ${form.title.trim() ? "" : AMBER}`} />
              {form.title.trim() && (
                <p className="mt-1 text-[10.5px] text-gray-500">
                  Stored as <span className="font-mono">{slugOf(form.title)}</span>
                </p>
              )}
            </div>
            <div>
              <label className={LABEL} htmlFor="tpl-desc">Description</label>
              <input id="tpl-desc" value={form.description} disabled={busy}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional. When to reach for this plan."
                className={`${input} mt-1`} />
            </div>
          </div>

          <h3 className="mt-3 text-[12px] font-bold text-gray-800">Steps</h3>
          {/* ⚠ THE SENTENCE THE WHOLE FIELD TURNS ON. Offsets are from the plan's START -- a plan
              applied on the 1st with steps at 14 and 42 books the 15th and the 12th of next month,
              not the 15th and then six weeks after that. */}
          <p className="text-[11px] text-gray-600">
            Each offset counts from the day the plan is applied, not from the previous step.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {steps.map((s, i) => {
              const issue = stepIssue(s);
              const dup = !Number.isNaN(Number(s.offsetDays)) && duplicateOffsets.has(Number(s.offsetDays));
              return (
                <li key={i} className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <div className="grid gap-2 sm:grid-cols-[110px_1fr_170px_130px_auto]">
                    <div>
                      <label className={LABEL} htmlFor={`step-days-${i}`}>Day *</label>
                      <input id={`step-days-${i}`} inputMode="numeric" value={s.offsetDays} disabled={busy}
                        onChange={e => setSteps(list => list.map((x, n) => n === i ? { ...x, offsetDays: e.target.value } : x))}
                        placeholder="e.g. 14"
                        className={`${input} mt-1 ${issue?.includes("days") || issue?.includes("typo") || s.offsetDays.trim() === "" || dup ? AMBER : ""}`} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`step-reason-${i}`}>What needs to happen *</label>
                      <input id={`step-reason-${i}`} value={s.reason} disabled={busy}
                        onChange={e => setSteps(list => list.map((x, n) => n === i ? { ...x, reason: e.target.value } : x))}
                        placeholder="e.g. Wound check and dressing change"
                        className={`${input} mt-1 ${s.reason.trim() ? "" : AMBER}`} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`step-kind-${i}`}>Category</label>
                      <select id={`step-kind-${i}`} value={s.kind} disabled={busy}
                        onChange={e => setSteps(list => list.map((x, n) => n === i ? { ...x, kind: e.target.value } : x))}
                        className={`${input} mt-1`}>
                        {FOLLOW_UP_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`step-priority-${i}`}>Priority</label>
                      <select id={`step-priority-${i}`} value={s.priority} disabled={busy}
                        onChange={e => setSteps(list => list.map((x, n) => n === i ? { ...x, priority: e.target.value } : x))}
                        className={`${input} mt-1`}>
                        {FOLLOW_UP_PRIORITIES.map(pr => (
                          <option key={pr} value={pr}>{pr.charAt(0).toUpperCase() + pr.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      {steps.length > 1 && (
                        <button type="button" disabled={busy}
                          onClick={() => setSteps(list => list.filter((_, n) => n !== i))}
                          aria-label={`Remove step ${i + 1}`}
                          className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-gray-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {dup && (
                    <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">
                      Another step already falls on day {s.offsetDays}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={() => setSteps(list => [...list, newStep()])}
              className={QUIET}>
              + Add a step
            </button>
            <span className="ml-auto flex items-center gap-2">
              {blocked && <span className="text-[11.5px] text-[var(--cmp-text-warning)]">{blocked}</span>}
              <button type="button" disabled={busy} onClick={() => { setAuthoring(false); setNotice(null); }}
                className={QUIET}>
                Cancel
              </button>
              <button type="button" disabled={busy || !!blocked} onClick={create}
                className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
                {busy ? "Creating..." : "Create template"}
              </button>
            </span>
          </div>

          <p className="mt-2 text-[11px] text-gray-600">
            Applying this plan raises one ordinary follow-up per step, each its own obligation somebody
            can remove or settle. It is a workflow shortcut this practice wrote &mdash; not clinical
            guidance, and never advice about a particular patient.
          </p>
        </section>
      )}
    </div>
  );
}
