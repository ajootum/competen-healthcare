/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "./access";
import { loadIndividualPassport } from "./passport";
import { loadProfessionalRecord } from "./professional/record";
import { loadSharedProfile } from "./professional/share-profile";
import { loadSharedLearning } from "./professional/share-learning";
import { loadSharedCompetencies } from "./professional/share-competency";
import { METHOD_LABEL, VERIFICATION_LABEL, isIndependentlyVerified } from "./professional/profile-verification";
import { ITEM_LABEL } from "./professional/profile-vocabulary";
import type { PassportPolicy, ProfessionalCompetencyPolicy, ProfessionalProfilePolicy } from "./policy";
import type { LcpdConfig } from "./lcpd-config";
import { CATEGORY_LABEL, TRUST_LABEL, VALIDITY_LABEL, lapsed, type PassportCategory, type Trust, type Validity } from "./passport-vocabulary";

// ── THE PASSPORT, AS ONE LINK SHOWS IT ── COMPETEN-PROFESSIONAL-PASSPORT-01 (Stage 7) P2 P3 P4 P5 ─────────────────────
//
// ⚠ ONE READ, MANY USES. loadPassportSelection is what a link carries, normalised: the owner's in-app PREVIEW, the
// recipient's /verify page, the printable EXPORT and Stage 8's Document Studio all read THIS, so what the person
// previews is exactly what the recipient sees. Nothing here writes, and nothing is copied: each item is read NOW from
// its owning service (Professional profile, CPD and evidence, Competen Learning, Stage 5 competencies and C5, Scholar,
// organisation records), so a revocation, expiry or supersession shows the moment it happens.
//
// ⚠ RECORD-LEVEL ONLY (coordinator ruling, 25 Oct). A link carries a record of the person's own only because it was
// chosen for THAT link: 540's record selection, or the per-link selections of 453, 491 and 520. A link with no 540
// view carries none of the person's CPD, evidence or Scholar items. Organisation-issued records travel only when the
// view says so.
//
// ⚠ TRUST, VALIDITY AND MEANING ARE NEVER UPGRADED. Each item keeps what its source says: self-declared stays
// self-declared, a course completion stays a completion, Scholar stays educational and formative, and only an
// appointed assessor's current outcome (C5) or a staff-verified credential is "independently verified".

export { CATEGORY_LABEL, TRUST_LABEL, VALIDITY_LABEL };
export type { PassportCategory, Trust, Validity };

export type PassportItem = {
  key: string; category: PassportCategory; sourceService: string; title: string; description: string | null;
  issuer: string | null; date: string | null; version: string | null; evidenceRef: string | null; method: string | null;
  authority: string | null; trust: Trust; validity: Validity; meaning: string;
};
export type PassportViewMeta = {
  shareTokenId: string; purposeLabel: string | null; recipientLabel: string | null; summary: string | null; includeInstitution: boolean; activatedAt: string | null;
};
export type PassportSelection = { meta: PassportViewMeta | null; items: PassportItem[]; unreadable: PassportCategory[] };

/** The 540 view of a link: null when the link has none (it then carries none of the person's own records). */
export async function loadViewMeta(admin: any, shareTokenId: string, userId: string): Promise<PassportViewMeta | null | "unreadable"> {
  try {
    const { data, error } = await admin.from("individual_passport_share_view").select("share_token_id, purpose_label, recipient_label, summary, include_institution, activated_at")
      .eq("share_token_id", shareTokenId).eq("user_id", userId).maybeSingle();
    if (error) return isNotProvisioned(error) ? null : "unreadable";
    return data ? { shareTokenId: data.share_token_id, purposeLabel: data.purpose_label, recipientLabel: data.recipient_label, summary: data.summary,
      includeInstitution: !!data.include_institution, activatedAt: data.activated_at } : null;
  } catch { return "unreadable"; }
}

const expiryValidity = (expires: string | null, today: string): Validity => (!expires ? "not_applicable" : expires < today ? "expired" : "current");

/**
 * What one link carries, now. For a link with a 540 view: exactly the records chosen for it, of every kind. For a link
 * without one: only the per-link selections of 453, 491 and 520, and never the person's CPD, evidence or Scholar items.
 */
