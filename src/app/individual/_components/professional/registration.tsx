/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadIndividualPolicy, optionCode, type ProfessionalProfilePolicy } from "@/lib/individual/policy";
import { loadSuggestions, type Suggestions } from "@/lib/individual/professional/suggestions";
import { fieldCode, fieldValue, registrationSteps, resumeStep, type FieldSpec } from "@/lib/individual/professional/profile-form";
import { loadProfessionalProfile, registrationState, type ProfilePointer } from "@/lib/individual/professional/profile-store";
import { FIELD_LABEL, REQUIRED_FIELDS, STEP_LABEL } from "@/lib/individual/professional/profile-vocabulary";
import type { FieldProps } from "./ContextField";
import RegistrationWizard, { type WizardStep } from "./RegistrationWizard";

// Join Professional -> establish professional identity -> enter workspace (COMPETEN-PROFESSIONAL-PROFILE-01 GO s1).
//
// The Professional home shows the registration form INSTEAD of the workspace until the three required facts
// are saved and the person chooses to enter. Every other Professional page stays open from the menu, so
// nothing else waits on registration, and a person can leave the form at any step and come back.
//
// ⚠ FAILS OPEN TO THE MVP, NEVER CLOSED ON THE PERSON. Before migration 450 is applied, or when the record
// cannot be read, there is no form: the workspace shows exactly as it did. Registration is never a lock.

/** Pure: a form question with what is on record, for the client. HFE-01 Wave 3 (F6): with nothing on record for
 *  where the person practises, the country on their shared Competen profile is offered as the starting answer. It is
 *  only a starting value: nothing is saved until they submit, and they can change it. */
export function fieldProps(spec: FieldSpec, row: Partial<ProfilePointer> | null | undefined, suggestions: Suggestions, prefill?: { country?: string | null }): FieldProps {
  let code = fieldCode(row, spec.key), value = fieldValue(row, spec.key);
  const country = prefill?.country?.trim();
  if (spec.key === "jurisdiction" && !code && (value === null || value === "") && country) {
    const c = optionCode(country);
    if (spec.options?.some(o => o.code === c)) code = c; else value = country;
  }
  return {
    name: spec.key, label: spec.label, required: spec.required, input: spec.input, options: spec.options,
    code, value,
    suggestions: spec.key === "profession" ? suggestions.profession : [],
    hint: spec.key === "jurisdiction" ? "Where you practise or mean to practise. It may differ from where you trained." : undefined,
  };
}

export async function loadRegistration(admin: any, userId: string, prefill?: { country?: string | null }): Promise<{ steps: WizardStep[]; resumeAt: WizardStep["key"]; review: { label: string; value: string | null; required: boolean }[] } | null> {
  const [view, policy, suggestions] = await Promise.all([loadProfessionalProfile(admin, userId), loadIndividualPolicy(admin), loadSuggestions(admin)]);
  if (registrationState(view) !== "incomplete") return null;
  return registrationModel(view.pointer, policy.professionalProfile, suggestions, prefill);
}

/** Pure: the wizard's props from the record and the configuration. */
export function registrationModel(row: Partial<ProfilePointer> | null | undefined, policy: ProfessionalProfilePolicy, suggestions: Suggestions, prefill?: { country?: string | null }) {
  const specs = registrationSteps(policy);
  const steps: WizardStep[] = specs.map(s => ({ key: s.key, title: STEP_LABEL[s.key], fields: s.fields.map(f => fieldProps(f, row, suggestions, prefill)) }));
  const asked = [...REQUIRED_FIELDS, ...policy.registrationFields];
  const review = asked.map(f => {
    const v = fieldValue(row, f);
    return { label: FIELD_LABEL[f], value: v === null || v === "" ? null : String(v), required: (REQUIRED_FIELDS as readonly string[]).includes(f) || policy.registrationRequired.includes(f as never) };
  });
  return { steps, resumeAt: resumeStep(row, specs) ?? "review", review };
}

export function RegistrationScreen({ model, accent }: { model: NonNullable<Awaited<ReturnType<typeof loadRegistration>>>; accent: string }) {
  return (
    <>
      <RegistrationWizard steps={model.steps} resumeAt={model.resumeAt} review={model.review} accent={accent} />
      <p className="mt-4 text-[13px] text-gray-600">
        You can open any part of Competen Professional from the menu and finish this later. Your Competen account, your Passport and anything else on your account stay exactly as they are.
      </p>
    </>
  );
}
