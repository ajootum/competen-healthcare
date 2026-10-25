/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { ORIGIN } from "./vocabulary";

// ── SHARING THE PASSPORT FROM COMPETEN PROFESSIONAL ── reuses passport_share_tokens and /verify ──────────
//
// ⚠ NOT A SECOND SHARE MECHANISM. The link is a row in passport_share_tokens (migration 122), read by the
// existing public /verify/<token> page, with the same expiry, scope, revoke and view count the estate's
// share route uses (src/app/api/passport/share/route.ts). What is added is ONE companion row in
// individual_professional_share (migration 373): its presence is the person's consent that the link
// carries their own records, so a link minted anywhere else can never show them.
//
// ⚠ STAGE 7: A PASSPORT VIEW IS A DRAFT FIRST (COMPETEN-PROFESSIONAL-PASSPORT-01, migration 540). A link minted with a
// view is created with consent false (which /verify already refuses), its purpose and the person's own records chosen
// one by one. The owner previews exactly what the recipient will see, then activates it. Record-level selection is the
// ONLY way a link carries the person's CPD, evidence or Scholar items: a link with no view carries none of them.
//
// ⚠ hospital_id IS ALWAYS NULL HERE. The estate route stamps the person's hospital. A Professional link is
// the person's own act, not an organisation's, and stamping a hospital would make it countable by one.

export const SHARE_DAYS_MAX = 365;
/** The lifetime the form suggests, kept within the policy maximum (COMPETEN-CONFIG-002). */
export const SHARE_DAYS_SUGGESTED = 30;
export const suggestedShareDays = (maxDays: number) => Math.min(SHARE_DAYS_SUGGESTED, maxDays);

export type ShareLink = {
  id: string; token: string; scope: string; label: string | null; expires_at: string | null;
  revoked: boolean; view_count: number; created_at: string;
};

/** Stage 7 (540): what a link is for, and the person's own records chosen for it, one by one. */
export type PassportRecordRef = { kind: "cpd" | "evidence" | "study" | "scholar_evaluation"; id: string };
export type PassportViewInput = {
  purposeCode: string | null; purposeLabel: string | null; recipientLabel: string | null; summary: string | null;
  includeInstitution: boolean; records: readonly PassportRecordRef[];
};
const RECORD_COLUMN: Record<PassportRecordRef["kind"], string> = { cpd: "cpd_id", evidence: "evidence_id", study: "study_item_id", scholar_evaluation: "scholar_evaluation_id" };

/**
 * Pure: the request body, clamped the way the estate route clamps it. `maxDays` is the Individual policy
 * maximum (src/lib/individual/policy.ts), itself never above SHARE_DAYS_MAX, applied again here.
 */
export function parseShare(b: Record<string, unknown>, maxDays: number = SHARE_DAYS_MAX): { scope: "summary" | "full"; label: string | null; days: number } {
  const scope = b.scope === "full" ? "full" : "summary";
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 120) : null;
  const n = Number(b.days);
  const max = Math.min(SHARE_DAYS_MAX, Math.max(1, Math.floor(maxDays)));
  const days = Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : suggestedShareDays(max);
  return { scope, label, days };
}

/**
 * COMPETEN-PROFESSIONAL-PROFILE-01 part B (migration 453): `profile` is what of the professional profile the
 * person chose for THIS link -- the overview and/or record versions. Nothing by default. With nothing chosen
 * the companion row is written exactly as before 453, so a link still works where 453 is not applied.
 */
