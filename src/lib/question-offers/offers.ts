/* eslint-disable @typescript-eslint/no-explicit-any */
import { screenText } from "@/lib/cases/screen";
import { libraryContentOfLearnerQuestion, LIBRARY_FORMAT_LABEL, libraryFormatOf } from "@/lib/individual/scholar/library-format";

// ── A LEARNER OFFERS ONE OF THEIR OWN QUESTIONS TO THE GOVERNED LIBRARY ── SQIE-LIBRARY-EXPANSION-01, migration 802 ─────────
//
// Owner GO 31 Oct 2026 (Scholar Release Decisions, item F): learner question contributions, subject to an explicit SEPARATE
// permission, source rights and privacy safeguards, de-identification, independent editorial and clinical review, governed
// publication, and no automatic approval of learner- or AI-generated content. It mirrors case candidacy (src/lib/cases/
// candidates.ts, migration 423) and lives OUTSIDE Scholar's paths for the same reason: Scholar code only calls it, from an
// explicit learner action, and never names its tables (scholar-learning-harness S1/S1c).
//
// ⚠ A SEPARATE, REVOCABLE PERMISSION, on a versioned attestation text (ATTESTATION below). It is never implied by AI consent,
// by case candidacy or by anything else: nothing here reads either. Granting it offers nothing.
// ⚠ ONE QUESTION AT A TIME. The snapshot is the question in the library shape (library-format.ts) -- stem, options, key,
// rubric, format -- and nothing else of the learner's: no notes, no material, no section. The passage the question quotes
// from their notes goes with it ONLY when the learner confirms their rights to it, per offer.
// ⚠ A DETERMINISTIC GATE, BLOCKING. Before anything is stored: the identifier screen (cases/screen.ts screenText, stricter
// than the database) over every text, the quote included, and a verbatim-overlap check of the question's own text against
// the learner's notes. Any finding refuses the offer and nothing is kept. The database refuses an offer without a granted
// permission, with an identifier (423 backstop) or that is not a library question shape (800).
// ⚠ NO AI, NO CHARGE. Nothing here calls a model or writes the AI ledger: offering never uses the learner's allowance.
// ⚠ THE LEARNER IS NEVER NAMED to an educator. HQ reads question_contribution_queue (no user, no source reference).

export const QUESTION_OFFER_ATTESTATION_VERSION = "question-attest/1";
export const QUESTION_OFFER_ATTESTATION: Record<string, { own_notes: string; licensed_to_share: string; terms: string }> = {
  "question-attest/1": {
    own_notes: "The notes my questions were written from are my own notes, written by me.",
    licensed_to_share: "The notes my questions were written from are material I am licensed to share for this purpose.",
    terms: "I agree that Competen may consider practice questions I choose to offer, one at a time, for its governed question library. "
      + "An offered question is screened for patient details and for text copied from my notes, and is never shown to educators with my name. "
      + "It is taken in only as a draft: educators may change it, it must be reviewed by an educator and approved by an independent clinical reviewer, "
      + "and only an approved version is ever published. Nothing is approved automatically. I can withdraw an offer, or this permission, at any time, "
      + "and any question not yet taken in is then removed. Offering never uses my AI allowance.",
  },
};
export const QUESTION_SCREEN_VERSION = "question-screen/1";
export const QUESTION_OFFERING_OFF = "Offering questions to the Competen library is switched off here. You can still withdraw a permission or an offer you made.";
export const QUESTION_OFFERING_UNAVAILABLE = "Offering questions to the Competen library is not available here yet.";

export type Attestation = "own_notes" | "licensed_to_share";
export type OfferBlock = "not_a_library_question" | "identifier" | "verbatim_overlap" | "quote_without_rights" | "quote_too_long";
export const OFFER_BLOCK_LABEL: Record<OfferBlock, string> = {
  not_a_library_question: "it is not complete enough to be a library question",
  identifier: "it contains something that could identify a patient or a person",
  verbatim_overlap: "its wording copies your notes (twelve words or more in a row)",
  quote_without_rights: "the quoted passage from your notes needs your confirmation that you have the right to share it",
  quote_too_long: "the quoted passage is longer than 1000 characters",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OFFER_SOURCE_KEY = /^scholar:question:[0-9a-f-]{36}$/;
/** The opaque key an offer names its source by: never a table, only a stable key (as caseSourceKey). */
export const questionSourceKey = (questionId: string) => `scholar:question:${questionId.toLowerCase()}`;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(String(e?.message ?? ""));

/** Pure. Whether new permissions and offers are allowed: the Individual policy scholar_question_offering (default off). */
export const questionOfferingOn = (policy: { scholarQuestionOffering?: "on" | "off" }): boolean => policy.scholarQuestionOffering === "on";

const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) strings(x, out);
  return out;
};
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** Pure. Whether any n words in a row of the texts appear in the sources (n = 12, as the case verbatim check). */
export function verbatimOverlap(texts: readonly string[], sources: readonly string[], n = 12): boolean {
  const grams = new Set<string>();
  for (const s of sources) { const w = words(s); for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" ")); }
  if (!grams.size) return false;
  for (const t of texts) { const w = words(t); for (let i = 0; i + n <= w.length; i++) if (grams.has(w.slice(i, i + n).join(" "))) return true; }
  return false;
}

