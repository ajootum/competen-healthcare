/* eslint-disable @typescript-eslint/no-explicit-any */
import { dbRefusal } from "./governance";
import { expireStaleOffers } from "@/lib/question-offers/offers";
import { libraryKeyText, libraryFormatOf, LIBRARY_FORMAT_LABEL } from "@/lib/individual/scholar/library-format";

// ── LEARNER OFFERS, THE HQ INTAKE ── SQIE-LIBRARY-EXPANSION-01 (owner GO 31 Oct 2026, item F), migration 802 ───────────────
//
// What an educator sees of a question a learner offered, and the two things they may do with it: take it (a CKRI DRAFT of
// origin learner_contribution, then the normal educator review, independent clinical approval and publication) or decline
// it with a reason (its content is purged). Mirrors the case candidate queue (423).
//
// ⚠ THE LEARNER IS NEVER NAMED. HQ reads ONLY question_contribution_queue, which has no user and no source reference, as
// case_candidate_queue has none. Nothing here reads a Scholar table (ckri-harness K1-7).
// ⚠ NOTHING AUTO-APPROVES. Taking an offer makes a draft that has not been educator-reviewed, and the database refuses its
// submission until an educator reviews its exact content (442) and its publication until it is clinically approved by an
// independent reviewer (395, 640). An offer that was AI-written in Scholar says so.

type R<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z][a-z0-9_-]{2,60}$/;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(String(e?.message ?? ""));

export type LearnerOffer = {
  id: string; status: "offered" | "taken" | "promoted"; format: string; formatLabel: string; stem: string; keyText: string;
  rationale: string; sourceQuote: string | null; aiWritten: boolean; attestation: string; offeredAt: string; takenVersionId: string | null; takenResourceId: string | null;
  snapshot: Record<string, unknown>;
};

/** The queue: offers waiting, and those taken (newest first). null when it cannot be read, [] where 802 is absent. */
export async function listLearnerOffers(admin: any, opts: { expireDays?: unknown } = {}): Promise<LearnerOffer[] | null> {
  // SQIE-LIBRARY-GAPS-01: a bounded sweep (200 rows) first: an offer that waited past the policy days is withdrawn and purged.
  if (opts.expireDays !== undefined) await expireStaleOffers(admin, { days: opts.expireDays });
  const { data, error } = await admin.from("question_contribution_queue")
    .select("id, status, snapshot, format, ai_written, attestation, offered_at, taken_resource_id, taken_version_id")
    .order("offered_at", { ascending: false }).limit(200);
  if (error) return missing(error) ? [] : null;
  return ((data ?? []) as any[]).map(r => {
    const snap = (r.snapshot ?? {}) as Record<string, unknown>;
    const format = libraryFormatOf(snap) ?? "mcq";
    return {
      id: r.id, status: r.status, format, formatLabel: LIBRARY_FORMAT_LABEL[format], stem: String(snap.stem ?? ""), keyText: libraryKeyText(snap),
      rationale: String(snap.rationale ?? ""), sourceQuote: typeof snap.sourceQuote === "string" ? snap.sourceQuote : null,
      aiWritten: r.ai_written === true, attestation: String(r.attestation ?? ""), offeredAt: r.offered_at,
      takenVersionId: r.taken_version_id ?? null, takenResourceId: r.taken_resource_id ?? null, snapshot: snap,
    };
  });
}

/** Pure. The code a taken offer's resource gets when the educator gives none: learner-offer- and the offer's first 8 hex. */
export const offerCode = (offerId: string) => `learner-offer-${offerId.replace(/-/g, "").slice(0, 8).toLowerCase()}`;

/** Take an offer into the library as a DRAFT. The database checks the capability, the status and everything else. */
export async function takeLearnerOffer(admin: any, me: string, offerId: string, opts: { code?: string; title?: string }): Promise<R<{ versionId: string }>> {
  if (!UUID.test(offerId)) return { ok: false, error: "Unknown offer." };
  const code = (opts.code ?? "").trim() || offerCode(offerId);
  if (!CODE.test(code)) return { ok: false, error: "A resource code is lowercase letters, digits, hyphens and underscores." };
  const title = (opts.title ?? "").trim();
  if (title.length < 2 || title.length > 200) return { ok: false, error: "Give the library question a title (its topic, 2 to 200 characters)." };
  const { data, error } = await admin.rpc("question_contribution_take", { p_offer: offerId, p_educator: me, p_code: code, p_title: title });
  if (error) return { ok: false, error: missing(error) ? "Learner offers are not available here yet (migration 802 is not applied)." : /duplicate key|unique/i.test(String(error.message ?? "")) ? "That resource code is already used." : dbRefusal({ message: String(error.message ?? "").replace(/^question_contribution_take: /, "ckri_offer: ") }, "The offer could not be taken.") };
  return { ok: true, versionId: String(data) };
}

/** Decline an offer, with the reason. Its content is purged by the database. */
export async function declineLearnerOffer(admin: any, me: string, offerId: string, reason: string): Promise<R> {
  if (!UUID.test(offerId)) return { ok: false, error: "Unknown offer." };
  const why = (reason ?? "").trim();
  if (why.length < 2 || why.length > 500) return { ok: false, error: "Give the reason (2 to 500 characters)." };
  const { error } = await admin.rpc("question_contribution_decline", { p_offer: offerId, p_educator: me, p_reason: why });
  return error ? { ok: false, error: missing(error) ? "Learner offers are not available here yet (migration 802 is not applied)." : dbRefusal({ message: String(error.message ?? "").replace(/^question_contribution_decline: /, "ckri_offer: ") }, "The offer could not be declined.") } : { ok: true };
}
