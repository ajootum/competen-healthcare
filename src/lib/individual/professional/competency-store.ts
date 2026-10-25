/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { loadIndividualPassport } from "../passport";
import { CLASS_TEXT, SHAREABLE_KINDS, PORTFOLIO_COLUMN, PORTFOLIO_KIND_LABEL, type PortfolioKind } from "./competency-vocabulary";
import type { EntryColumns, EvidenceLinkInput, ScaleLevel, SelfAssessmentColumns } from "./competency-form";
import { loadProfessionalRecord } from "./record";
import { loadProfessionalLearning } from "./learning";
import { loadProfessionalProfile } from "./profile-store";
import { loadNeedsWorkspace } from "./needs-store";
import { ORIGIN } from "./vocabulary";

// ── MY COMPETENCIES, SELF-ASSESSMENTS AND EVIDENCE LINKS ── COMPETEN-PROFESSIONAL-COMPETENCY-01, migration 520 ─────
//
// THE ONE WRITER of 520's tables, by the person's own id. History is 520's TRIGGER's, never written here.
// Self-assessments are insert-only. Evidence links are unlinked once, never rewritten or deleted.
//
// ⚠ THE PORTFOLIO IS A VIEW, NOT A COPY. It lists the person's own authoritative records -- CPD, Competen Learning,
// evidence and credentials, profile records, reflections, and the Scholar study they chose to show on their Passport --
// each with the class its own record holds. Nothing is copied into 520: a link names the record by composite key.
//
// ⚠ C5 BOUNDARY. Verification belongs to the Verification Studio (COMPETEN-IND-007, migrations 510-519). Nothing here
// writes a request, a decision or an assessor. evidenceForVerification is what C5 is handed. THE AGREED REFLECTION RULE
// (owner: "private reflections remain private unless deliberately shared"): a reflection is handed over ONLY when the
// person ticked that reflection for that request. Never by default, never automatically. C5 snapshots provenance.
//
// ⚠ NOT PROVISIONED IS NOT UNREADABLE. Before 520 is applied, `provisioned` is false and the page says so.

const ENTRY_COLUMNS = "id, kind, framework_id, framework_competency_id, framework_version, title, description, category_code, category_label, interest, interest_note, added_at, removed_at, updated_at";
const ASSESS_COLUMNS = "id, my_competency_id, learning_outcome, framework_version, scale_label, level_score, level_label, confidence_label, reflection, development_interest, basis, assessed_at";
const LINK_COLUMNS = "id, my_competency_id, cpd_id, learning_record_id, evidence_id, profile_item_id, reflection_id, study_achievement_id, learning_outcome, framework_version, relation_code, relation_label, source, model, linked_at, unlinked_at";

export type CompetencyEntry = EntryColumns & { id: string; added_at: string; removed_at: string | null; updated_at: string };
export type SelfAssessment = {
  id: string; my_competency_id: string; learning_outcome: string | null; framework_version: string | null; scale_label: string | null; level_score: number | null;
  level_label: string; confidence_label: string | null; reflection: string | null; development_interest: boolean; basis: "self_reported"; assessed_at: string;
};
export type EvidenceLink = {
  id: string; my_competency_id: string; cpd_id: string | null; learning_record_id: string | null; evidence_id: string | null; profile_item_id: string | null;
  reflection_id: string | null; study_achievement_id: string | null; learning_outcome: string | null; framework_version: string | null;
  relation_code: string; relation_label: string; source: "person" | "ai"; model: string | null; linked_at: string; unlinked_at: string | null;
};
export type EntryHistoryRow = { my_competency_id: string; title: string; framework_version: string | null; interest: boolean; removed: boolean; recorded_at: string };

export type CompetencyWorkspace = {
  provisioned: boolean;
  entries: CompetencyEntry[] | null; history: EntryHistoryRow[] | null; assessments: SelfAssessment[] | null; links: EvidenceLink[] | null;
};