export async function mintShare(admin: any, userId: string, input: ReturnType<typeof parseShare>,
  profile: { overview: boolean; itemIds: readonly string[] } = { overview: false, itemIds: [] },
  /** LCPD-01 LCPD-6 (migration 491): the completed learning records the person ticked for this link, already checked. */
  learningRecordIds: readonly string[] = [],
  /** COMPETENCY-01 S11 (migration 520): the competencies, and which parts of each, the person ticked for this link, already checked. */
  competencies: readonly { myCompetencyId: string; parts: readonly ("self_assessment" | "evidence" | "assessed_outcomes")[] }[] = [],
  /** PASSPORT-01 (540): a purpose-specific view. The link is then a DRAFT (consent false) until activateShare. */
  view: PassportViewInput | null = null,
  /** PROF-EVALUATION-01 s13 (migration 530): the recorded evaluations the person ticked for this link, already checked. */
  evaluationIds: readonly string[] = []): Promise<ShareLink | null> {
  const token = randomBytes(24).toString("hex");
  const { data: share, error } = await admin.from("passport_share_tokens").insert({
    token, nurse_id: userId, hospital_id: null, scope: input.scope, label: input.label,
    expires_at: new Date(Date.now() + input.days * 86400000).toISOString(), consent: !view, revoked: false,
  }).select("id, token, scope, label, expires_at, revoked, view_count, created_at").single();
  if (error || !share) return null;
  const { error: linkErr } = await admin.from("individual_professional_share").insert({
    share_token_id: share.id, user_id: userId, experience_code: ORIGIN, ...(profile.overview ? { profile_overview: true } : {}),
  });
  const { error: itemErr } = !linkErr && profile.itemIds.length
    ? await admin.from("individual_professional_share_item").insert(profile.itemIds.map(item_id => ({ share_token_id: share.id, user_id: userId, item_id })))
    : { error: null };
  const { error: learnErr } = !linkErr && !itemErr && learningRecordIds.length
    ? await admin.from("individual_professional_share_learning").insert(learningRecordIds.map(learning_record_id => ({ share_token_id: share.id, user_id: userId, learning_record_id })))
    : { error: null };
  const { error: compErr } = !linkErr && !itemErr && !learnErr && competencies.length
    ? await admin.from("individual_professional_share_competency").insert(competencies.map(c => ({
        share_token_id: share.id, user_id: userId, my_competency_id: c.myCompetencyId,
        include_self_assessment: c.parts.includes("self_assessment"), include_evidence: c.parts.includes("evidence"), include_assessed_outcomes: c.parts.includes("assessed_outcomes"),
      })))
    : { error: null };
  const { error: viewErr } = !linkErr && !itemErr && !learnErr && !compErr && view
    ? await admin.from("individual_passport_share_view").insert({
        share_token_id: share.id, user_id: userId, purpose_code: view.purposeCode, purpose_label: view.purposeLabel,
        recipient_label: view.recipientLabel, summary: view.summary, include_institution: view.includeInstitution,
      })
    : { error: null };
  const { error: recErr } = !linkErr && !itemErr && !learnErr && !compErr && !viewErr && view && view.records.length
    ? await admin.from("individual_passport_share_record").insert(view.records.map(r => ({ share_token_id: share.id, user_id: userId, [RECORD_COLUMN[r.kind]]: r.id })))
    : { error: null };
  // Stage 6's writer reads the policy, which reads this module's limits: it is loaded only when a link carries
  // evaluations, so the two modules never initialise in a cycle.
  const evalOk = linkErr || itemErr || learnErr || compErr || viewErr || recErr ? false
    : !evaluationIds.length || await (await import("./share-evaluation")).saveShareEvaluations(admin, userId, share.id, evaluationIds);
  if (linkErr || itemErr || learnErr || compErr || viewErr || recErr || !evalOk) {
    // Without the companion row the link would show the institution sections only, which is not what the
    // person asked to share. Withdraw it rather than hand out a different link than the one requested.
    await admin.from("passport_share_tokens").update({ revoked: true }).eq("id", share.id).eq("nurse_id", userId);
    return null;
  }
  return { ...share, view_count: share.view_count ?? 0 };
}

