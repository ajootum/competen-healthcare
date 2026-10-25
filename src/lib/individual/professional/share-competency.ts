/* eslint-disable @typescript-eslint/no-explicit-any */
import { isUuid } from "./validate";
import { SELF_REPORTED, SHARE_PARTS, SHAREABLE_KINDS, type SharePart } from "./competency-vocabulary";
import { linkKind, linkSourceId, loadPortfolio, type EvidenceLink } from "./competency-store";
import { currentDecision, loadVerifications } from "./competency-verification";

// ── COMPETENCIES A PERSON CHOOSES TO SHOW ON ONE PASSPORT LINK ── COMPETEN-PROFESSIONAL-COMPETENCY-01 S11, migration 520 ──
//
// Selective, never automatic: nothing is shared unless the person ticks it for that link, part by part (a self-assessment,
// the evidence, independent verification outcomes), and only parts the configuration offers. Checked when the link is
// made AND when it is shown, so an entry removed later, or a part the configuration withdraws, leaves an old link too.
//
// ⚠ THE FOUR ARE SHOWN APART. A self-assessment is labelled self-reported; evidence keeps its own class and says it is
// not verification; verification outcomes are only those an appointed assessor recorded, current, read from C5.
// ⚠ NEVER REFLECTIONS. Neither a self-assessment's reflection nor a reflection linked as evidence has a path here.

export type ShareCompetencyChoice = { myCompetencyId: string; parts: SharePart[] };

/** Pure: the competency parts ticked on the share form (fields named competency:<entry id>:<part>). */
export function parseShareCompetencies(b: Record<string, unknown>): ShareCompetencyChoice[] {
  const ticked = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";
  const by = new Map<string, Set<SharePart>>();
  for (const k of Object.keys(b)) {
    const m = /^competency:([0-9a-f-]{36}):([a-z_]+)$/i.exec(k);
    if (!m || !ticked(b[k]) || !isUuid(m[1]) || !(SHARE_PARTS as readonly string[]).includes(m[2])) continue;
    by.set(m[1], (by.get(m[1]) ?? new Set()).add(m[2] as SharePart));
  }
  return [...by].slice(0, 100).map(([myCompetencyId, parts]) => ({ myCompetencyId, parts: [...parts] }));
}

/** Before minting: every chosen entry is the person's own and current, and every part is offered. null = fine. */
export async function checkShareCompetencies(admin: any, userId: string, choices: readonly ShareCompetencyChoice[], offeredParts: readonly SharePart[]): Promise<string | null> {
  if (!choices.length) return null;
  if (choices.some(c => c.parts.some(p => !offeredParts.includes(p)))) return "That part of a competency cannot be shared.";
  const { data, error } = await admin.from("individual_professional_my_competency").select("id").eq("user_id", userId).is("removed_at", null).in("id", choices.map(c => c.myCompetencyId));
  if (error) return "Your competencies could not be checked just now. Try again shortly.";
  return (data ?? []).length === choices.length ? null : "Only competencies in your own My Competencies may be added to a link.";
}

export type SharedCompetency = {
  title: string; frameworkVersion: string | null; personal: boolean;
  selfAssessment: { level: string; scale: string | null; outcome: string | null; assessedAt: string; label: string } | null;
  evidence: { title: string; classText: string; relation: string; outcome: string | null }[] | null;
  assessed: { outcome: string; level: string | null; assessor: string; authority: string; decidedAt: string; validUntil: string | null }[] | null;
  assessedUnavailable: boolean;
};

/** For /verify: the competencies a link carries, re-checked now. null = could not be read, [] = none. */
export async function loadSharedCompetencies(admin: any, tokenId: string, userId: string, offeredParts: readonly SharePart[], today: string): Promise<SharedCompetency[] | null> {
  try {
    const { data: rows, error } = await admin.from("individual_professional_share_competency")
      .select("my_competency_id, include_self_assessment, include_evidence, include_assessed_outcomes").eq("share_token_id", tokenId).eq("user_id", userId).limit(100);
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? [] : null;
    if (!rows?.length) return [];
    const ids = rows.map((r: any) => r.my_competency_id);
    const [{ data: entries }, { data: assess }, { data: links }] = await Promise.all([
      admin.from("individual_professional_my_competency").select("id, kind, framework_competency_id, framework_version, title").eq("user_id", userId).is("removed_at", null).in("id", ids),
      admin.from("individual_professional_self_assessment").select("my_competency_id, learning_outcome, scale_label, level_label, assessed_at").eq("user_id", userId).in("my_competency_id", ids).order("assessed_at", { ascending: false }),
      admin.from("individual_professional_competency_evidence").select("*").eq("user_id", userId).in("my_competency_id", ids).is("unlinked_at", null),
    ]);
    const needsEvidence = rows.some((r: any) => r.include_evidence && offeredParts.includes("evidence"));
    const portfolio = needsEvidence ? (await loadPortfolio(admin, userId, today)).items : [];
    const verifications = rows.some((r: any) => r.include_assessed_outcomes && offeredParts.includes("assessed_outcomes")) ? await loadVerifications(admin, userId) : null;
    return (entries ?? []).map((e: any) => {
      const r = rows.find((x: any) => x.my_competency_id === e.id);
      const sa = (assess ?? []).find((a: any) => a.my_competency_id === e.id);
      const ev = (links ?? []).filter((l: EvidenceLink) => l.my_competency_id === e.id && SHAREABLE_KINDS.includes(linkKind(l)))
        .map((l: EvidenceLink) => ({ l, src: portfolio.find(p => p.kind === linkKind(l) && p.id === linkSourceId(l)) }))
        .filter((x: any) => x.src).map((x: any) => ({ title: x.src.title, classText: x.src.classText, relation: x.l.relation_label, outcome: x.l.learning_outcome }));
      const vs = verifications && verifications.provisioned && verifications.items
        ? verifications.items.filter(v => v.competency.frameworkCompetencyId === e.framework_competency_id).flatMap(v => v.decisions.filter(d => currentDecision(d, today)))
        : null;
      return {
        title: e.title, frameworkVersion: e.framework_version, personal: e.kind === "personal",
        selfAssessment: r.include_self_assessment && offeredParts.includes("self_assessment") && sa
          ? { level: sa.level_label, scale: sa.scale_label, outcome: sa.learning_outcome, assessedAt: sa.assessed_at, label: SELF_REPORTED } : null,
        evidence: r.include_evidence && offeredParts.includes("evidence") ? ev : null,
        assessed: r.include_assessed_outcomes && offeredParts.includes("assessed_outcomes") && vs
          ? vs.map(d => ({ outcome: d.outcomeLabel, level: d.level, assessor: d.assessorName, authority: d.authority, decidedAt: d.decidedAt, validUntil: d.validUntil })) : null,
        assessedUnavailable: !!r.include_assessed_outcomes && (!verifications || !verifications.provisioned || verifications.items === null),
      };
    });
  } catch { return null; }
}
