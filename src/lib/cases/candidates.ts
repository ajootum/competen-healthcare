/* eslint-disable @typescript-eslint/no-explicit-any */
import { validateBlueprint } from "./blueprint";
import { CASE_LIBRARY_OFF, caseLibraryEnabled, loadCasePolicy } from "./policy";
import { CASE_SCREEN_VERSION, screenBlueprint, type ScreenKind } from "./screen";

// ── C1: CANDIDATE CAPTURE, THE PLATFORM SIDE ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s7, IND-004 C-a to C-e, mig. 423 ──
//
// The student-side capture points are Scholar's (IND-004). Scholar calls these, server-side, from an explicit student
// action. Holdings never reads Scholar's tables (C-a): Scholar builds the snapshot with its own privateCaseSnapshot.
//
// ⚠ A SEPARATE, REVOCABLE PERMISSION (owner Stage 5 approval). Granting candidacy offers nothing. Each case is offered
// one at a time (C-c). Revoking, deleting the source, or erasure withdraws every case not yet taken into the library,
// and the database purges its content (423).
//
// ⚠ A DETERMINISTIC GATE. The snapshot must be a valid private blueprint, Scholar's verbatim-overlap check must have
// passed (C-b), and the identifier screen (screen.ts) must find nothing. Any failure makes the offer INELIGIBLE: the
// database keeps only the reasons, never the content. No AI runs here, so offering never consumes anybody's
// allowance or any budget.
//
// ⚠ THE STUDENT IS NEVER NAMED TO AN EDUCATOR (C-e). user_id is kept for revocation and erasure only. HQ reads
// candidates through case_candidate_queue, which has neither the user nor the source reference.

export type Attestation = "own_notes" | "licensed_to_share";
export type OfferReason = ScreenKind | "verbatim_overlap" | "verbatim_unchecked";
export type OfferResult =
  | { ok: true; candidateId: string; status: "eligible" | "ineligible"; reasons: OfferReason[]; duplicate: boolean }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Scholar's opaque reference to the source of a case (never Scholar's raw id is required, only a stable key). */
export const SOURCE_KEY = /^[a-z][a-z0-9:_-]{7,199}$/i;
const missing = (e: any) => /does not exist|schema cache|could not find/i.test(e?.message ?? "");

/** The student's candidacy, as the database holds it. null = could not be read. */
export async function candidacyStatus(admin: any, userId: string)
  : Promise<{ granted: boolean; attestation: Attestation | null; attestationVersion: string | null; current: boolean } | null> {
  if (!UUID.test(userId)) return null;
  const [{ data, error }, policy] = await Promise.all([
    admin.from("case_candidacy").select("status, attestation, attestation_version").eq("user_id", userId).maybeSingle(),
    loadCasePolicy(admin),
  ]);
  if (error) return missing(error) ? { granted: false, attestation: null, attestationVersion: null, current: false } : null;
  const granted = data?.status === "granted";
  return { granted, attestation: granted ? data.attestation : null, attestationVersion: granted ? data.attestation_version : null,
    current: granted && data.attestation_version === policy.attestationVersion };
}

/** Grant (or re-grant) candidacy, on the attestation text the student read: the CURRENT version only. */
export async function grantCaseCandidacy(admin: any, args: { userId: string; attestation: Attestation; attestationVersion: string })
  : Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID.test(args.userId)) return { ok: false, error: "No such person." };
  if (args.attestation !== "own_notes" && args.attestation !== "licensed_to_share") return { ok: false, error: "Say what the material is." };
  if (!(await caseLibraryEnabled(admin))) return { ok: false, error: CASE_LIBRARY_OFF };
  const policy = await loadCasePolicy(admin);
  if (args.attestationVersion !== policy.attestationVersion) return { ok: false, error: "The permission text has changed. Read the current version first." };
  const { error } = await admin.rpc("case_candidacy_grant", { p_user: args.userId, p_attestation: args.attestation, p_version: args.attestationVersion });
  return error ? { ok: false, error: missing(error) ? "Case contribution is not available on this environment yet." : "The permission could not be recorded just now." } : { ok: true };
}

/** Revoke candidacy. Returns how many unpromoted candidates the database withdrew and purged. */
export async function revokeCaseCandidacy(admin: any, args: { userId: string }): Promise<{ ok: true; withdrawn: number } | { ok: false; error: string }> {
  if (!UUID.test(args.userId)) return { ok: false, error: "No such person." };
  const { data, error } = await admin.rpc("case_candidacy_revoke", { p_user: args.userId, p_reason: "student" });
  return error ? { ok: false, error: "The permission could not be withdrawn just now." } : { ok: true, withdrawn: Number(data ?? 0) };
}

