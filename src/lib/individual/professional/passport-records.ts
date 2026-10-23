/* eslint-disable @typescript-eslint/no-explicit-any */
import { CPD_ACTIVITY_LABEL, isOwnEvidenceClass, type OwnEvidenceClass } from "./vocabulary";
import { hasProfile, loadProfessionalRecord, type ProfessionalRecord } from "./record";
import { listMappings, type SubjectMapping } from "./mapping-store";
import { referenceNames } from "./frameworks";

// ── THE PERSON'S OWN RECORDS, AS THE PASSPORT SHOWS THEM ── COMPETEN-IND-007 s5, owner ruling D3 ─────────
//
// The Competen Passport composes two classes of record (COMPETEN-IND-002 s4.1 item 4):
//   (a) the person's own records, labelled by PROVENANCE -- this file
//   (b) institution-issued records about them, labelled by ISSUER -- src/lib/individual/passport.ts
//
// ⚠ THE RECORDS BELONG TO THE PERSON, NOT TO AN EXPERIENCE (COMPETEN-IND-002 s5.1). They appear in the
// Passport whichever experience shows it, and they stay after a Professional entitlement ends. Writing
// them needs Professional to be live. Reading your own does not.
//
// ⚠ AND THE SAME ITEMS, IN THE SAME WORDS, ON /verify. The public verification page renders exactly these
// items for a link minted from Competen Professional, so the person can never be shown one description
// of their record and a third party another.

/** The registration item's title when the person recorded a body or number but no profession. */
export const PROFESSION_NOT_RECORDED = "Profession not recorded";

export type OwnRecordKind = "registration" | "credential" | "competency_evidence" | "cpd";

export type OwnRecord = {
  kind: OwnRecordKind;
  title: string;
  detail: string | null;
  /** The date the item is about: issued, completed, or the registration expiry. */
  date: string | null;
  expires: string | null;
  evidence: OwnEvidenceClass;
  /**
   * The competencies the person linked this item to and accepted (migration 393, and the single 373 link on
   * evidence), by name. Self-declared like the item -- nobody verified the link. Empty: none linked or not
   * readable; the item itself is still true either way.
   */
  competencies: string[];
};

export const OWN_KIND_LABEL: Record<OwnRecordKind, string> = {
  registration: "Professional registration",
  credential: "Credential",
  competency_evidence: "Competency evidence",
  cpd: "CPD activity",
};

/** Pure: the accepted competency names per item key ("cpd:<id>", "evidence:<id>"). A proposal is never shown. */
export function acceptedLinks(record: ProfessionalRecord, mappings: readonly SubjectMapping[] | null, names: ReadonlyMap<string, string>): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const add = (key: string, id: string) => { const n = names.get(id); if (n) out.set(key, (out.get(key) ?? new Set()).add(n)); };
  for (const m of mappings ?? []) if (m.state === "accepted" && m.kind !== "goal") add(`${m.kind}:${m.subjectId}`, m.competencyId);
  for (const e of record.evidence ?? []) if (e.framework_competency_id) add(`evidence:${e.id}`, e.framework_competency_id);
  return new Map([...out].map(([k, v]) => [k, [...v].sort()]));
}

/** Pure: the Passport items of one record. Null in, null out -- an unread record is not an empty one. */
export function ownRecordsFrom(record: ProfessionalRecord, links: ReadonlyMap<string, string[]> = new Map()): OwnRecord[] | null {
  if (record.profile === null || record.evidence === null || record.cpd === null) return null;
  const out: OwnRecord[] = [];
  const p = record.profile;
  if (hasProfile(p)) {
    out.push({
      kind: "registration",
      title: p.self_declared_profession ?? PROFESSION_NOT_RECORDED,
      detail: [p.self_declared_registration_body, p.self_declared_registration_number ? `No. ${p.self_declared_registration_number}` : null,
        p.self_declared_registration_country].filter(Boolean).join(" · ") || null,
      date: null,
      expires: p.self_declared_registration_expires_on,
      // Migration 270's rule: the profile's facts are self-declared by their column names.
      evidence: "self_declared",
      competencies: [],
    });
  }
  for (const e of record.evidence) {
    if (!isOwnEvidenceClass(e.evidence_class)) continue;
    out.push({
      kind: e.kind === "credential" ? "credential" : "competency_evidence",
      title: e.title,
      detail: e.issuing_body,
      date: e.issued_on,
      expires: e.expires_on,
      evidence: e.evidence_class,
      competencies: links.get(`evidence:${e.id}`) ?? [],
    });
  }
  for (const c of record.cpd) {
    if (!isOwnEvidenceClass(c.evidence_class)) continue;
    out.push({
      kind: "cpd",
      title: c.title,
      detail: `${CPD_ACTIVITY_LABEL[c.activity_type] ?? "Activity"} · ${c.hours} ${c.hours === 1 ? "hour" : "hours"}`,
      date: c.activity_date,
      expires: null,
      evidence: c.evidence_class,
      competencies: links.get(`cpd:${c.id}`) ?? [],
    });
  }
  return out;
}

export async function loadOwnRecords(admin: any, userId: string): Promise<OwnRecord[] | null> {
  const [record, mappings] = await Promise.all([loadProfessionalRecord(admin, userId), listMappings(admin, userId)]);
  const ids = [...new Set([
    ...(mappings ?? []).filter(m => m.state === "accepted").map(m => m.competencyId),
    ...(record.evidence ?? []).map(e => e.framework_competency_id).filter((v): v is string => !!v),
  ])];
  // Shared framework competencies only (referenceNames reads hospital_id null), so no organisation is named.
  const names = ids.length ? await referenceNames(admin, [], ids) : new Map<string, string>();
  return ownRecordsFrom(record, acceptedLinks(record, mappings, names));
}

/** Pure: counts by kind and by class, for the summary link and the personal AI's context. */
export function summariseOwn(items: readonly OwnRecord[]) {
  const byKind: Record<OwnRecordKind, number> = { registration: 0, credential: 0, competency_evidence: 0, cpd: 0 };
  const byClass: Record<OwnEvidenceClass, number> = { self_declared: 0, source_linked: 0 };
  for (const i of items) { byKind[i.kind]++; byClass[i.evidence]++; }
  return { total: items.length, byKind, byClass };
}