export async function loadCompetencyWorkspace(admin: any, userId: string): Promise<CompetencyWorkspace> {
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try {
      const r = await p;
      if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; }
      return r?.error ? null : (r?.data ?? []);
    } catch { return null; }
  };
  const [entries, history, assessments, links] = await Promise.all([
    settle(admin.from("individual_professional_my_competency").select(ENTRY_COLUMNS).eq("user_id", userId).order("added_at", { ascending: false }).limit(500)),
    settle(admin.from("individual_professional_my_competency_history").select("my_competency_id, title, framework_version, interest, removed, recorded_at").eq("user_id", userId).order("recorded_at", { ascending: false }).limit(3000)),
    settle(admin.from("individual_professional_self_assessment").select(ASSESS_COLUMNS).eq("user_id", userId).order("assessed_at", { ascending: false }).limit(3000)),
    settle(admin.from("individual_professional_competency_evidence").select(LINK_COLUMNS).eq("user_id", userId).order("linked_at").limit(5000)),
  ]);
  if (!provisioned) return { provisioned, entries: [], history: [], assessments: [], links: [] };
  return { provisioned, entries, history, assessments, links };
}

/** The levels of a CFCA proficiency scale: the scale of the competency's expected level, else the default scale. */
export async function loadScaleLevels(admin: any, expectedLevelId: string | null): Promise<ScaleLevel[] | null> {
  try {
    let scaleId: string | null = null;
    if (expectedLevelId) {
      const { data } = await admin.from("scoring_levels").select("scale_id").eq("id", expectedLevelId).maybeSingle();
      scaleId = data?.scale_id ?? null;
    }
    if (!scaleId) {
      const { data } = await admin.from("scoring_scales").select("id").eq("is_default", true).limit(1);
      scaleId = (data ?? [])[0]?.id ?? null;
    }
    if (!scaleId) return [];
    const [{ data: scale }, { data: levels, error }] = await Promise.all([
      admin.from("scoring_scales").select("name").eq("id", scaleId).maybeSingle(),
      admin.from("scoring_levels").select("id, scale_id, score, label").eq("scale_id", scaleId).order("score"),
    ]);
    if (error) return null;
    return (levels ?? []).map((l: any) => ({ id: l.id, scaleId: l.scale_id, scaleLabel: scale?.name ?? null, score: l.score, label: l.label }));
  } catch { return null; }
}

// ── THE PORTFOLIO (C3): A VIEW OF THE PERSON'S OWN RECORDS ──────────────────────────────────────────────────────

export type PortfolioItem = {
  kind: PortfolioKind; id: string; title: string; date: string | null; issuer: string | null; typeLabel: string | null;
  classText: string; shareable: boolean;
};

