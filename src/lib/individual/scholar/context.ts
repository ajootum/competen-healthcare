/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ContextOption, IndividualPolicy } from "../policy";
import { learnerContextPeriods, listProgrammes, writeLearnerContext } from "./store";

// ── A SCHOLAR LEARNER'S EDUCATIONAL CONTEXT ── COMPETEN-SCHOLAR-JOIN-01 J2, migration 402 ───────────────────
//
// Programme (a row of individual_scholar_programme, 387), a level within it and an optional institution. What
// may be chosen is governed in the Individual policy (WCE): which programmes are offered, each programme's
// levels, the institutions, and which of those fields are asked (src/lib/individual/policy.ts).
//
// ⚠ HISTORY IS THE DATABASE'S. individual_scholar_learner stays the CURRENT pointer. Every write to it is
// copied by trigger into individual_scholar_learner_context as a period on the database clock, and the
// history refuses to be rewritten. So this file only ever writes the pointer, and a change of programme
// cannot overwrite the context earlier study was done in: that study's created_at falls in an earlier period.
//
// ⚠ LABELS ARE COPIED onto the pointer (and so into the period) when chosen, so renaming or retiring an
// option in the policy later never rewrites what a past period says.
//
// ⚠ THE STORE DOES THE READING AND WRITING (./store.ts, the one Scholar write site, scholar-learning A4). This
// file holds the rules: what is offered, what a choice must contain, and which period a record falls in.
//
// ⚠ OPTIONS ARE RE-CHECKED ON EVERY READ. An offered programme that is no longer an active row is not
// offered, whatever the policy says -- the same posture as the S1 catalogues.

export type ProgrammeOption = { code: string; label: string; levels: ContextOption[] };
export type JoinOptions = { programmes: ProgrammeOption[]; institutions: ContextOption[]; asksLevel: boolean; asksInstitution: boolean };

/** Pure: what the join offers, from the active programme rows and the effective policy. */
export function buildJoinOptions(rows: readonly { code: string; label: string }[], policy: Pick<IndividualPolicy,
  "scholarOnboardingProgrammes" | "scholarProgrammeLevels" | "scholarInstitutions" | "scholarOnboardingFields">): JoinOptions {
  const offered = policy.scholarOnboardingProgrammes;
  const asksLevel = policy.scholarOnboardingFields.includes("level");
  const asksInstitution = policy.scholarOnboardingFields.includes("institution") && policy.scholarInstitutions.length > 0;
  const programmes = rows
    .filter(r => offered === null || offered.includes(r.code))
    .map(r => ({ code: r.code, label: r.label, levels: asksLevel ? policy.scholarProgrammeLevels[r.code] ?? [] : [] }));
  return { programmes, institutions: asksInstitution ? policy.scholarInstitutions : [], asksLevel, asksInstitution };
}

export async function loadJoinOptions(admin: any, policy: IndividualPolicy): Promise<{ ok: true; options: JoinOptions } | { ok: false; notProvisioned: boolean }> {
  const rows = await listProgrammes(admin);
  if (!rows.ok) return { ok: false, notProvisioned: rows.notProvisioned };
  return { ok: true, options: buildJoinOptions(rows.data, policy) };
}

export type ContextChoice = {
  programmeCode: string; programmeLabel: string;
  level: ContextOption | null; institution: ContextOption | null;
};

/**
 * Pure: a person's choice against what is offered, or why it is refused. A level is required when the chosen
 * programme has levels to choose from. An institution is always optional.
 */
export function validateContextChoice(options: JoinOptions, body: any): { ok: true; choice: ContextChoice } | { ok: false; error: string } {
  const p = options.programmes.find(x => x.code === body?.programme);
  if (!p) return { ok: false, error: "Choose your programme." };
  let level: ContextOption | null = null;
  if (p.levels.length) {
    level = p.levels.find(l => l.code === body?.level) ?? null;
    if (!level) return { ok: false, error: "Choose your level." };
  }
  let institution: ContextOption | null = null;
  if (body?.institution != null && body.institution !== "") {
    institution = options.institutions.find(i => i.code === body.institution) ?? null;
    if (!institution) return { ok: false, error: "That institution is not on the list. Choose another, or leave it blank." };
  }
  return { ok: true, choice: { programmeCode: p.code, programmeLabel: p.label, level, institution } };
}

/**
 * Write the CURRENT context. The trigger (402) closes the open period and opens a new one when, and only
 * when, the programme, level or institution actually changed.
 */
export function setLearnerContext(admin: any, userId: string, c: ContextChoice): Promise<"ok" | "failed"> {
  return writeLearnerContext(admin, userId, {
    programme_code: c.programmeCode,
    level_code: c.level?.code ?? null, level_label: c.level?.label ?? null,
    institution_code: c.institution?.code ?? null, institution_label: c.institution?.label ?? null,
  });
}

export type ContextPeriod = {
  programmeCode: string; levelLabel: string | null; institutionLabel: string | null;
  effectiveFrom: string; effectiveTo: string | null;
};

/** The person's context periods, newest first. */
export async function contextHistory(admin: any, userId: string): Promise<{ ok: true; periods: ContextPeriod[] } | { ok: false; notProvisioned: boolean }> {
  const read = await learnerContextPeriods(admin, userId);
  if (!read.ok) return { ok: false, notProvisioned: read.notProvisioned };
  return {
    ok: true,
    periods: read.data.map(r => ({
      programmeCode: r.programme_code, levelLabel: r.level_label ?? null, institutionLabel: r.institution_label ?? null,
      effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null,
    })),
  };
}

/**
 * Pure: the context a learning record was made in, from its created_at (database clock) and the history.
 * null when the record predates every period -- the person had chosen no programme yet. Never the current
 * context by default: a record made before a change keeps the context it was made in.
 */
export function contextAt(periods: readonly ContextPeriod[], createdAt: string): ContextPeriod | null {
  const t = new Date(createdAt).getTime();
  return periods.find(p => new Date(p.effectiveFrom).getTime() <= t && (p.effectiveTo === null || t < new Date(p.effectiveTo).getTime())) ?? null;
}
