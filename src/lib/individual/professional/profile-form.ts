import type { ContextOption, ProfessionalProfilePolicy } from "../policy";
import { isoDate, isUuid, type Parsed } from "./validate";
import {
  FIELD_LABEL, REGISTRATION_STANDING, REQUIRED_FIELDS, WITHDRAW_REASONS, YEARS_MAX,
  type ItemKind, type OptionalField, type RegistrationField, type RegistrationStep, type WithdrawReason,
} from "./profile-vocabulary";

// ── THE REGISTRATION FORM AND THE PROFILE RECORDS, PURE ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1 ──────────
//
// What the form asks (from the Individual policy, never hard-coded), how a submitted field becomes the
// columns migration 450 stores, and whether registration is complete. The routes call these before they
// write. The schema remains the rule: 450's CHECKs refuse what this file would let through by mistake.
//
// ⚠ A CODE IS ONLY EVER ONE THE POLICY OFFERS NOW, AND ITS LABEL IS COPIED. A person picks from the
// published list or types their own ("Other"). The label in force at that moment is stored beside the code,
// so a later rename never rewrites their record.
//
// ⚠ NOTHING HERE ACCEPTS A CLASS, A VERIFIED FLAG OR A USER ID (validate.ts's rule). The evidence class is
// 450's generated column, and the owner is always the guarded caller.

/** The policy list a field chooses from. Empty: the person types it. `role` and `years` have no list. */
export function fieldOptions(policy: ProfessionalProfilePolicy, field: RegistrationField): ContextOption[] {
  switch (field) {
    case "profession": return policy.professions;
    case "jurisdiction": return policy.jurisdictions;
    case "status": return policy.statuses;
    case "specialty": return policy.specialties;
    case "title": return policy.titles;
    case "setting": return policy.practiceSettings;
    default: return [];
  }
}

export type FieldSpec = { key: RegistrationField; label: string; required: boolean; input: "choice" | "text" | "number"; options: ContextOption[] };
export type StepSpec = { key: RegistrationStep; fields: FieldSpec[] };

/** Pure: the registration form as configured. The practice step is left out when no optional question is asked. */
export function registrationSteps(policy: ProfessionalProfilePolicy): StepSpec[] {
  const spec = (key: RegistrationField, required: boolean): FieldSpec => {
    const options = fieldOptions(policy, key);
    return { key, label: FIELD_LABEL[key], required, input: key === "years" ? "number" : options.length ? "choice" : "text", options };
  };
  const steps: StepSpec[] = [{ key: "profession", fields: REQUIRED_FIELDS.map(f => spec(f, true)) }];
  if (policy.registrationFields.length)
    steps.push({ key: "practice", fields: policy.registrationFields.map(f => spec(f, policy.registrationRequired.includes(f))) });
  steps.push({ key: "review", fields: [] });
  return steps;
}

/** The pointer columns (migration 373 + 450) the form writes. */
export type ContextColumns = {
  profession_code: string | null; self_declared_profession: string | null;
  practice_jurisdiction_code: string | null; self_declared_practice_jurisdiction: string | null;
  professional_status_code: string | null; self_declared_professional_status: string | null;
  primary_specialty_code: string | null; self_declared_primary_specialty: string | null;
  professional_title_code: string | null; self_declared_professional_title: string | null;
  practice_setting_code: string | null; self_declared_practice_setting: string | null;
  self_declared_current_role: string | null;
  self_declared_years_experience: number | null;
};

const COLUMNS: Record<Exclude<RegistrationField, "role" | "years">, [keyof ContextColumns, keyof ContextColumns]> = {
  profession: ["profession_code", "self_declared_profession"],
  jurisdiction: ["practice_jurisdiction_code", "self_declared_practice_jurisdiction"],
  status: ["professional_status_code", "self_declared_professional_status"],
  specialty: ["primary_specialty_code", "self_declared_primary_specialty"],
  title: ["professional_title_code", "self_declared_professional_title"],
  setting: ["practice_setting_code", "self_declared_practice_setting"],
};
/** profession keeps 373's 120-character limit. Every other label is up to 160 (450). */
const LABEL_MAX = (f: RegistrationField) => (f === "profession" ? 120 : 160);

/** The value a person gave for a field: a code from the list, typed text, both blank, or wrong. */
function resolveChoice(field: RegistrationField, options: readonly ContextOption[], code: unknown, text: unknown): { code: string | null; label: string | null } | string {
  const c = typeof code === "string" ? code.trim() : "";
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (c && c !== "other") {
    const hit = options.find(o => o.code === c);
    if (!hit) return `${FIELD_LABEL[field]}: choose one of the options, or choose Other and type it.`;
    return { code: hit.code, label: hit.label.slice(0, LABEL_MAX(field)) };
  }
  if (!t) return { code: null, label: null };
  if (t.length > LABEL_MAX(field)) return `${FIELD_LABEL[field]}: at most ${LABEL_MAX(field)} characters.`;
  return { code: null, label: t };
}

