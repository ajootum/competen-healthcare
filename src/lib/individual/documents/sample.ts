import type { DocRecord } from "./model";

// ── SAMPLE RECORDS FOR A TEMPLATE PREVIEW ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.3 ────────────────────────────────
//
// Invented, clearly fictional records the HQ Document Template Studio previews a template with, so an administrator sees
// every kind of entry and every status wording without reading any person's records. Never shown to a person as theirs.

export const SAMPLE_PERSON = { name: "Sample Professional", email: "sample@example.org", headline: "Registered clinician (sample record)" };

export const SAMPLE_RECORDS: DocRecord[] = [
  { key: "sample:reg", kind: "profile_item", sections: ["registrations"], title: "Professional registration (sample)", subtitle: "A regulatory body", from: "2019-03-01", to: null, date: null,
    trust: "independent", validity: "current", source: "Professional profile", facts: [{ code: "jurisdiction", label: "Jurisdiction", value: "Sample jurisdiction" }] },
  { key: "sample:job", kind: "profile_item", sections: ["employment"], title: "Clinical role (sample)", subtitle: "A teaching hospital", from: "2020-01-01", to: null, date: null,
    trust: "self_declared", validity: "not_applicable", source: "Professional profile", facts: [] },
  { key: "sample:qual", kind: "profile_item", sections: ["education", "qualifications"], title: "Degree in a health profession (sample)", subtitle: "A university", from: null, to: null, date: "2018-07-15",
    trust: "document_supported", validity: "not_applicable", source: "Professional profile", facts: [] },
  { key: "sample:course", kind: "learning_record", sections: ["learning_cpd", "qualifications"], title: "ECG interpretation course (sample)", subtitle: "Competen Learning", from: null, to: null, date: "2026-09-10",
    trust: "formative", validity: "not_applicable", source: "Competen Learning", facts: [{ code: "outcome", label: "Outcome", value: "Assessed knowledge" }, { code: "hours", label: "Hours", value: "6" }] },
  { key: "sample:cpd", kind: "cpd", sections: ["learning_cpd"], title: "Resuscitation update (sample)", subtitle: "A training centre", from: null, to: null, date: "2026-05-02",
    trust: "self_declared", validity: "not_applicable", source: "CPD log", facts: [{ code: "hours", label: "Hours", value: "3" }] },
  { key: "sample:comp", kind: "competency", sections: ["competencies", "verified_achievements"], title: "Interprets 12-lead ECGs (sample)", subtitle: "Sample framework v1.0", from: null, to: null, date: "2026-10-01",
    trust: "independent", validity: "current", source: "Competen verification", facts: [{ code: "method", label: "Method", value: "Direct observation" }] },
  { key: "sample:old", kind: "credential", sections: ["qualifications", "verified_achievements"], title: "Life support certificate (sample)", subtitle: "A training body", from: null, to: "2025-01-31", date: "2023-02-01",
    trust: "institution", validity: "expired", source: "Competen Passport", facts: [] },
];
