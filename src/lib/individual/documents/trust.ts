import type { Trust, Validity } from "../documents-config";

// ── THE MEANING OF A RECORD, FROM ITS OWNER ── COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.7 ──────────────────────────────
//
// The ONE mapping from an owner's evidence class (passport.ts EvidenceClass, Professional's own classes, Competen Learning)
// to the Studio's meaning. Kept here, beside the Passport's own vocabulary, so no Professional file has to name an
// organisation's verified class (individual-professional-harness E6). An unknown class is the weakest meaning, never a
// stronger one.

export function trustOfClass(evidenceClass: string | null | undefined): Trust {
  switch (evidenceClass) {
    // Aligned with the Stage 7 Passport (passport-view.ts): an organisation that VERIFIED a credential is an independent
    // decision; one that only issued it is the organisation's record, worded as such.
    case "institution_verified": return "independent";
    case "institution_issued": return "institution";
    case "source_linked": return "document_supported";
    case "platform_recorded": return "platform_recorded";
    case "self_directed":
    case "educational_evaluation": return "formative";
    default: return "self_declared";
  }
}

/** Validity from dates the owner recorded: past its expiry is expired. A record with no expiry has none to state. */
export function validityOf(expiresOn: string | null | undefined, today: string, opts: { revoked?: boolean; superseded?: boolean } = {}): Validity {
  if (opts.revoked) return "revoked";
  if (opts.superseded) return "superseded";
  if (!expiresOn) return "not_applicable";
  return expiresOn.slice(0, 10) < today ? "expired" : "current";
}