/** Pure: the eligibility of one offered snapshot. Valid private blueprint, verbatim check passed, nothing screened. */
export function judgeOffer(snapshot: unknown, verbatim: { passed: boolean; version: string } | null | undefined)
  : { valid: false; problems: string[] } | { valid: true; reasons: OfferReason[] } {
  const problems = validateBlueprint(snapshot, "private");
  if (problems.length) return { valid: false, problems };
  const reasons: OfferReason[] = [...screenBlueprint(snapshot)];
  if (!verbatim || typeof verbatim.version !== "string" || !verbatim.version) reasons.push("verbatim_unchecked");
  else if (verbatim.passed !== true) reasons.push("verbatim_overlap");
  return { valid: true, reasons };
}

/**
 * Offer ONE private case (C-c: an explicit, per-case student action). Eligible or ineligible, recorded either way, so
 * the student sees why. Offering the same snapshot of the same source again returns the existing candidate.
 */
export async function offerPrivateCase(admin: any, args: { userId: string; sourceKey: string; snapshot: unknown; verbatim: { passed: boolean; version: string } | null })
  : Promise<OfferResult> {
  if (!UUID.test(args.userId)) return { ok: false, error: "No such person." };
  if (!SOURCE_KEY.test(args.sourceKey ?? "")) return { ok: false, error: "The case's source reference is not valid." };
  if (!(await caseLibraryEnabled(admin))) return { ok: false, error: CASE_LIBRARY_OFF };
  const status = await candidacyStatus(admin, args.userId);
  if (status === null) return { ok: false, error: "Your permission could not be read just now, so nothing was offered." };
  if (!status.granted) return { ok: false, error: "Allow your cases to be considered for the shared library first." };
  const j = judgeOffer(args.snapshot, args.verbatim);
  if (!j.valid) return { ok: false, error: "This case is not complete enough to offer." };
  const eligible = j.reasons.length === 0;
  const row = eligible
    ? { user_id: args.userId, source_key: args.sourceKey, status: "eligible", snapshot: args.snapshot, reasons: [], screen_version: CASE_SCREEN_VERSION }
    : { user_id: args.userId, source_key: args.sourceKey, status: "ineligible", snapshot: null, reasons: j.reasons, screen_version: CASE_SCREEN_VERSION };
  const { data, error } = await admin.from("case_candidate").insert(row).select("id, status, reasons").single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message ?? "")) {
      const { data: prior } = await admin.from("case_candidate").select("id, status, reasons").eq("user_id", args.userId).eq("source_key", args.sourceKey)
        .in("status", ["eligible", "in_development", "promoted"]).order("offered_at", { ascending: false }).limit(1);
      if (prior?.[0]) return { ok: true, candidateId: prior[0].id, status: "eligible", reasons: [], duplicate: true };
    }
    // The database backstop refusing what this screen passed is a defect here, never a reason to store it.
    if (/identifiable content/i.test(error.message ?? "")) return { ok: false, error: "This case still contains patient details, so it cannot be offered." };
    if (/no candidacy permission/i.test(error.message ?? "")) return { ok: false, error: "Allow your cases to be considered for the shared library first." };
    return { ok: false, error: missing(error) ? "Case contribution is not available on this environment yet." : "The case could not be offered just now." };
  }
  return { ok: true, candidateId: data.id, status: data.status, reasons: data.reasons ?? [], duplicate: false };
}

/** Withdraw everything one source produced: the student withdrew the offer, or deleted the source (C-e). */
export async function withdrawCaseCandidate(admin: any, args: { userId: string; sourceKey: string; reason: "student" | "source_deleted" })
  : Promise<{ ok: true; withdrawn: number } | { ok: false; error: string }> {
  if (!UUID.test(args.userId) || !SOURCE_KEY.test(args.sourceKey ?? "")) return { ok: false, error: "Nothing to withdraw." };
  const { data, error } = await admin.rpc("case_candidate_withdraw", { p_user: args.userId, p_source_key: args.sourceKey, p_reason: args.reason });
  return error ? { ok: false, error: "The case could not be withdrawn just now." } : { ok: true, withdrawn: Number(data ?? 0) };
}

/** What a student sees of their own offers: status and reasons, never another person's. */
export async function myCaseOffers(admin: any, userId: string): Promise<{ id: string; sourceKey: string; status: string; reasons: string[]; offeredAt: string }[] | null> {
  if (!UUID.test(userId)) return null;
  const { data, error } = await admin.from("case_candidate").select("id, source_key, status, reasons, offered_at").eq("user_id", userId).order("offered_at", { ascending: false }).limit(200);
  if (error) return missing(error) ? [] : null;
  return (data ?? []).map((r: any) => ({ id: r.id, sourceKey: r.source_key, status: r.status, reasons: r.reasons ?? [], offeredAt: r.offered_at }));
}

/** Retention (policy candidateRetentionDays): withdraw and purge what nobody took into development. */
export async function expireCandidates(admin: any, now = new Date()): Promise<{ ok: true; withdrawn: number } | { ok: false; error: string }> {
  const policy = await loadCasePolicy(admin);
  const before = new Date(now.getTime() - policy.candidateRetentionDays * 86_400_000).toISOString();
  const { data, error } = await admin.rpc("case_candidate_expire", { p_before: before });
  return error ? { ok: false, error: "Retention could not run just now." } : { ok: true, withdrawn: Number(data ?? 0) };
}