/** Every record the person may use as evidence, newest first. null = some source could not be read. */
export async function loadPortfolio(admin: any, userId: string, today: string): Promise<{ items: PortfolioItem[]; unreadable: string[] }> {
  const [record, learning, profile, needs, passport, typed] = await Promise.all([
    loadProfessionalRecord(admin, userId), loadProfessionalLearning(admin, userId), loadProfessionalProfile(admin, userId),
    loadNeedsWorkspace(admin, userId), loadIndividualPassport(admin, userId, today),
    // 520 evidence types, read apart from the 373 record so a database without 520 still lists every item.
    Promise.resolve(admin.from("individual_professional_evidence").select("id, evidence_type_label, author_name").eq("user_id", userId).limit(500)).then((r: any) => (r?.error ? [] : r?.data ?? []), () => []),
  ]);
  const typeOf = new Map((typed as any[]).map(t => [t.id, t]));
  const items: PortfolioItem[] = [];
  const unreadable: string[] = [];
  const cls = (c: string | null | undefined) => CLASS_TEXT[c ?? "self_declared"] ?? CLASS_TEXT.self_declared;
  if (record.cpd === null) unreadable.push(PORTFOLIO_KIND_LABEL.cpd);
  for (const c of record.cpd ?? []) items.push({ kind: "cpd", id: c.id, title: c.title, date: c.activity_date, issuer: c.provider, typeLabel: null, classText: cls(c.evidence_class), shareable: true });
  if (record.evidence === null) unreadable.push(PORTFOLIO_KIND_LABEL.evidence);
  for (const e of record.evidence ?? []) {
    const t = typeOf.get(e.id);
    items.push({ kind: "evidence", id: e.id, title: e.title, date: e.issued_on, issuer: t?.author_name ?? e.issuing_body, typeLabel: t?.evidence_type_label ?? null, classText: cls(e.evidence_class), shareable: true });
  }
  if (learning.enabled) {
    if (learning.refs === null) unreadable.push(PORTFOLIO_KIND_LABEL.learning_record);
    for (const r of learning.refs ?? []) items.push({ kind: "learning_record", id: r.recordId, title: r.title, date: r.completedOn, issuer: r.provider, typeLabel: r.outcomeLabel, classText: r.evidenceLabel, shareable: true });
  }
  for (const i of (profile.items ?? []).filter(i => !i.superseded_at && !i.withdrawn_at && i.section !== "aspiration" && i.section !== "interest"))
    items.push({ kind: "profile_item", id: i.id, title: i.title, date: i.started_on ?? i.created_at.slice(0, 10), issuer: i.organisation, typeLabel: i.type_label, classText: cls(i.evidence_class), shareable: true });
  for (const r of needs.reflections ?? [])
    items.push({ kind: "reflection", id: r.id, title: `Reflection${r.template_label ? `: ${r.template_label}` : ""}`, date: r.created_at.slice(0, 10), issuer: null, typeLabel: null, classText: CLASS_TEXT.private, shareable: false });
  if (passport.study.ok) {
    for (const s of passport.study.data) if (s.itemId)
      items.push({ kind: "study_achievement", id: s.itemId, title: s.label, date: s.lastStudied?.slice(0, 10) ?? null, issuer: "Competen Scholar", typeLabel: null, classText: CLASS_TEXT.educational, shareable: true });
  }
  return { items: items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")), unreadable };
}

export const linkKind = (l: EvidenceLink): PortfolioKind =>
  (Object.keys(PORTFOLIO_COLUMN) as PortfolioKind[]).find(k => (l as any)[PORTFOLIO_COLUMN[k]]) ?? "evidence";
export const linkSourceId = (l: EvidenceLink): string => (l as any)[PORTFOLIO_COLUMN[linkKind(l)]];

// ── WRITES ─────────────────────────────────────────────────────────────────────────────────────────────────

export type Write = { ok: true; id: string | null } | { ok: false; status: number; error: string };
const failed = (what: string, error?: any): Write => isNotProvisioned(error)
  ? { ok: false, status: 409, error: "My Competencies is not set up on this environment yet." }
  : String(error?.code) === "23503" ? { ok: false, status: 404, error: "That is not on your record." }
  : { ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` };
const notMine = (what: string): Write => ({ ok: false, status: 404, error: `That ${what} is not on your record.` });

/** Add an entry. Re-adding a catalogue competency that was removed brings the same entry back, history kept. */
export async function addEntry(admin: any, userId: string, cols: EntryColumns): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_my_competency").insert({ ...cols, user_id: userId, experience_code: ORIGIN }).select("id").single();
  if (!error && data) return { ok: true, id: data.id };
  if (String(error?.code) === "23505" && cols.framework_competency_id) {
    const { data: was } = await admin.from("individual_professional_my_competency").select("id, removed_at").eq("user_id", userId).eq("framework_competency_id", cols.framework_competency_id).maybeSingle();
    if (was && !was.removed_at) return { ok: false, status: 409, error: "That competency is already in My Competencies." };
    if (was) return setEntry(admin, userId, was.id, { removed: false, framework_version: cols.framework_version });
  }
  return failed("competency", error);
}

/** Remove (kept as history), bring back, or change the development interest. */
export async function setEntry(admin: any, userId: string, id: string, p: { removed?: boolean; interest?: boolean; interest_note?: string | null; framework_version?: string | null }): Promise<Write> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (p.removed !== undefined) patch.removed_at = p.removed ? now : null;
  if (p.interest !== undefined) patch.interest = p.interest;
  if (p.interest_note !== undefined) patch.interest_note = p.interest_note;
  if (p.framework_version !== undefined && p.framework_version !== null) patch.framework_version = p.framework_version;
  const { data, error } = await admin.from("individual_professional_my_competency").update(patch).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("competency", error);
  return data ? { ok: true, id } : notMine("competency");
}

/** A self-assessment. Always a new row: earlier ones are never changed, so the history is the record. */
export async function addSelfAssessment(admin: any, userId: string, entryId: string, cols: SelfAssessmentColumns): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_self_assessment").insert({ ...cols, my_competency_id: entryId, user_id: userId }).select("id").single();
  return error || !data ? failed("self-assessment", error) : { ok: true, id: data.id };
}

/** Link one existing record to a competency or one of its outcomes. An open link to the same record and outcome is not repeated. */
export async function linkEvidence(admin: any, userId: string, entry: { id: string; framework_version: string | null }, l: EvidenceLinkInput, ai?: { model: string; promptVersion: string }): Promise<Write> {
  const col = PORTFOLIO_COLUMN[l.kind];
  let q = admin.from("individual_professional_competency_evidence").select("id").eq("my_competency_id", entry.id).eq("user_id", userId).eq(col, l.sourceId).is("unlinked_at", null);
  q = l.learning_outcome === null ? q.is("learning_outcome", null) : q.eq("learning_outcome", l.learning_outcome);
  const { data: open } = await q.limit(1);
  if ((open ?? []).length) return { ok: false, status: 409, error: "That record is already linked there." };
  const { data, error } = await admin.from("individual_professional_competency_evidence").insert({
    my_competency_id: entry.id, user_id: userId, [col]: l.sourceId, learning_outcome: l.learning_outcome, framework_version: entry.framework_version,
    relation_code: l.relation_code, relation_label: l.relation_label, source: ai ? "ai" : "person", model: ai?.model ?? null, prompt_version: ai?.promptVersion ?? null,
  }).select("id").single();
  return error || !data ? failed("link", error) : { ok: true, id: data.id };
}

/** Unlink: kept as history (520 allows setting unlinked_at once, nothing else). */
export async function unlinkEvidence(admin: any, userId: string, linkId: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_competency_evidence").update({ unlinked_at: new Date().toISOString() })
    .eq("id", linkId).eq("user_id", userId).is("unlinked_at", null).select("id").maybeSingle();
  if (error) return failed("change", error);
  return data ? { ok: true, id: linkId } : { ok: false, status: 404, error: "That link is not current." };
}

// ── THE C5 INTERFACE (agreed with COMPETEN-IND-007) ───────────────────────────────────────────────────────────

export type CompetencyRef = { frameworkId: string; frameworkCompetencyId: string; frameworkVersion: string | null; title: string; learningOutcomes: string[] };
export type EvidenceRef = {
  linkId: string; kind: PortfolioKind; sourceId: string; title: string; evidenceClass: string; issuer: string | null;
  occurredOn: string | null; learningOutcome: string | null; relation: string; frameworkVersion: string | null;
};

/**
 * What a verification request is handed: a CATALOGUE entry of the person and its current evidence links, each resolved
 * to its source record with that record's own class. A private reflection is included only when its link is in
 * `explicitReflectionLinkIds` (the person ticked it for this request). A personal entry, a removed entry or another
 * person's entry gives null.
 */
export async function evidenceForVerification(admin: any, userId: string, entryId: string, linkIds?: readonly string[], outcomes: readonly string[] = [], today = new Date().toISOString().slice(0, 10), explicitReflectionLinkIds: readonly string[] = []): Promise<{ competency: CompetencyRef; evidence: EvidenceRef[] } | null> {
  const { data: e } = await admin.from("individual_professional_my_competency").select(ENTRY_COLUMNS).eq("id", entryId).eq("user_id", userId).maybeSingle();
  if (!e || e.kind !== "catalogue" || e.removed_at) return null;
  const { data: links } = await admin.from("individual_professional_competency_evidence").select(LINK_COLUMNS).eq("my_competency_id", entryId).eq("user_id", userId).is("unlinked_at", null);
  const portfolio = (await loadPortfolio(admin, userId, today)).items;
  const evidence: EvidenceRef[] = [];
  for (const l of (links ?? []) as EvidenceLink[]) {
    if (linkIds && !linkIds.includes(l.id)) continue;
    const kind = linkKind(l);
    if (!SHAREABLE_KINDS.includes(kind) && !(kind === "reflection" && explicitReflectionLinkIds.includes(l.id))) continue;
    const src = portfolio.find(p => p.kind === kind && p.id === linkSourceId(l));
    if (!src) continue;
    evidence.push({ linkId: l.id, kind: kind as EvidenceRef["kind"], sourceId: src.id, title: src.title, evidenceClass: src.classText, issuer: src.issuer,
      occurredOn: src.date, learningOutcome: l.learning_outcome, relation: l.relation_code, frameworkVersion: l.framework_version });
  }
  return { competency: { frameworkId: e.framework_id, frameworkCompetencyId: e.framework_competency_id, frameworkVersion: e.framework_version, title: e.title, learningOutcomes: [...outcomes] }, evidence };
}
