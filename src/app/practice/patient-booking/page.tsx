import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { platformFlag } from "@/lib/practice/provisioning";
import { patientBookingSurface } from "@/lib/practice/patient-access";
import { PATIENT_BOOKING_FLAG } from "@/lib/practice/patient-access-constants";

// /practice/patient-booking -- CPR-V5-007 s8, Phase 4's patient-facing surface.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ DELIBERATELY OUTSIDE THE (shell) GROUP, AND THIS IS THE SECURITY BOUNDARY, NOT A ROUTING DETAIL.
//
// The shell resolves a practitioner identity: membership, entitlement, capabilities, a device register
// and -- where the practice asks for it -- aal2. A patient is none of those things. Routing a patient
// page through resolvePracticeShell would not merely bounce them; it would mean the only session this
// page understood was a PRACTITIONER'S, and the first patient session ever issued would have arrived
// wearing a practitioner's capability list.
//
// So: this file imports nothing from shell.ts, access.ts or api-context.ts, reads no workspace cookie,
// and has no capability check because it has no capabilities to check. The harness asserts that absence
// rather than trusting this comment.
//
// ⚠ AND IT NAMES NO PRACTICE. This URL is reachable by strangers. A page that said "Dr So-and-so is not
// taking bookings" would confirm to anybody who guessed at it that Dr So-and-so is on this platform.
//
// ---- WHY THE PAGE SAYS NO -------------------------------------------------------------------------
//
// Phase 4 asks for a handle, a link-only page, an OTP, registration intake and confirmation. The OTP
// machinery exists and was hardened by this phase. Everything else needs a store this build does not
// have -- and none of it would matter anyway, because a one-time code has to be SENT, and this
// deployment has no SMS gateway and no mail provider. A code that cannot be sent is not a code.
//
// The alternative was to write the code to the screen or return it in the response. That is not a
// half-built OTP, it is a public bypass of one, and it is the exact shortcut that ships to production.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Booking with your practice — Competen Practice",
  // NOT INDEXED. There is nothing here worth finding and the URL should not accumulate inbound links
  // before it does something.
  robots: { index: false, follow: false },
};

export default async function Page() {
  const admin = createAdminClient();

  // ⚠ THE FLAG IS CHECKED FIRST AND SEPARATELY, AND IT 404s RATHER THAN EXPLAINING ITSELF. A gate that
  // says "this feature is switched off for this deployment" to an anonymous visitor is a gate that tells
  // strangers what is coming. Off by default: the flag has no row, and platformFlag returns false for a
  // flag it cannot find as well as for one it cannot read.
  if (!(await platformFlag(admin, PATIENT_BOOKING_FLAG))) notFound();

  const surface = await patientBookingSurface(admin);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-16">
      <div className="mx-auto w-full max-w-xl">
        <div className="rounded-2xl border border-gray-200 bg-white p-8">
          <h1 className="text-lg font-bold text-gray-900">{surface.headline}</h1>

          <p className="mt-3 text-sm leading-relaxed text-gray-600">{surface.whatToDoInstead}</p>

          <ul className="mt-6 space-y-4">
            {surface.reasons.map(r => (
              <li key={r.headline} className="border-l-2 border-gray-200 pl-4">
                <p className="text-[13.5px] font-semibold text-gray-900">{r.headline}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{r.detail}</p>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-[11px] leading-relaxed text-gray-500">
            Competen Practice will never text or email you a code out of the blue, and it has no way to
            today. If you receive a message claiming to be a booking code from us, it did not come from
            here.
          </p>

          <p className="mt-4 text-[13px]">
            <Link href="/practice" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
              About Competen Practice
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