export type OfferInput = {
  question: { kind: string; stem: string; options: readonly string[]; correctIndex: number | null; answer: unknown; rationale: string; sourceQuote: string };
  /** The learner's own notes the question came from: what the verbatim-overlap check reads. Never stored. */
  sources: readonly string[];
  /** The learner confirmed, for THIS offer, their rights to the passage the question quotes from their notes. */
  includeQuote: boolean; rightsConfirmed: boolean;
};

/**
 * Pure. The snapshot of one question to offer, or every reason it cannot be offered. The question becomes library content
 * (libraryContentOfLearnerQuestion), every text is screened, the question's own text is checked against the notes, and the
 * quote rides along only with the learner's confirmation.
 */
export function judgeQuestionOffer(input: OfferInput): { ok: true; snapshot: Record<string, unknown> } | { ok: false; blocks: OfferBlock[] } {
  const c = libraryContentOfLearnerQuestion(input.question);
  if (!c.ok) return { ok: false, blocks: ["not_a_library_question"] };
  const blocks: OfferBlock[] = [];
  const quote = input.includeQuote ? (input.question.sourceQuote ?? "").trim() : "";
  if (input.includeQuote && quote && !input.rightsConfirmed) blocks.push("quote_without_rights");
  if (quote.length > 1000) blocks.push("quote_too_long");
  const content = c.content as Record<string, unknown>;
  const texts = strings({ ...content, format: undefined, marking: undefined });
  if ([...texts, quote].some(t => t && screenText(t).length)) blocks.push("identifier");
  if (verbatimOverlap(texts, input.sources)) blocks.push("verbatim_overlap");
  if (blocks.length) return { ok: false, blocks };
  return { ok: true, snapshot: { ...content, ...(quote ? { sourceQuote: quote } : {}) } };
}

export type PermissionStatus = { available: boolean; granted: boolean; attestation: Attestation | null; attestationVersion: string | null; current: boolean };

/** The learner's permission as the database holds it. null = could not be read. Unavailable where 802 is absent. */
export async function questionOfferingStatus(admin: any, userId: string): Promise<PermissionStatus | null> {
  if (!UUID.test(userId)) return null;
  const { data, error } = await admin.from("question_contribution_permission").select("status, attestation, attestation_version").eq("user_id", userId).maybeSingle();
  if (error) return missing(error) ? { available: false, granted: false, attestation: null, attestationVersion: null, current: false } : null;
  const granted = data?.status === "granted";
  return { available: true, granted, attestation: granted ? data.attestation : null, attestationVersion: granted ? data.attestation_version : null,
    current: granted && data.attestation_version === QUESTION_OFFER_ATTESTATION_VERSION };
}

/** Grant (or re-grant) the permission, on the CURRENT attestation text the learner read. */
export async function grantQuestionOffering(admin: any, args: { userId: string; attestation: unknown; attestationVersion: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID.test(args.userId)) return { ok: false, error: "No such person." };
  if (args.attestation !== "own_notes" && args.attestation !== "licensed_to_share") return { ok: false, error: "Say what your notes are." };
  if (args.attestationVersion !== QUESTION_OFFER_ATTESTATION_VERSION) return { ok: false, error: "The permission text has changed. Read the current version first." };
  const { error } = await admin.rpc("question_contribution_grant", { p_user: args.userId, p_attestation: args.attestation, p_version: QUESTION_OFFER_ATTESTATION_VERSION });
  return error ? { ok: false, error: missing(error) ? QUESTION_OFFERING_UNAVAILABLE : "The permission could not be recorded just now." } : { ok: true };
}

/** Revoke the permission. Returns how many offers not yet taken in the database withdrew and purged. Never gated. */
export async function revokeQuestionOffering(admin: any, args: { userId: string }): Promise<{ ok: true; withdrawn: number } | { ok: false; error: string }> {
  if (!UUID.test(args.userId)) return { ok: false, error: "No such person." };
  const { data, error } = await admin.rpc("question_contribution_revoke", { p_user: args.userId, p_reason: "learner" });
  return error ? { ok: false, error: missing(error) ? QUESTION_OFFERING_UNAVAILABLE : "The permission could not be withdrawn just now." } : { ok: true, withdrawn: Number(data ?? 0) };
}

