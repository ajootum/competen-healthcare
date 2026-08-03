"use client";

import { useEffect, useState } from "react";
import {
  PROFESSIONS, LOCATION_TYPES, DATE_FORMATS, REGISTRATION_STATUSES, ENCOUNTER_TEMPLATES,
} from "@/lib/practice/catalogs";

// The onboarding wizard (PROV-001 s12). CATALOG-DRIVEN: steps, order and titles come from the onboarding
// API, which reads practice_onboarding_step_catalog -- adding a step is a seed row, not a wizard rewrite.
// Each stage saves through PATCH on completion (IAM-001 s9.1 "save after every stage and support
// resume"), and completing the final stage is what transitions the workspace to ACTIVE server-side; the
// wizard then hard-navigates so the shell re-resolves and lands on the command centre.

type Step = { step_code: string; position: number; required: boolean; title: string };
type Defaults = { timezone: string | null; profession: string | null; practiceType: string | null; country: string | null };
type State = {
  state: string; currentStep: string | null; completedSteps: string[]; steps: Step[];
  stepData?: Record<string, Record<string, string>>; defaults?: Defaults;
};

/**
 * THE IANA ZONE LIST COMES FROM THE BROWSER, not from a file in this repo.
 *
 * Intl.supportedValuesOf("timeZone") is the runtime's own zone database, which is maintained by whoever
 * ships the browser. A hard-coded list is stale the next time a country changes its offset, and nobody
 * would notice until a clinic's appointments were an hour out. The fallback exists only for runtimes
 * without the API, and is deliberately short and regional rather than a bad copy of the whole database.
 */
function timezoneOptions(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const zones = anyIntl.supportedValuesOf?.("timeZone");
    if (zones?.length) return zones;
  } catch { /* fall through */ }
  return ["Africa/Kampala", "Africa/Nairobi", "Africa/Dar_es_Salaam", "Africa/Kigali",
    "Africa/Addis_Ababa", "Africa/Lagos", "Africa/Johannesburg", "Europe/London", "UTC"];
}

const input = "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[var(--cp-primary)] focus:ring-4 focus:ring-[var(--cp-primary)]/10";
const label = "text-xs font-semibold text-gray-600";

