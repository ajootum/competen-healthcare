/* eslint-disable @typescript-eslint/no-explicit-any */

// ── THE COMPETEN INDIVIDUAL RELEASE GATE ── owner GO "IND-003 final integration and release-gate" ───────
//
// Competen Individual ships DARK. Every entry point -- the signed-in shell, the access page, the person-
// facing APIs, the HQ grant routes and the neutral sign-in resolver -- asks this one question first, on
// the server, and behaves as if Individual did not exist unless the answer is a definite yes:
//
//   practice_platform_flags.flag = 'individual_app' with enabled = true
//
// ⚠ WHY THIS STORE. It is the estate's existing launch-flag table (migration 191). It already carries
// the estate-level `estate_public_signup` alongside Practice's flags, and is read by platformFlag()
// with exactly this posture: an absent row is OFF, a failed read is OFF, and nothing throws. It exists in
// every environment TODAY, so the gate does NOT depend on migration 370 -- the Individual tables can be
// absent and the flag is still read cleanly.
//
// ⚠ IT IS NOT REGISTERED IN THE PRACTICE FLAGS CONSOLE (src/app/api/v1/practice/flags), on purpose: that
// console is the Practice Product Director's, and Individual is a separate product (COMP-ARCH-PSA-001).
// Turning Individual on is an owner act, recorded in the build record's release checklist.
//
// ⚠ A SMALL READ OF ITS OWN rather than platformFlag(): that function lives in the Practice provisioning
// module, and importing it would pull the Practice engine graph into the identity resolver and every
// Individual surface. The semantics are platformFlag's, line for line.

export const INDIVIDUAL_APP_FLAG = "individual_app";

/** True only when the flag row exists and is enabled. Every other outcome -- no client, no row, a failed
 *  read, a thrown error -- is false. Never throws. */
export async function individualAppEnabled(admin: any | null): Promise<boolean> {
  if (!admin) return false;
  try {
    const { data, error } = await admin.from("practice_platform_flags")
      .select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
    if (error) return false;
    return data?.enabled === true;
  } catch {
    return false;
  }
}
