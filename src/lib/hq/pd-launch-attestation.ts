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
