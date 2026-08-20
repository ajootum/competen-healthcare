/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Launch attestations — CPR-PD-014 §6.4 and §8.2.
 *
 * !! THE LEDGER MAY NOT EXIST YET, AND THAT IS A FIRST-CLASS STATE. §13 forbids inferring missing
 * substrate, so every field below is nullable and `unavailable` is reported with its reason rather than
 * collapsing into "nothing is attested". Those are different facts: one means nobody has signed, the
 * other means we cannot tell.
 */

export type AttestationRow = {
  controlId: string;
  releaseRef: string;
  verdict: "ATTESTED" | "REJECTED" | "SUPERSEDED";
  attestedBy: string;
  attestedByCapability: string;
  attestedAt: string;
  evidenceRef: string | null;
  note: string | null;
  expiresAt: string | null;
  expired: boolean;
};

export type LaunchAttestations = {
  /**
   * The release these attestations describe.
   *
   * !! NOT INVENTED. There is no single release identifier in this estate yet, so rather than
   * manufacture one from a git sha or an environment name, this reads the most recent release_ref an
   * attestor actually named. Null means nobody has attested anything against any build — which the
   * screen states, instead of showing an empty table under a made-up version.
   */
  releaseRef: string | null;
  rows: AttestationRow[];
  unavailable: boolean;
  unavailableReason: string | null;
};

export async function loadLaunchAttestations(admin: any): Promise<LaunchAttestations> {
  const absent = (reason: string): LaunchAttestations =>
    ({ releaseRef: null, rows: [], unavailable: true, unavailableReason: reason });

  // Newest first, one row, purely to discover which release is under test.
  const { data: latest, error: latestErr } = await admin
    .from("pd_launch_attestation")
    .select("release_ref, attested_at")
    .order("attested_at", { ascending: false })
    .limit(1);

  if (latestErr) {
    return absent(/does not exist|schema cache/i.test(latestErr.message)
      ? "the attestation ledger is not present on this database"
      : `the attestation ledger could not be read: ${latestErr.message.slice(0, 80)}`);
  }

  const releaseRef = ((latest ?? []) as any[])[0]?.release_ref ?? null;
  if (!releaseRef) {
    // The table exists and holds nothing. A measured empty set, not an unreadable one.
    return { releaseRef: null, rows: [], unavailable: false, unavailableReason: null };
  }

  const { data, error } = await admin.rpc("plat_pd_launch_attestation_current", { p_release_ref: releaseRef });
  if (error) return absent(`the current-verdict view could not be read: ${error.message.slice(0, 80)}`);

  const rows: AttestationRow[] = ((data ?? []) as any[]).map(r => ({
    controlId: r.control_id,
    releaseRef: r.release_ref,
    verdict: r.verdict,
    attestedBy: r.attested_by,
    attestedByCapability: r.attested_by_capability,
    attestedAt: r.attested_at,
    evidenceRef: r.evidence_ref ?? null,
    note: r.note ?? null,
    expiresAt: r.expires_at ?? null,
    expired: r.expired === true,
  }));

  return { releaseRef, rows, unavailable: false, unavailableReason: null };
}

/**
 * The status a control shows, given the ledger.
 *
 * !! AN EXPIRED ATTESTATION IS NOT AN ATTESTED ONE. §8.2 allows an expiry rule, and a tick that has
 * outlived it would be the most misleading thing on the page — it says a person checked, when what is
 * true is that a person checked something that no longer counts.
 */
export type AttestationStatus = "AWAITING" | "ATTESTED" | "REJECTED" | "SUPERSEDED" | "EXPIRED";

export function statusFor(controlId: string, a: LaunchAttestations): AttestationStatus {
  const row = a.rows.find(r => r.controlId === controlId);
  if (!row) return "AWAITING";
  if (row.expired) return "EXPIRED";
  return row.verdict;
}

/** §6.2: human controls attested / required. Only ATTESTED and unexpired counts toward the gate. */
export function attestedCount(controlIds: string[], a: LaunchAttestations): number {
  return controlIds.filter(id => statusFor(id, a) === "ATTESTED").length;
}

// ══ THE WRITE PATH ═══════════════════════════════════════════════════════════════════════════════════