export async function loadPassportSelection(admin: any, userId: string, shareTokenId: string, ctx: {
  today: string; profile: ProfessionalProfilePolicy; competency: ProfessionalCompetencyPolicy; lcpd: LcpdConfig; passport: Pick<PassportPolicy, "shareable" | "validity">;
}): Promise<PassportSelection> {
  const unreadable: PassportCategory[] = [];
  const items: PassportItem[] = [];
  const metaRead = await loadViewMeta(admin, shareTokenId, userId);
  const meta = metaRead === "unreadable" ? null : metaRead;
  if (metaRead === "unreadable") unreadable.push("cpd", "evidence", "study", "evaluation");

  const [profile, learning, competencies] = await Promise.all([
    loadSharedProfile(admin, shareTokenId, userId, ctx.profile.shareSections, ctx.today),
    loadSharedLearning(admin, shareTokenId, userId, ctx.lcpd),
    loadSharedCompetencies(admin, shareTokenId, userId, ctx.competency.shareParts, ctx.today),
  ]);

  // Professional profile (453): each record keeps its own class and verification state.
  if (profile === null) unreadable.push("profile");
  for (const [i, r] of (profile?.records ?? []).entries()) {
    const verified = isIndependentlyVerified(r.verification.state);
    items.push({
      key: `profile:${i}`, category: "profile", sourceService: "Competen Professional profile", title: r.title,
      description: [r.typeLabel, r.organisation, r.jurisdiction].filter(Boolean).join(" · ") || null, issuer: r.organisation,
      date: r.startedOn, version: null, evidenceRef: r.evidenceClass === "source_linked" ? "A document is attached (not shared)" : null,
      method: verified && r.verification.method ? METHOD_LABEL[r.verification.method] ?? r.verification.method : null,
      authority: verified ? "A Competen verifier, independent of the professional" : null,
      trust: verified ? "independently_verified" : r.evidenceClass === "source_linked" ? "document_supported" : "self_declared",
      validity: r.verification.state === "revoked" ? "revoked" : r.verification.state === "expired" ? "expired" : expiryValidity(r.expiresOn, ctx.today),
      meaning: `${ITEM_LABEL[r.section]} recorded by the professional${verified ? "" : `; ${VERIFICATION_LABEL[r.verification.state].toLowerCase()}`}`,
    });
  }
  if (profile?.overview) {
    const o = profile.overview;
    items.push({ key: "profile:overview", category: "profile", sourceService: "Competen Professional profile", title: "Professional overview",
      description: [o.profession, o.title, o.specialty, o.setting, o.status, o.jurisdiction].filter(Boolean).join(" · ") || null,
      issuer: null, date: null, version: null, evidenceRef: null, method: null, authority: null, trust: "self_declared", validity: "not_applicable", meaning: "Declared by the professional" });
  }

  // Competen Learning (491).
  if (learning === null) unreadable.push("learning");
  for (const l of learning ?? []) items.push({
    key: `learning:${l.recordId}`, category: "learning", sourceService: "Competen Learning", title: l.title, description: l.certificateNos.length ? `Certificate ${l.certificateNos.join(", ")}` : null,
    issuer: l.provider, date: l.completedOn, version: `version ${l.versionNo}`, evidenceRef: null, method: null, authority: null,
    trust: /self-declared/i.test(l.provenance) ? (/document/i.test(l.provenance) ? "document_supported" : "self_declared") : "platform_recorded",
    validity: "not_applicable", meaning: l.provenance,
  });

  // Stage 5 competencies (520): self-assessment, evidence and C5 outcomes stay three different items.
  if (competencies === null) unreadable.push("competency");
  for (const [i, c] of (competencies ?? []).entries()) {
    if (c.selfAssessment) items.push({
      key: `competency:${i}:self`, category: "competency", sourceService: "Competen Professional competencies", title: c.title,
      description: `Self-assessed ${c.selfAssessment.level}${c.selfAssessment.scale ? ` (${c.selfAssessment.scale})` : ""}${c.selfAssessment.outcome ? ` for "${c.selfAssessment.outcome}"` : ""}`,
      issuer: null, date: c.selfAssessment.assessedAt, version: c.frameworkVersion, evidenceRef: null, method: "Self-assessment", authority: null,
      trust: "self_declared", validity: "not_applicable", meaning: `${c.selfAssessment.label}: the professional's own view, not verification`,
    });
    for (const [j, e] of (c.evidence ?? []).entries()) items.push({
      key: `competency:${i}:evidence:${j}`, category: "competency", sourceService: "Competen Professional competencies", title: `${c.title}: ${e.title}`,
      description: `${e.relation}${e.outcome ? ` for "${e.outcome}"` : ""}`, issuer: null, date: null, version: c.frameworkVersion, evidenceRef: e.classText,
      method: null, authority: null, trust: /document/i.test(e.classText) ? "document_supported" : /Competen Learning/i.test(e.classText) ? "platform_recorded" : /formative|educational/i.test(e.classText) ? "educational" : "self_declared",
      validity: "not_applicable", meaning: "Supporting evidence linked by the professional, not verification",
    });
    for (const [j, a] of (c.assessed ?? []).entries()) items.push({
      key: `competency:${i}:verified:${j}`, category: "competency", sourceService: "Competen Verification Studio", title: c.title,
      description: `${a.outcome}${a.level ? ` at ${a.level}` : ""}`, issuer: a.assessor, date: a.decidedAt, version: c.frameworkVersion, evidenceRef: null,
      method: null, authority: a.authority, trust: a.verified ? "independently_verified" : "assessed", validity: expiryValidity(a.validUntil, ctx.today) === "expired" ? "expired" : "current",
      meaning: a.verified ? "Verified at this level by an appointed assessor, independent of the professional" : "An outcome recorded by an appointed assessor that is not a full verification",
    });
  }

  // 540: the person's own CPD, evidence and Scholar items, ONLY as chosen for this link.
  if (meta) {
    const { data: rows, error } = await admin.from("individual_passport_share_record").select("cpd_id, evidence_id, study_item_id, scholar_evaluation_id")
      .eq("share_token_id", shareTokenId).eq("user_id", userId);
    if (error) unreadable.push("cpd", "evidence", "study", "evaluation");
    const chosen = (rows ?? []) as { cpd_id: string | null; evidence_id: string | null; study_item_id: string | null; scholar_evaluation_id: string | null }[];
    const want = (k: keyof (typeof chosen)[number]) => new Set(chosen.map(r => r[k]).filter((v): v is string => !!v));
    const cpdIds = want("cpd_id"), evIds = want("evidence_id"), studyIds = want("study_item_id"), evalIds = want("scholar_evaluation_id");
    const needRecord = cpdIds.size + evIds.size > 0, needPassport = studyIds.size + evalIds.size > 0 || meta.includeInstitution;
    const [record, passport] = await Promise.all([
      needRecord ? loadProfessionalRecord(admin, userId) : Promise.resolve(null),
      needPassport ? loadIndividualPassport(admin, userId, ctx.today) : Promise.resolve(null),
    ]);
    if (record && record.cpd === null) unreadable.push("cpd");
    for (const c of (record?.cpd ?? []).filter(c => cpdIds.has(c.id))) items.push({
      key: `cpd:${c.id}`, category: "cpd", sourceService: "Competen Professional CPD", title: c.title, description: c.hours != null ? `${c.hours} hours` : null,
      issuer: c.provider, date: c.activity_date, version: null, evidenceRef: c.evidence_class === "source_linked" ? "A document is attached (not shared)" : null, method: null, authority: null,
      trust: c.evidence_class === "source_linked" ? "document_supported" : "self_declared", validity: "not_applicable", meaning: "A development activity recorded by the professional",
    });
    if (record && record.evidence === null) unreadable.push("evidence");
    for (const e of (record?.evidence ?? []).filter(e => evIds.has(e.id))) items.push({
      key: `evidence:${e.id}`, category: "evidence", sourceService: "Competen Professional evidence", title: e.title, description: null,
      issuer: e.issuing_body, date: e.issued_on, version: null, evidenceRef: e.evidence_class === "source_linked" ? "A document is attached (not shared)" : null, method: null, authority: null,
      trust: e.evidence_class === "source_linked" ? "document_supported" : "self_declared", validity: expiryValidity(e.expires_on, ctx.today),
      meaning: e.kind === "credential" ? "A credential recorded by the professional, not verified" : "Supporting evidence recorded by the professional, not verified",
    });
    if (passport && studyIds.size) {
      if (!passport.study.ok) unreadable.push("study");
      for (const s of passport.study.ok ? passport.study.data.filter(s => s.itemId && studyIds.has(s.itemId)) : []) items.push({
        key: `study:${s.itemId}`, category: "study", sourceService: "Competen Scholar", title: s.label, description: `${s.answered} answered`,
        issuer: "Competen Scholar", date: s.lastStudied, version: null, evidenceRef: null, method: "Self-directed practice", authority: null,
        trust: "educational", validity: "not_applicable", meaning: "Self-directed study on the student's own notes: not an assessment and not a verified competency",
      });
    }
    if (passport && evalIds.size) {
      if (!passport.evaluations.ok) unreadable.push("evaluation");
      for (const v of passport.evaluations.ok ? passport.evaluations.data.filter(v => v.itemId && evalIds.has(v.itemId)) : []) items.push({
        key: `evaluation:${v.itemId}`, category: "evaluation", sourceService: "Competen Scholar", title: v.label,
        description: v.dimensions.map(d => `${d.name}: ${d.reads}`).join(" · "), issuer: "Competen Scholar", date: v.madeAt, version: null, evidenceRef: null,
        method: v.method, authority: null, trust: "educational", validity: "not_applicable", meaning: `Educational evaluation, formative (confidence: ${v.confidence}); never a credential`,
      });
    }
    if (passport && meta.includeInstitution) {
      if (passport.competencies === null || passport.credentials === null) unreadable.push("institution");
      for (const c of (passport.competencies ?? []).filter(c => c.current)) items.push({
        key: `institution:competency:${c.competencyId}`, category: "institution", sourceService: "Organisation competency record", title: c.name, description: c.outcome.replace(/_/g, " "),
        issuer: c.issuer, date: c.decidedAt, version: null, evidenceRef: null, method: null, authority: c.issuer, trust: "assessed",
        validity: expiryValidity(c.expiryDate, ctx.today), meaning: "A competency decision an organisation recorded",
      });
      for (const [i, c] of (passport.credentials ?? []).filter(c => c.evidence === "institution_verified" || c.evidence === "institution_issued").entries()) items.push({
        key: `institution:credential:${i}`, category: "institution", sourceService: "Organisation credential record", title: c.title, description: c.type.replace(/_/g, " "),
        issuer: c.issuingBody, date: c.issueDate, version: null, evidenceRef: null, method: null,
        authority: c.evidence === "institution_verified" ? "Verified by an organisation's staff" : c.issuingBody,
        trust: c.evidence === "institution_verified" ? "independently_verified" : "assessed", validity: c.status === "revoked" ? "revoked" : expiryValidity(c.expiryDate, ctx.today),
        meaning: c.evidence === "institution_verified" ? "A credential an organisation verified" : "A credential an organisation issued",
      });
    }
  }
  return { meta, items: presentable(items, ctx.passport), unreadable: [...new Set(unreadable)] };
}

/** Pure: only kinds the configuration lets a link carry, and lapsed records left off when it says so. Never upgraded. */
export function presentable(items: readonly PassportItem[], p: Pick<PassportPolicy, "shareable" | "validity">): PassportItem[] {
  return items.filter(i => p.shareable.includes(i.category) && !(p.validity === "hide" && lapsed(i.validity)));
}

/** Pure: items in the configured section order; categories not in the order come last, never dropped. */
export function orderItems(items: readonly PassportItem[], order: readonly PassportCategory[]): PassportItem[] {
  const rank = (c: PassportCategory) => { const i = order.indexOf(c); return i < 0 ? order.length : i; };
  return [...items].sort((a, b) => rank(a.category) - rank(b.category));
}
