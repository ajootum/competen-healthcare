import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { identitySetupView, resolveDisplayName } from "@/lib/practice/identity-service";
import BookingAddressConsole from "./BookingAddressConsole";
import PhotoConsole from "./PhotoConsole";
import { photoUrl } from "@/lib/practice/practitioner-photo";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// PIS-000 s3, s8, s15 -- PRACTICE SETUP: YOUR BOOKING ADDRESS.
//
// ⚠ THE SCREEN THAT MAKES A PUBLIC NAME A CHOICE RATHER THAN A SIDE EFFECT.
//
// Provisioning issues the identity ROW -- a permanent practitioner number, a private profile, discovery
// hidden -- and stops there. The handle is the part that ends up in a URL a patient is given, printed on
// a card and encoded in a QR code, and it is close to permanent because retiring one does not free it.
// So it is claimed here, deliberately, by the person whose name it is, with the finished URL on screen
// before the button is pressed.
//
// ⚠ IT IS NOT A PRIMARY SIDEBAR ITEM AND MUST NOT BECOME ONE. PRIMARY_ORDER is nine flat items pinned
// by sixteen assertions in practice-current-activity-harness, and the orphan scan reads the TOP-LEVEL
// directories of (shell) -- so a child of /practice/setup needs no allowlist entry and changes no count.
// /practice/setup/lifecycle and /practice/setup/clinical-parameters are the precedent.
//
// ⚠ THIS SENTENCE USED TO READ "it is not a sidebar item and must not become one", AND IT WAS WRONG IN A
// WAY THAT COST SOMETHING. The reasoning under it was entirely about PRIMARY_ORDER, but the sentence
// banned every kind of entry -- so this page shipped working and unreachable, and the practice owner
// walked the product and reported that they could not see identity anywhere. It is now a CHILD of
// Practice Setup in PRACTICE_NAV ("Identity & Address"), which leaves the frozen nine untouched. The
// correction is recorded rather than tidied away, because the failure was a true clause guarding a
// false one.
//
// ⚠ THE CAPABILITY IS practice.settings.manage, which is what the API enforces too. A page that rendered
// for somebody the API would refuse is a page full of buttons that 403.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export default async function PracticeBookingAddressPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "practice.settings.manage")) redirect("/practice/setup");

  const admin = createAdminClient();
  const identity = await identitySetupView(admin, {
    userId: shell.ctx.userId,
    workspaceId: shell.ctx.workspaceId,
    fallbackDisplayName: await resolveDisplayName(admin, shell.ctx.userId, shell.ctx.workspaceId),
  });

  return (
    <div className="-m-5 min-h-full bg-[var(--cp-canvas)] p-5">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4">

        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--cp-primary)]/12 text-[20px] text-[var(--cp-primary-deep)]">
            @
          </span>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="text-[11px] font-semibold text-[var(--cp-primary-deep)]">
              <Link href="/practice/setup" className="hover:underline">← Practice Setup</Link>
              <span className="mx-1 text-gray-400">/</span>
              <span className="text-gray-500">Practice Foundation</span>
              <span className="mx-1 text-gray-400">/</span>
              <span className="text-gray-500">Your booking address</span>
            </nav>
            <h1 className="text-2xl font-bold text-gray-900">Your booking address</h1>
            <p className="text-[13px] leading-relaxed text-gray-500">
              Your practitioner number is issued to you and never changes. Your handle &mdash; the
              <span className="font-semibold"> @name</span> patients would see in a link &mdash; is yours to
              choose, and nothing chooses it for you.
            </p>
          </div>
        </div>

        <BookingAddressConsole identity={identity} />

        {/* CPR-BOOK-PROFILE-001 s4: the photograph sits with the rest of the public identity, because
            that is the question it answers -- what a patient sees when they open the address above.
            It is only offered once an identity exists: there is nothing to attach a photograph to
            before that, and an upload control over no identity is a button that cannot work. */}
        {identity.state !== "none" && (
          <PhotoConsole
            photoUrl={photoUrl(identity.publicProfile.photoPath)}
            displayName={identity.displayName ?? "You"}
            mayManage={hasCapability(shell.ctx, "practice.settings.manage")}
          />
        )}
      </div>
    </div>
  );
}