export default function OnboardingWizard({ workspaceId }: { workspaceId: string }) {
  const [ob, setOb] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  // Built once. supportedValuesOf returns ~400 zones, and rebuilding that array on every keystroke in
  // another field would be a lot of work to produce the same list.
  const [zoneOptions] = useState<readonly (readonly [string, string])[]>(
    () => timezoneOptions().map(z => [z, z.replace(/_/g, " ")] as const));
  const [browserZone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  });
  // The example is rendered from a FIXED date, not today's: a label that changes daily is a label that
  // cannot be asserted, and "the 3rd" reads differently from "the 30th" when judging a format.
  const [dateFormatOptions] = useState<readonly (readonly [string, string])[]>(() => {
    const sample = { day: "30", mon: "Nov", mm: "11", yyyy: "2026" };
    const render: Record<string, string> = {
      "DD Mon YYYY": `${sample.day} ${sample.mon} ${sample.yyyy}`,
      "DD/MM/YYYY": `${sample.day}/${sample.mm}/${sample.yyyy}`,
      "MM/DD/YYYY": `${sample.mm}/${sample.day}/${sample.yyyy}`,
      "YYYY-MM-DD": `${sample.yyyy}-${sample.mm}-${sample.day}`,
    };
    return DATE_FORMATS.map(([k, l]) => [k, `${l} — ${render[k]}`] as const);
  });

  const api = `/api/v1/practice/workspaces/${workspaceId}/onboarding`;

  useEffect(() => {
    fetch(api).then(r => r.json()).then(setOb).catch(() => setError("Could not load onboarding state."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // PRE-FILL IS DERIVED, NOT STORED. An effect that seeded `form` when the step changed would call
  // setState from inside an effect -- a cascading render React tells you not to write -- and it would
  // race the save path, which also touches `form`. Computing the seed at render has neither problem:
  // `form` holds only what the practitioner actually changed, and everything else falls through to what
  // was already saved, then to what provisioning already knows, then to a sensible default.
  function seedFor(stepCode: string, d: Partial<Defaults>, saved: Record<string, string>): Record<string, string> {
    const s: Record<string, string> = { ...saved };
    if (stepCode === "regional_settings") {
      s.timezone ??= d.timezone ?? browserZone;
      s.dateFormat ??= "DD Mon YYYY";
    }
    if (stepCode === "professional_profile") s.profession ??= d.profession ?? "";
    if (stepCode === "clinical_defaults") s.template ??= "general";
    return s;
  }

  if (error) return <p className="rounded-xl bg-[var(--cmp-surface-critical)] p-4 text-sm text-[var(--cmp-text-critical)]">{error}</p>;
  if (!ob) return <p className="text-sm text-gray-400 p-4">Loading your setup…</p>;

  const current = ob.currentStep;
  const step = ob.steps.find(s => s.step_code === current);
  const done = ob.completedSteps.length;
  const total = ob.steps.length;

  async function complete(stepCode: string, data: Record<string, unknown>) {
    setBusy(true); setError("");
    const res = await fetch(api, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepCode, data }),
    });
    if (!res.ok) { setError("Could not save this step. Try again."); setBusy(false); return; }
    const next = await res.json();
    if (next.workspaceStatus === "ACTIVE") { window.location.assign("/practice/home"); return; }
    // The saved answers are folded into stepData so the derived seed can show them if the practitioner
    // navigates back, and `form` is cleared so the NEXT step starts from its own seed rather than
    // inheriting this one's values.
    setOb(prev => prev ? {
      ...prev, currentStep: next.currentStep, completedSteps: next.completedSteps,
      stepData: { ...(prev.stepData ?? {}), [stepCode]: data as Record<string, string> },
    } : prev);
    setForm({});
    setBusy(false);
  }

  // Minimal required fields per PROV-001 s12; everything deferrable is deferred (IAM-001 s9.1).
  //
  // A CLOSED SET IS A SELECT, NOT A TEXT BOX. Every one of these was a free-text input whose placeholder
  // enumerated the valid answers -- locationType's read "clinic / hospital / outreach / teleconsultation
  // / independent", which is a dropdown that had not been written yet. Typing is worse than choosing
  // three times over: it invites values the database CHECK rejects, it makes the same concept arrive
  // spelled five ways, and on the location step an unrecognised value is silently coerced to "clinic".
  // The options come from src/lib/practice/catalogs, so the wizard, the signup form and the operator
  // console offer one vocabulary.
  type Field = { name: string; label: string; placeholder?: string; type?: string; options?: readonly (readonly [string, string])[]; hint?: string };
  const FIELDS: Record<string, Field[]> = {
    professional_profile: [
      { name: "profession", label: "Profession", options: PROFESSIONS },
      { name: "registrationStatus", label: "Registration status", options: REGISTRATION_STATUSES },
    ],
    practice_context: [
      { name: "locationName", label: "Your first practice location", placeholder: "e.g. City Clinic" },
      { name: "locationType", label: "Location type", options: LOCATION_TYPES },
    ],
    regional_settings: [
      { name: "timezone", label: "Timezone", options: zoneOptions, hint: "Used for every appointment time and clinical timestamp in your practice." },
      { name: "dateFormat", label: "Date format", options: dateFormatOptions },
    ],
    clinical_defaults: [
      { name: "template", label: "Default encounter template", options: ENCOUNTER_TEMPLATES },
    ],
    privacy_security: [
      { name: "acknowledgement", label: "Type AGREE to acknowledge the terms and privacy notice", placeholder: "AGREE" },
    ],
    review_activate: [],
  };

  const fields = step ? (FIELDS[step.step_code] ?? []) : [];
  // What the step will actually submit: the seed, overlaid with anything the practitioner changed.
  const seeded = step ? seedFor(step.step_code, ob.defaults ?? {}, ob.stepData?.[step.step_code] ?? {}) : {};
  const values: Record<string, string> = { ...seeded, ...form };
  const canSubmit = step?.step_code === "privacy_security"
    ? values.acknowledgement?.trim().toUpperCase() === "AGREE"
    : fields.every(f => (values[f.name] ?? "").trim().length > 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      {/* Progress: which of the catalog steps are done */}
      <ol className="flex flex-wrap gap-1.5 mb-5" aria-label="Setup progress">
        {ob.steps.map(s => (
          <li key={s.step_code}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              ob.completedSteps.includes(s.step_code) ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
              : s.step_code === current ? "bg-[var(--cp-primary)] text-white" : "bg-gray-100 text-gray-400"}`}>
            {s.title}
          </li>
        ))}
      </ol>

      {!step ? (
        <p className="text-sm text-gray-500">Setup is complete.</p>
      ) : (
        <form onSubmit={e => { e.preventDefault(); complete(step.step_code, values); }}>
          <h2 className="text-[15px] font-bold text-gray-900">{step.title}</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">Step {done + 1} of {total}</p>

          {step.step_code === "review_activate" ? (
            <p className="mt-4 text-sm leading-relaxed text-gray-600">
              Everything required is saved. Activating opens your Practice Command Centre; you can refine
              any of this later in Practice Settings.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {fields.map(f => (
                <label key={f.name} className="block">
                  <span className={label}>{f.label}</span>
                  {f.options ? (
                    <select required value={values[f.name] ?? ""}
                      onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))} className={input}>
                      {/* An empty first option only while nothing is chosen, so `required` can still
                          refuse an unanswered question -- but it disappears once answered rather than
                          sitting in the list as a way to un-answer it. */}
                      {!values[f.name] && <option value="">Choose…</option>}
                      {f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  ) : (
                    <input type={f.type ?? "text"} required value={values[f.name] ?? ""} placeholder={f.placeholder}
                      onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))} className={input} />
                  )}
                  {f.hint && <span className="mt-1 block text-[11px] text-gray-400">{f.hint}</span>}
                </label>
              ))}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy || !canSubmit}
            className="mt-5 rounded-xl bg-[var(--cp-primary)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
            {busy ? "Saving…" : step.step_code === "review_activate" ? "Activate my Practice" : "Save and continue"}
          </button>
        </form>
      )}
    </div>
  );
}