/** The person's Professional links, newest first. Estate-minted links are not listed: they are not these. */
export async function listShares(admin: any, userId: string): Promise<ShareLink[] | null> {
  try {
    const { data: rows, error } = await admin.from("individual_professional_share").select("share_token_id").eq("user_id", userId).limit(200);
    if (error) return null;
    const ids = (rows ?? []).map((r: any) => r.share_token_id);
    if (!ids.length) return [];
    const { data, error: tErr } = await admin.from("passport_share_tokens")
      .select("id, token, scope, label, expires_at, revoked, view_count, created_at")
      .in("id", ids).eq("nurse_id", userId).order("created_at", { ascending: false });
    return tErr ? null : (data ?? []).map((s: any) => ({ ...s, view_count: s.view_count ?? 0 }));
  } catch { return null; }
}

/** Revoke one of the person's own Professional links. False when it is not theirs or not a Professional link. */
export async function revokeShare(admin: any, userId: string, id: string): Promise<boolean> {
  const { data: link } = await admin.from("individual_professional_share").select("share_token_id").eq("share_token_id", id).eq("user_id", userId).maybeSingle();
  if (!link) return false;
  const { data } = await admin.from("passport_share_tokens").update({ revoked: true }).eq("id", id).eq("nurse_id", userId).select("id").maybeSingle();
  return !!data;
}

/** Activate a draft view: from now the link opens. Once only: 540 fixes an active view. False when not the person's draft. */
export async function activateShare(admin: any, userId: string, id: string): Promise<boolean> {
  const { data: v } = await admin.from("individual_passport_share_view").update({ activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("share_token_id", id).eq("user_id", userId).is("activated_at", null).select("share_token_id").maybeSingle();
  if (!v) return false;
  const { data } = await admin.from("passport_share_tokens").update({ consent: true }).eq("id", id).eq("nurse_id", userId).eq("revoked", false).select("id").maybeSingle();
  return !!data;
}

/** For /verify: record that a link was opened and what the page answered. Nothing about the recipient. Never throws. */
export async function logShareAccess(admin: any, tokenId: string, userId: string, result: "shown" | "refused_revoked" | "refused_expired" | "refused_draft"): Promise<void> {
  try { await admin.from("individual_passport_share_access").insert({ share_token_id: tokenId, user_id: userId, result }); } catch { /* history is best effort */ }
}

export type ShareHistory = { purpose: string | null; recipient: string | null; draft: boolean; opened: number; refused: number; lastOpened: string | null };

/** The person's own sharing history per link: purpose, draft or live, and how often it was opened or refused. */
export async function loadShareHistory(admin: any, userId: string, ids: readonly string[]): Promise<Map<string, ShareHistory>> {
  const out = new Map<string, ShareHistory>();
  if (!ids.length) return out;
  try {
    const [{ data: views }, { data: access }] = await Promise.all([
      admin.from("individual_passport_share_view").select("share_token_id, purpose_label, recipient_label, activated_at").eq("user_id", userId).in("share_token_id", ids),
      admin.from("individual_passport_share_access").select("share_token_id, result, viewed_at").eq("user_id", userId).in("share_token_id", ids).order("viewed_at", { ascending: false }).limit(5000),
    ]);
    for (const id of ids) {
      const v = (views ?? []).find((x: any) => x.share_token_id === id);
      const a = (access ?? []).filter((x: any) => x.share_token_id === id);
      if (!v && !a.length) continue;
      out.set(id, { purpose: v?.purpose_label ?? null, recipient: v?.recipient_label ?? null, draft: !!v && !v.activated_at,
        opened: a.filter((x: any) => x.result === "shown").length, refused: a.filter((x: any) => x.result !== "shown").length,
        lastOpened: a.find((x: any) => x.result === "shown")?.viewed_at ?? null });
    }
  } catch { /* history is best effort */ }
  return out;
}

/** For /verify: whether a token carries the person's own records. Unreadable answers false -- show less. */
export async function shareCarriesOwnRecords(admin: any, tokenId: string, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("individual_professional_share").select("share_token_id")
      .eq("share_token_id", tokenId).eq("user_id", userId).maybeSingle();
    return !error && !!data;
  } catch { return false; }
}
