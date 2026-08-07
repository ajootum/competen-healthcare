import { NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { patientAccessReadiness } from "@/lib/practice/patient-access";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// GET /api/v1/practice/patient-access -- CPR-V5-007 s8, Phase 4.
//
// ⚠ READ ONLY, AND THAT IS THE WHOLE DESIGN. s8.1 lists a handle, an access mode, branding and a publish
// state; every one of those is a WRITE, and the store that would hold them is not in this build. "No
// action without a store behind it" is not a style rule here -- a POST that accepted a handle and
// discarded it would let a practitioner believe they had published a booking page.
//
// So this endpoint answers exactly one question: can a patient reach this practice, and if not, what
// would have to be true? The answer is currently no, and the first reason is that no code can be
// delivered to anybody.
//
// ⚠ THE CAPABILITY IS THE ONE s14 GIVES TO PUBLISHING, NOT TO BOOKING. s14: "Publish booking page --
// account owner: yes; authorised staff: EXPLICIT PERMISSION ONLY". That is practice.settings.manage,
// the same capability that governs everything else deciding what this practice exposes to the outside.
// A front-desk delegate who may book patients in may not decide whether strangers can.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;
  const { ctx, caller } = auth;

  const readiness = await patientAccessReadiness(caller.admin, ctx);

  // 200 WITH `open: false`, NOT AN ERROR. The door being shut is the answer, not a failure to produce
  // one -- and `incomplete` says whether any figure below is a number nobody could read rather than a
  // count of nought.
  return NextResponse.json({ readiness, correlationId: caller.traceId });
}
