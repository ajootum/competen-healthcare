/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE COMPETEN PASSPORT, AS COMPETEN INDIVIDUAL SHOWS IT ── COMPETEN-IND-003 s2(5), ADR-016 ──────────
//
// ⚠ A VIEW, NOT A RECORD. There is one Competen Passport per person, and it already exists: the
// competency decisions, credentials and employment history keyed on that person (migrations 011, 016,
// 027, 182), which /dashboard/passport and the public /verify page already compose. This module reads
// the SAME rows, by the subject's own id and nothing else, and writes nothing. "Do not create duplicate
// ... Passport records" (COMPETEN-IND-003 s2) is met by construction: there is no table here to
// duplicate into.
//
// ⚠ EVERY ITEM SAYS WHERE IT CAME FROM (COMPETEN-IND-002 s4.2). The person must always be able to tell
// what an organisation issued, what somebody verified and what was only declared:
//
//   institution_issued  a governed decision or record an organisation made about the person
//   institution_verified a credential the person declared that an organisation's staff then verified
//   self_declared       a credential on the record that nobody has verified
//
// Individual itself creates none of these today -- its own records arrive with the Professional tools.
//
// ⚠ PROVISIONAL RULING D3 (COMPETEN-IND-002 s7). Showing institution-issued records to their subject,
// read-only, is the working assumption, not an owner ruling. Disclosure OUTWARD is never automatic --
// sharing stays the person's act, on the existing share surface.
//
// ⚠ "COULD NOT BE READ" IS NOT "NONE". Each section is null when its read failed and [] when it read
// zero rows, and the page renders those differently. A failed read shown as an empty Passport would be a
// claim that the person has no evidence.
//
// ⚠ CURRENT-COMPETENCE SEMANTICS ARE /verify's. The latest decision per competency counts as current when
// its outcome is `competent` and it has not passed its expiry date -- the rule src/app/verify/[token]
// applies, so the Passport cannot show a person something the verification page would not.

export type EvidenceClass = "institution_issued" | "institution_verified" | "self_declared";

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  institution_issued: "Issued by an organisation",
  institution_verified: "Verified by an organisation",
  self_declared: "Self-declared, not verified",
};

export type PassportCompetency = {
  competencyId: string;
  name: string;
  outcome: string;
  expiryDate: string | null;
  decidedAt: string | null;
  issuer: string | null;
  current: boolean;
};

export type PassportCredential = {
  title: string;
  type: string;
  issuingBody: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: string;
  evidence: EvidenceClass;
};

export type PassportEmployment = {
  roleTitle: string;
  organisation: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
};

export type IndividualPassport = {
  competencies: PassportCompetency[] | null;
  credentials: PassportCredential[] | null;
  employment: PassportEmployment[] | null;
};

const nameOf = (row: any): string => {
  const fc = row?.framework_competencies;
  return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? "Unnamed competency";
};

/** Pure: latest decision per competency, newest first, each marked current or not. */
export function latestDecisions(rows: any[], today: string, issuerName: (row: any) => string | null): PassportCompetency[] {
  const latest = new Map<string, any>();
  for (const d of rows) if (d?.competency_id && !latest.has(d.competency_id)) latest.set(d.competency_id, d);
  return [...latest.values()].map(d => ({
    competencyId: d.competency_id,
    name: nameOf(d),
    outcome: String(d.outcome ?? "unknown"),
    expiryDate: d.expiry_date ?? null,
    decidedAt: d.created_at ?? null,
    issuer: issuerName(d),
    current: d.outcome === "competent" && (!d.expiry_date || d.expiry_date > today),
  }));
}

/** Pure: a credential's evidence class. Verified means an organisation's staff verified it. */
export function credentialEvidence(row: any): EvidenceClass {
  return row?.verified === true ? "institution_verified" : "self_declared";
}

export async function loadIndividualPassport(admin: any, userId: string, today: string): Promise<IndividualPassport> {
  const settle = async (p: PromiseLike<any>) => {
    try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; }
  };
  const [decRows, credRows, empRows] = await Promise.all([
    settle(admin.from("competency_decisions")
      .select("competency_id, outcome, expiry_date, created_at, hospital_id, organisation_id, framework_competencies(name)")
      .eq("nurse_id", userId).order("created_at", { ascending: false }).limit(3000)),
    settle(admin.from("professional_credentials")
      .select("title, credential_type, issuing_body, expiry_date, status, verified, issue_date")
      .eq("nurse_id", userId).order("issue_date", { ascending: false }).limit(100)),
    settle(admin.from("employment_records")
      .select("role_title, status, start_date, end_date, hospital_id, organisation_id")
      .eq("nurse_id", userId).order("start_date", { ascending: false }).limit(50)),
  ]);

  // Issuer names: the organisations and facilities stamped on this person's own rows, and no others.
  const hospitalIds = new Set<string>();
  const orgIds = new Set<string>();
  for (const r of [...(decRows ?? []), ...(empRows ?? [])]) {
    if (r?.hospital_id) hospitalIds.add(r.hospital_id);
    if (r?.organisation_id) orgIds.add(r.organisation_id);
  }
  const [hosp, orgs] = await Promise.all([
    hospitalIds.size ? settle(admin.from("hospitals").select("id, name").in("id", [...hospitalIds])) : Promise.resolve([]),
    orgIds.size ? settle(admin.from("organisations").select("id, name").in("id", [...orgIds])) : Promise.resolve([]),
  ]);
  const names = new Map<string, string>();
  for (const r of [...(hosp ?? []), ...(orgs ?? [])]) if (r?.id && r?.name) names.set(r.id, r.name);
  const issuerName = (r: any): string | null => names.get(r?.hospital_id) ?? names.get(r?.organisation_id) ?? null;

  return {
    competencies: decRows === null ? null : latestDecisions(decRows, today, issuerName),
    credentials: credRows === null ? null : credRows.map((c: any) => ({
      title: c.title,
      type: String(c.credential_type ?? "credential"),
      issuingBody: c.issuing_body ?? null,
      issueDate: c.issue_date ?? null,
      expiryDate: c.expiry_date ?? null,
      status: String(c.status ?? "unknown"),
      evidence: credentialEvidence(c),
    })),
    employment: empRows === null ? null : empRows.map((e: any) => ({
      roleTitle: e.role_title ?? "Role not recorded",
      organisation: issuerName(e),
      status: String(e.status ?? "unknown"),
      startDate: e.start_date ?? null,
      endDate: e.end_date ?? null,
    })),
  };
}
