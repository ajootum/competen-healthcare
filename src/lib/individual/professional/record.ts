/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";

// ── THE PROFESSIONAL RECORD, READ ── by the person's own id, and only from migration 373's tables ───────
//
// ⚠ ONE READER FOR EVERY PROFESSIONAL PAGE. Each section is null when its read failed and [] when it read
// zero rows (the passport.ts rule): a failed read rendered as an empty record would tell the person they
// have no CPD when the truth is that it could not be checked.
//
// ⚠ NOTHING HERE READS AN ESTATE TABLE. cpd_logs, professional_credentials and evidence are the estate's,
// read by hospitals. The person's institution-issued records reach Professional through the foundation
// Passport (src/lib/individual/passport.ts), read-only (owner ruling D3), never through this file.

export type ProfessionalProfile = {
  self_declared_profession: string | null;
  self_declared_registration_body: string | null;
  self_declared_registration_number: string | null;
  self_declared_registration_country: string | null;
  self_declared_registration_expires_on: string | null;
  updated_at: string | null;
};

export type Need = {
  id: string; title: string; detail: string | null; origin: string; status: string;
  framework_id: string | null; framework_competency_id: string | null; created_at: string; closed_at: string | null;
};

export type Goal = {
  id: string; need_id: string | null; title: string; detail: string | null; target_date: string | null;
  status: string; completed_at: string | null; created_at: string;
};

export type CpdEntry = {
  id: string; goal_id: string | null; activity_type: string; title: string; provider: string | null;
  hours: number; cpd_points: number | null; activity_date: string; reflection: string | null;
  document_name: string | null; evidence_class: string; created_at: string;
};

export type EvidenceItem = {
  id: string; kind: string; need_id: string | null; title: string; detail: string | null; issuing_body: string | null;
  issued_on: string | null; expires_on: string | null; framework_id: string | null; framework_competency_id: string | null;
  document_name: string | null; evidence_class: string; created_at: string;
};

export type ProfessionalRecord = {
  /** False when migration 373 is not applied here: nobody can hold a record in a table that does not exist. */
  provisioned: boolean;
  /** undefined: read, and no profile row yet. null: could not be read. */
  profile: ProfessionalProfile | undefined | null;
  needs: Need[] | null;
  goals: Goal[] | null;
  cpd: CpdEntry[] | null;
  evidence: EvidenceItem[] | null;
};

export const PROFILE_COLUMNS = "self_declared_profession, self_declared_registration_body, self_declared_registration_number, "
  + "self_declared_registration_country, self_declared_registration_expires_on, updated_at";
const NEED_COLUMNS = "id, title, detail, origin, status, framework_id, framework_competency_id, created_at, closed_at";
const GOAL_COLUMNS = "id, need_id, title, detail, target_date, status, completed_at, created_at";
const CPD_COLUMNS = "id, goal_id, activity_type, title, provider, hours, cpd_points, activity_date, reflection, document_name, evidence_class, created_at";
const EVIDENCE_COLUMNS = "id, kind, need_id, title, detail, issuing_body, issued_on, expires_on, framework_id, framework_competency_id, document_name, evidence_class, created_at";

export async function loadProfessionalRecord(admin: any, userId: string): Promise<ProfessionalRecord> {
  // "Not provisioned" is a kind of none, not of unreadable -- the access.ts rule. Before 373 is applied the
  // tables do not exist, so the truthful answer is "no records", and the pages say the store is not set up.
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try {
      const r = await p;
      if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; }
      return r?.error ? null : (r?.data ?? []);
    } catch { return null; }
  };
  const [profileRows, needs, goals, cpd, evidence] = await Promise.all([
    settle(admin.from("individual_professional_profile").select(PROFILE_COLUMNS).eq("user_id", userId).limit(1)),
    settle(admin.from("individual_professional_need").select(NEED_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(500)),
    settle(admin.from("individual_professional_goal").select(GOAL_COLUMNS).eq("user_id", userId).order("target_date", { ascending: true }).limit(500)),
    settle(admin.from("individual_professional_cpd").select(CPD_COLUMNS).eq("user_id", userId).order("activity_date", { ascending: false }).limit(2000)),
    settle(admin.from("individual_professional_evidence").select(EVIDENCE_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(500)),
  ]);
  return {
    provisioned,
    profile: profileRows === null ? null : (profileRows[0] ?? undefined),
    needs, goals,
    cpd: cpd === null ? null : cpd.map(c => ({ ...c, hours: Number(c.hours) })),
    evidence,
  };
}

/** True when the profile carries at least one fact. A row of blanks is not a profile. */
export function hasProfile(p: ProfessionalProfile | undefined | null): p is ProfessionalProfile {
  return !!p && [p.self_declared_profession, p.self_declared_registration_body, p.self_declared_registration_number,
    p.self_declared_registration_country].some(v => !!v);
}