export type OfferResult = { ok: true; offerId: string; duplicate: boolean } | { ok: false; error: string; blocks?: OfferBlock[] };

/** Offer ONE question (an explicit learner action). Screened first; refused and nothing kept on any finding. */
export async function offerQuestion(admin: any, args: { userId: string; questionId: string; input: OfferInput; aiWritten: boolean }): Promise<OfferResult> {
  if (!UUID.test(args.userId) || !UUID.test(args.questionId)) return { ok: false, error: "That question could not be found." };
  const status = await questionOfferingStatus(admin, args.userId);
  if (status === null) return { ok: false, error: "Your permission could not be read just now, so nothing was offered." };
  if (!status.available) return { ok: false, error: QUESTION_OFFERING_UNAVAILABLE };
  if (!status.granted || !status.current) return { ok: false, error: "Allow your questions to be considered for the Competen library first." };
  const j = judgeQuestionOffer(args.input);
  if (!j.ok) return { ok: false, error: `This question cannot be offered: ${j.blocks.map(b => OFFER_BLOCK_LABEL[b]).join("; ")}. Nothing of it was kept.`, blocks: j.blocks };
  const sourceKey = questionSourceKey(args.questionId);
  const { data, error } = await admin.from("question_contribution_offer").insert({
    user_id: args.userId, source_key: sourceKey, status: "offered", snapshot: j.snapshot, screen_version: QUESTION_SCREEN_VERSION, ai_written: args.aiWritten,
  }).select("id").single();
  if (error) {
    if (/duplicate key|unique/i.test(String(error.message ?? ""))) {
      const { data: prior } = await admin.from("question_contribution_offer").select("id").eq("user_id", args.userId).eq("source_key", sourceKey).in("status", ["offered", "taken", "promoted"]).limit(1);
      if (prior?.[0]) return { ok: true, offerId: prior[0].id, duplicate: true };
    }
    // The database backstop refusing what this screen passed is a defect here, never a reason to store it.
    if (/identifiable content/i.test(String(error.message ?? ""))) return { ok: false, error: "This question still contains something that could identify a person, so it cannot be offered.", blocks: ["identifier"] };
    if (/no offering permission/i.test(String(error.message ?? ""))) return { ok: false, error: "Allow your questions to be considered for the Competen library first." };
    return { ok: false, error: missing(error) ? QUESTION_OFFERING_UNAVAILABLE : "The question could not be offered just now." };
  }
  return { ok: true, offerId: data.id, duplicate: false };
}

/** Withdraw one offer of the learner's (not yet taken in). Never gated. */
export async function withdrawQuestionOffer(admin: any, args: { userId: string; offerId: string }): Promise<{ ok: true; withdrawn: number } | { ok: false; error: string }> {
  if (!UUID.test(args.userId) || !UUID.test(args.offerId)) return { ok: false, error: "Nothing to withdraw." };
  const { data, error } = await admin.rpc("question_contribution_withdraw", { p_user: args.userId, p_offer: args.offerId });
  return error ? { ok: false, error: missing(error) ? QUESTION_OFFERING_UNAVAILABLE : "The offer could not be withdrawn just now." } : { ok: true, withdrawn: Number(data ?? 0) };
}

export type MyOffer = { id: string; questionId: string | null; status: string; format: string; formatLabel: string; offeredAt: string };

/** What a learner sees of their own offers: status and format, never anything of anybody else's. [] where 802 is absent. */
export async function myQuestionOffers(admin: any, userId: string): Promise<MyOffer[] | null> {
  if (!UUID.test(userId)) return null;
  const { data, error } = await admin.from("question_contribution_offer").select("id, source_key, status, format, offered_at").eq("user_id", userId).order("offered_at", { ascending: false }).limit(200);
  if (error) return missing(error) ? [] : null;
  return ((data ?? []) as any[]).map(r => {
    const f = libraryFormatOf({ format: r.format }) ?? "mcq";
    return { id: r.id, questionId: OFFER_SOURCE_KEY.test(r.source_key) ? r.source_key.slice("scholar:question:".length) : null, status: r.status, format: f, formatLabel: LIBRARY_FORMAT_LABEL[f], offeredAt: r.offered_at };
  });
}

/** Erasure of all the learner's material: every offer not yet taken in is withdrawn (its content purged). Never gated. */
export async function withdrawAllQuestionOffers(admin: any, userId: string): Promise<{ withdrawn: number; failed: number }> {
  const mine = await myQuestionOffers(admin, userId);
  let withdrawn = 0, failed = 0;
  for (const o of (mine ?? []).filter(x => x.status === "offered" || x.status === "declined")) {
    const r = await withdrawQuestionOffer(admin, { userId, offerId: o.id });
    if (r.ok) withdrawn += r.withdrawn; else failed++;
  }
  return { withdrawn, failed: mine === null ? 1 : failed };
}
