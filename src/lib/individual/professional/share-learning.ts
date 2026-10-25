/* eslint-disable @typescript-eslint/no-explicit-any */
import { learningEnabled } from "@/lib/learning/policy";
import { loadLearningRecords, type LearningReference } from "@/lib/learning/products";
import type { LcpdConfig } from "../lcpd-config";
import { isUuid } from "./validate";
import { learningProvenance } from "./learning";

// ── COMPLETED LEARNING A PERSON CHOOSES TO SHOW ON ONE PASSPORT LINK ── LCPD-01 LCPD-6, migration 491 ──────────────────
//
// Selective, never automatic: nothing is shared unless the person ticks it for that link. Eligible means a COMPLETED
// learning record of the person, of an evidence kind the configuration allows (lcpd-config passportShareable), read by
// reference through Competen Learning's own reader. Checked when the link is made AND again when it is shown, so a record
// that stops being eligible (a policy change, Learning switched off) is no longer shown on an old link.
//
// ⚠ NEVER REFLECTIONS, NEVER PLANS. Only learning records travel. Private reflections (470/491) and development plans
// have no path into this module or 491's share table.

/** Pure: the learning records ticked on the share form (fields named learning:<record id>). */
export function parseShareLearning(b: Record<string, unknown>): string[] {
  const ticked = (v: unknown) => v === true || v === "true" || v === "on" || v === "1";
  return [...new Set(Object.keys(b).filter(k => k.startsWith("learning:") && ticked(b[k])).map(k => k.slice(9)).filter(isUuid))].slice(0, 200);
}

/** Pure: which completed learning may be shared under the configuration. */
export const eligibleLearning = (refs: readonly LearningReference[], cfg: Pick<LcpdConfig, "passportShareable">) =>
  refs.filter(r => (cfg.passportShareable as readonly string[]).includes(r.evidenceClass));

/** Before minting: every chosen record is the person's own, completed and eligible. null = fine. */
export async function checkShareLearning(admin: any, userId: string, ids: readonly string[], cfg: LcpdConfig): Promise<string | null> {
  if (!ids.length) return null;
  if (!(await learningEnabled(admin))) return "Learning cannot be shared at the moment.";
  const refs = await loadLearningRecords(admin, userId);
  if (refs === null) return "Your learning could not be checked just now. Try again shortly.";
  const ok = new Set(eligibleLearning(refs, cfg).map(r => r.recordId));
  return ids.every(id => ok.has(id)) ? null : "Only your completed learning of a kind that can be shared may be added to a link.";
}

export type SharedLearningItem = { recordId: string; title: string; provenance: string; completedOn: string; versionNo: number; provider: string | null; certificateNos: string[] };

/**
 * For /verify: the learning a link carries, re-checked now. null = could not be read (the page says so), [] = none.
 * Certificate NUMBERS only, never verification codes.
 */
export async function loadSharedLearning(admin: any, tokenId: string, userId: string, cfg: LcpdConfig): Promise<SharedLearningItem[] | null> {
  try {
    const { data, error } = await admin.from("individual_professional_share_learning").select("learning_record_id").eq("share_token_id", tokenId).eq("user_id", userId).limit(200);
    if (error) return /does not exist|schema cache|could not find/i.test(error.message ?? "") ? [] : null;
    if (!data?.length || !(await learningEnabled(admin))) return [];
    const refs = await loadLearningRecords(admin, userId);
    if (refs === null) return null;
    const chosen = new Set(data.map((r: any) => r.learning_record_id));
    return eligibleLearning(refs, cfg).filter(r => chosen.has(r.recordId)).map(r => ({
      recordId: r.recordId, title: r.title, provenance: learningProvenance(r), completedOn: r.completedOn, versionNo: r.versionNo, provider: r.provider,
      certificateNos: r.certificates.filter(c => !c.revoked).map(c => c.no),
    }));
  } catch { return null; }
}
