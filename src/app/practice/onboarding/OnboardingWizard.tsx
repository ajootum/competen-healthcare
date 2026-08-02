"use client";

import { useEffect, useState } from "react";

// The onboarding wizard (PROV-001 s12). CATALOG-DRIVEN: steps, order and titles come from the onboarding
// API, which reads practice_onboarding_step_catalog -- adding a step is a seed row, not a wizard rewrite.
// Each stage saves through PATCH on completion (IAM-001 s9.1 "save after every stage and support
// resume"), and completing the final stage is what transitions the workspace to ACTIVE server-side; the
// wizard then hard-navigates so the shell re-resolves and lands on the command centre.

type Step = { step_code: string; position: number; required: boolean; title: string };
type State = { state: string; currentStep: string | null; completedSteps: string[]; steps: Step[] };

const input = "mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#2563EB] focus:ring-4 focus:ring-[#2563EB]/10";
const label = "text-xs font-semibold text-gray-600";

export default function OnboardingWizard({ workspaceId }: { workspaceId: string }) {
  const [ob, setOb] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});

  const api = `/api/v1/practice/workspaces/${workspaceId}/onboarding`;

  useEffect(() => {
    fetch(api).then(r => r.json()).then(setOb).catch(() => setError("Could not load onboarding state."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

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
    setOb(prev => prev ? { ...prev, currentStep: next.currentStep, completedSteps: next.completedSteps } : prev);
    setForm({});
    setBusy(false);
  }

  // Minimal required fields per PROV-001 s12; everything deferrable is deferred (IAM-001 s9.1).
  const FIELDS: Record<string, { name: string; label: string; placeholder?: string; type?: string }[]> = {
    professional_profile: [
      { name: "profession", label: "Profession", placeholder: "e.g. Medical doctor" },
      { name: "registrationStatus", label: "Registration status", placeholder: "e.g. Registered / provisional" },
    ],
    practice_context: [
      { name: "locationName", label: "Your first practice location", placeholder: "e.g. City Clinic" },
      { name: "locationType", label: "Location type", placeholder: "clinic / hospital / outreach / teleconsultation / independent" },
    ],
    regional_settings: [
      { name: "timezone", label: "Timezone", placeholder: "e.g. Africa/Kampala" },
      { name: "dateFormat", label: "Date format", placeholder: "e.g. DD Mon YYYY" },
    ],
    clinical_defaults: [
      { name: "template", label: "Default encounter template", placeholder: "general" },
    ],
    privacy_security: [
      { name: "acknowledgement", label: "Type AGREE to acknowledge the terms and privacy notice", placeholder: "AGREE" },
    ],
    review_activate: [],
  };

  const fields = step ? (FIELDS[step.step_code] ?? []) : [];
  const canSubmit = step?.step_code === "privacy_security"
    ? form.acknowledgement?.trim().toUpperCase() === "AGREE"
    : fields.every(f => (form[f.name] ?? "").trim().length > 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      {/* Progress: which of the catalog steps are done */}
      <ol className="flex flex-wrap gap-1.5 mb-5" aria-label="Setup progress">
        {ob.steps.map(s => (
          <li key={s.step_code}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              ob.completedSteps.includes(s.step_code) ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
              : s.step_code === current ? "bg-[#2563EB] text-white" : "bg-gray-100 text-gray-400"}`}>
            {s.title}
          </li>
        ))}
      </ol>

      {!step ? (
        <p className="text-sm text-gray-500">Setup is complete.</p>
      ) : (
        <form onSubmit={e => { e.preventDefault(); complete(step.step_code, form); }}>
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
                  <input type={f.type ?? "text"} required value={form[f.name] ?? ""} placeholder={f.placeholder}
                    onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))} className={input} />
                </label>
              ))}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy || !canSubmit}
            className="mt-5 rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
            {busy ? "Saving…" : step.step_code === "review_activate" ? "Activate my Practice" : "Save and continue"}
          </button>
        </form>
      )}
    </div>
  );
}