/**
 * Pure: the fields of one save, as columns. Only the fields named are read, so a step never clears what
 * another step saved. Blank clears that field. Body keys: `<field>` (a code) and `<field>Text` (typed).
 */
export function parseContext(b: Record<string, unknown>, fields: readonly RegistrationField[], policy: ProfessionalProfilePolicy): Parsed<Partial<ContextColumns>> {
  const out: Partial<ContextColumns> = {};
  for (const f of fields) {
    if (f === "years") {
      const raw = b.years;
      if (raw === undefined || raw === null || raw === "") { out.self_declared_years_experience = null; continue; }
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 0 || n > YEARS_MAX) return { ok: false, error: `${FIELD_LABEL.years}: a whole number from 0 to ${YEARS_MAX}.` };
      out.self_declared_years_experience = n;
      continue;
    }
    if (f === "role") {
      const t = typeof b.role === "string" ? b.role.replace(/\s+/g, " ").trim() : "";
      if (t.length > 160) return { ok: false, error: `${FIELD_LABEL.role}: at most 160 characters.` };
      out.self_declared_current_role = t || null;
      continue;
    }
    const r = resolveChoice(f, fieldOptions(policy, f), b[f], b[`${f}Text`]);
    if (typeof r === "string") return { ok: false, error: r };
    const [codeCol, labelCol] = COLUMNS[f];
    (out as Record<string, unknown>)[codeCol] = r.code;
    (out as Record<string, unknown>)[labelCol] = r.label;
  }
  return { ok: true, value: out };
}

/** The summary of the Professional overview. Written by the person (an AI draft only if they paste it in). */
export function parseSummary(v: unknown): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "Send the summary as text." };
  const t = v.trim();
  if (t.length > 2000) return { ok: false, error: "Keep the summary under 2,000 characters." };
  return { ok: true, value: t || null };
}

/** The value a field holds on the current pointer row, for completeness checks and the form's defaults. */
export function fieldValue(row: Partial<ContextColumns> | null | undefined, f: RegistrationField): string | number | null {
  if (!row) return null;
  if (f === "years") return row.self_declared_years_experience ?? null;
  if (f === "role") return row.self_declared_current_role ?? null;
  return (row[COLUMNS[f][1]] as string | null | undefined) ?? null;
}
export function fieldCode(row: Partial<ContextColumns> | null | undefined, f: RegistrationField): string | null {
  if (!row || f === "years" || f === "role") return null;
  return (row[COLUMNS[f][0]] as string | null | undefined) ?? null;
}

/** Pure: the required facts still missing -- the three, and any optional question configuration requires. */
export function missingForCompletion(row: Partial<ContextColumns> | null | undefined, policy: ProfessionalProfilePolicy): RegistrationField[] {
  const required: RegistrationField[] = [...REQUIRED_FIELDS, ...policy.registrationRequired];
  return required.filter(f => { const v = fieldValue(row, f); return v === null || (typeof v === "string" && !v.trim()); });
}

/** Pure: the step to resume at. A complete registration resumes nowhere. */
export function resumeStep(row: { registration_step?: string | null; registration_completed_at?: string | null } & Partial<ContextColumns> | null | undefined,
  steps: readonly StepSpec[]): RegistrationStep | null {
  if (row?.registration_completed_at) return null;
  const keys = steps.map(s => s.key);
  const saved = keys.includes(row?.registration_step as RegistrationStep) ? row!.registration_step as RegistrationStep : "profession";
  // Missing a required profession-step fact always sends the person back there.
  return REQUIRED_FIELDS.some(f => !fieldValue(row, f)) ? "profession" : saved;
}

/** Pure: the step after `step`. */
export function nextStep(step: RegistrationStep, steps: readonly StepSpec[]): RegistrationStep {
  const i = steps.findIndex(s => s.key === step);
  return steps[Math.min(steps.length - 1, i + 1)]?.key ?? "review";
}

// ── PROFILE RECORDS (migration 450 individual_professional_profile_item) ─────────────────────────────────

export type ItemInput = {
  section: ItemKind; title: string; type_code: string | null; type_label: string | null;
  organisation: string | null; jurisdiction: string | null; self_declared_identifier: string | null;
  started_on: string | null; ended_on: string | null; expires_on: string | null; target_on: string | null;
  detail: string | null; supersedes_id: string | null;
};