/**
 * The capability created by migration 344. Named once so the route and the engine cannot disagree.
 *
 * !! WHY IT IS ITS OWN CODE. Reusing `hq.practice.flags.manage` would let the person who flips the
 * launch flags also attest that the controls are met -- the doer certifying their own doing, which is
 * the one thing an attestation exists to prevent. Reusing `hq.practice.change.approve` would hand the
 * Product Director the CHECKER half of PD-012 s21's maker-checker.
 *
 * !! CORRECTION TO MIGRATION 344's HEADER, 2026-08-20. That file says `change.approve` is "deliberately
 * held by nobody" and "remains unheld". BOTH SENTENCES ARE WRONG: it is held by `platform_director` and
 * `chief_executive` on staging and production alike. The claim came from a query that only ever asked
 * whether the PRODUCT DIRECTOR held it, generalised without re-checking.
 *
 * The migration is applied and deliberately NOT edited -- editing an applied migration makes the file a
 * description of something that never ran -- so the correction lives here, where the next person to
 * touch this capability will read it.
 *
 * !! AND THE DESIGN IS BETTER THAN THE WRONG VERSION SAID. Maker-checker is real AND staffed: there are
 * checkers, and the Product Director is deliberately not one. The reason for a separate attest code is
 * unchanged -- attesting states what was observed, approving decides what happens next.
 */
export const CAP_LAUNCH_ATTEST = "hq.practice.launch.attest";

/** The manual controls a person may attest. Anything else is refused rather than recorded. */
export const ATTESTABLE_CONTROLS = ["cold-signin", "acceptance", "cutover"] as const;
export const ATTESTATION_VERDICTS = ["ATTESTED", "REJECTED", "SUPERSEDED"] as const;

export type AttestResult =
  | { ok: true; id: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Record one attestation against one launch control.
 *
 * !! THE LEDGER IS APPEND-ONLY AND THIS DOES NOT FIGHT THAT. Migration 340's trigger refuses UPDATE and
 * DELETE, so changing your mind means APPENDING a new row. That is why there is no update path here and
 * why `supersedesId` exists: the chain is explicit rather than inferred, and migration 343's `seq`
 * decides which row is current when two land in the same transaction and share a now().
 *
 * !! IT RECORDS THE CAPABILITY AS HELD AT THE TIME, which is migration 340's own reasoning: a grant can
 * be revoked later and an audit asks what was true when the attestation was made. The caller passes the
 * capability it actually gated on rather than this function assuming one.
 *
 * !! IT DOES NOT DECIDE ANYTHING ABOUT LAUNCH. An attestation states what was observed. It does not flip
 * a flag, does not approve a transition and does not open the product -- see migration 344's header for
 * why that separation is the reason this capability could be granted to the Product Director at all.
 */
export async function recordLaunchAttestation(admin: any, args: {
  controlId: string;
  releaseRef: string;
  verdict: string;
  attestedBy: string;
  attestedByCapability: string;
  evidenceRef?: string | null;
  note?: string | null;
  expiresAt?: string | null;
  supersedesId?: string | null;
}): Promise<AttestResult> {
  const fail = (status: number, code: string, message: string): AttestResult =>
    ({ ok: false, status, code, message });

  // Validated against the same sets the schema CHECKs, so a bad value is refused with a sentence rather
  // than surfacing as a constraint violation naming a column.
  if (!(ATTESTABLE_CONTROLS as readonly string[]).includes(args.controlId))
    return fail(422, "UNKNOWN_CONTROL", `${args.controlId} is not a control a person attests. Attestable: ${ATTESTABLE_CONTROLS.join(", ")}`);
  if (!(ATTESTATION_VERDICTS as readonly string[]).includes(args.verdict))
    return fail(422, "INVALID_VERDICT", `verdict must be one of ${ATTESTATION_VERDICTS.join(", ")}`);
  const releaseRef = args.releaseRef.trim();
  // !! REQUIRED, NOT DEFAULTED. Migration 340 keeps release_ref free text because this estate has no
  // single release identifier, and defaulting it here would attach every attestation to a build nobody
  // named -- which is precisely the "what was actually tested" question section 6.4 exists to answer.
  if (!releaseRef)
    return fail(422, "RELEASE_REF_REQUIRED", "name what was tested: a build, a tag, a commit or an environment. An attestation against nothing cannot be audited");
  if (releaseRef.length > 200) return fail(422, "RELEASE_REF_TOO_LONG", "that release reference is longer than 200 characters");

  const { data, error } = await admin.from("pd_launch_attestation").insert({
    control_id: args.controlId,
    release_ref: releaseRef,
    verdict: args.verdict,
    attested_by: args.attestedBy,
    attested_by_capability: args.attestedByCapability,
    evidence_ref: args.evidenceRef?.trim() || null,
    note: args.note?.trim() || null,
    expires_at: args.expiresAt || null,
    supersedes_id: args.supersedesId || null,
  }).select("id").maybeSingle();

  if (error) {
    return /does not exist|schema cache/i.test(error.message)
      ? fail(503, "LEDGER_ABSENT", "the attestation ledger is not present on this database")
      : fail(422, "REFUSED_BY_DATABASE", error.message);
  }
  if (!data) return fail(500, "NO_ROW", "the ledger accepted the write and returned no row");
  return { ok: true, id: (data as any).id as string };
}
