// ── THE SWITCH FOR OFFERING A STUDENT'S OWN CASES ── SCHOLAR-INTELLIGENCE-COMPLETE-01 ───────────────────────────────
//
// Offering a student's own cases to the shared library used to share the single platform flag `case_library` with PLAYING
// library cases. The Individual policy `scholar_case_contribution` (on | off) now gates the OFFER side alone:
//   - absent (never published) = "on" = FOLLOWS case_library, exactly as before: on where the library is on, off where it is off;
//   - "off" = no new permission and no new offer, while library cases stay playable;
//   - it can never open what case_library keeps shut (both must hold), and
//   - withdrawing a permission or an offer is NEVER gated (a privacy right does not wait on a switch).
// Pure. It lives with the case library (not in Scholar) so Scholar code only ever asks "is offering on?".

export const OFFERING_OFF = "Offering cases to the case library is switched off here. You can still withdraw a permission or an offer you made.";

export const offeringOn = (libraryOn: boolean, policy: { scholarCaseContribution?: "on" | "off" }): boolean =>
  libraryOn === true && policy.scholarCaseContribution !== "off";