/** Which inputs each kind carries -- the same matrix as 450's section_shape CHECK. */
export const ITEM_FIELDS: Record<ItemKind, readonly ("type" | "organisation" | "jurisdiction" | "identifier" | "startedOn" | "endedOn" | "expiresOn" | "targetOn" | "detail")[]> = {
  qualification: ["type", "organisation", "jurisdiction", "startedOn", "expiresOn", "detail"],
  registration: ["type", "organisation", "jurisdiction", "identifier", "startedOn", "endedOn", "expiresOn", "detail"],
  employment: ["type", "organisation", "jurisdiction", "startedOn", "endedOn", "detail"],
  specialty: ["startedOn", "detail"],
  interest: ["detail"],
  aspiration: ["targetOn", "detail"],
  skill: ["detail"],
};

/** The list a record's type chooses from. A registration's standing is a fixed list. */
export function itemTypeOptions(policy: ProfessionalProfilePolicy, kind: ItemKind): readonly ContextOption[] {
  if (kind === "qualification") return policy.qualificationTypes;
  if (kind === "employment") return policy.practiceSettings;
  if (kind === "registration") return REGISTRATION_STANDING;
  return [];
}
/** Where a record's title may be chosen from a list (it can always be typed). */
export function itemTitleOptions(policy: ProfessionalProfilePolicy, kind: ItemKind): readonly ContextOption[] {
  if (kind === "specialty") return policy.specialties;
  if (kind === "interest") return policy.careerInterests;
  return [];
}

const txt = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[ \t]+/g, " ").trim();
  return !t ? null : t.length > max ? undefined : t;
};

/** Pure: a profile record as submitted, or why it is refused. Fields a kind does not carry are not read. */
export function parseItem(kind: unknown, b: Record<string, unknown>, policy: ProfessionalProfilePolicy): Parsed<ItemInput> {
  if (typeof kind !== "string" || !(kind in ITEM_FIELDS)) return { ok: false, error: "Choose what kind of record this is." };
  const k = kind as ItemKind;
  const has = (f: (typeof ITEM_FIELDS)[ItemKind][number]) => ITEM_FIELDS[k].includes(f);

  const titleOpts = itemTitleOptions(policy, k);
  const titleCode = typeof b.titleCode === "string" ? b.titleCode.trim() : "";
  const chosen = titleCode && titleCode !== "other" ? titleOpts.find(o => o.code === titleCode) : undefined;
  if (titleCode && titleCode !== "other" && !chosen) return { ok: false, error: "Choose one of the options, or choose Other and type it." };
  const title = chosen ? chosen.label : txt(b.title, 200);
  if (title === undefined || !title || title.length < 2) return { ok: false, error: "Give it a name of 2 to 200 characters." };

  let type_code: string | null = null, type_label: string | null = null;
  if (has("type")) {
    const c = typeof b.type === "string" ? b.type.trim() : "";
    if (c) {
      const hit = itemTypeOptions(policy, k).find(o => o.code === c);
      if (!hit) return { ok: false, error: "Choose a type from the list." };
      type_code = hit.code; type_label = hit.label;
    }
  }
  const organisation = has("organisation") ? txt(b.organisation, 160) : null;
  const jurisdiction = has("jurisdiction") ? txt(b.jurisdiction, 160) : null;
  const identifier = has("identifier") ? txt(b.identifier, 60) : null;
  const detail = has("detail") ? txt(b.detail, 2000) : null;
  if (organisation === undefined || jurisdiction === undefined) return { ok: false, error: "Keep names under 160 characters." };
  if (identifier === undefined) return { ok: false, error: "Keep the registration number under 60 characters." };
  if (detail === undefined) return { ok: false, error: "Keep the details under 2,000 characters." };

  const date = (key: string, on: boolean) => (on ? isoDate(b[key]) : null);
  const started_on = date("startedOn", has("startedOn")), ended_on = date("endedOn", has("endedOn"));
  const expires_on = date("expiresOn", has("expiresOn")), target_on = date("targetOn", has("targetOn"));
  if ([started_on, ended_on, expires_on, target_on].some(d => d === undefined)) return { ok: false, error: "Enter dates as real calendar dates." };
  if (started_on && ended_on && ended_on < started_on) return { ok: false, error: "The end date is before the start date." };
  if (started_on && expires_on && expires_on < started_on) return { ok: false, error: "The expiry date is before the start date." };

  const sup = b.supersedesId;
  if (sup !== undefined && sup !== null && sup !== "" && !isUuid(sup)) return { ok: false, error: "That record is not on your profile." };

  return { ok: true, value: {
    section: k, title, type_code, type_label, organisation: organisation ?? null, jurisdiction: jurisdiction ?? null,
    self_declared_identifier: identifier ?? null, started_on: started_on ?? null, ended_on: ended_on ?? null,
    expires_on: expires_on ?? null, target_on: target_on ?? null, detail: detail ?? null,
    supersedes_id: isUuid(sup) ? sup : null,
  } };
}

export const isWithdrawReason = (v: unknown): v is WithdrawReason => typeof v === "string" && WITHDRAW_REASONS.some(([k]) => k === v);
export type { OptionalField };
