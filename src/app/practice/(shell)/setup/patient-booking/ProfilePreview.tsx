import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { publicBookingProfile, profileAvailability } from "@/lib/practice/public-profile";
import ProfileView from "@/app/practice/book/[handle]/ProfileView";
import { AvailabilityRegion } from "@/app/practice/book/[handle]/AvailabilityBlock";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 s13 -- THE PUBLIC PROFILE PREVIEW, so the public page is GOVERNED rather than
// "accidentally assembled from incomplete data".
//
// ⚠ IT MOUNTS THE PUBLIC PAGE'S OWN COMPONENT, READING THE PUBLIC PAGE'S OWN PROJECTION.
//
// s13 requires "the same rendering/data contract as the public page to prevent configuration/preview
// drift", and the only way to mean it is to import the thing itself. A preview that re-implemented the
// layout would agree on the day it was written and disagree on every day after -- and it would disagree
// SILENTLY, which is the failure that matters: the practitioner would be signing off a page nobody had
// actually looked at.
//
// The readiness list beside it is NOT a second engine. Every row reads the projection that was just
// rendered, so a tick means "this is on the page above" and never "a column somewhere is not null".
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

type Check = {
  label: string;
  state: "present" | "absent" | "optional_absent";
  detail: string;
  fix?: { label: string; href: string };
};

function CheckRow({ c }: { c: Check }) {
  const mark = c.state === "present" ? "✓" : c.state === "absent" ? "○" : "–";
  const tone = c.state === "present" ? "text-emerald-600"
    : c.state === "absent" ? "text-amber-600" : "text-gray-400";
  return (
    <li className="flex items-start gap-2 py-1.5">
      {/* Status carries a word as well as a mark -- s16: never colour alone. */}
      <span aria-hidden className={`mt-[1px] font-bold ${tone}`}>{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="text-[12px] font-semibold text-gray-900">{c.label}</span>
        <span className="block text-[11px] leading-relaxed text-gray-600">{c.detail}</span>
        {c.fix && (
          <Link href={c.fix.href} className="mt-0.5 inline-block text-[11px] font-semibold text-[var(--cp-primary)] hover:underline">
            {c.fix.label} →
          </Link>
        )}
      </span>
    </li>
  );
}

export default async function ProfilePreview({ handle }: { handle: string | null }) {
  if (!handle) {
    return (
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">Your public profile</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          You have not claimed a booking address yet, so there is no public page to preview. The address
          is what a patient opens; everything else on this screen decides what they find there.
        </p>
        <Link href="/practice/setup/identity"
          className="mt-2 inline-block text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
          Claim your booking address →
        </Link>
      </section>
    );
  }

  const admin = createAdminClient();
  const resolved = await publicBookingProfile(admin, handle);

  if (resolved.kind !== "found") {
    // ⚠ THE THREE NON-FOUND OUTCOMES ARE NOT ONE. A read that failed is not a page that does not
    // resolve, and telling a practitioner their address is dead because a query timed out is the
    // sharing defect this codebase has already paid for once.
    const why = resolved.kind === "unreadable"
      ? `Your public page could not be read just now, so nothing below is a statement about it: ${resolved.reason}`
      : resolved.kind === "redirect"
        ? "This address now redirects to your current one. Open the preview from your current address."
        : "Your address does not open a public page at the moment. That is what a patient following your link would find.";
    return (
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">Your public profile</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{why}</p>
      </section>
    );
  }

  const p = resolved.profile;
  // The practitioner is shown the REAL scan result rather than a suspended region: the question this
  // screen answers is "what will a patient find", and "we are still looking" is not an answer to it.
  const availability = await profileAvailability(admin, {
    handle: p.handle, types: p.consultationTypes.map(t => t.code),
  });

  const checks: Check[] = [
    {
      label: "Name and credential",
      state: p.credentials ? "present" : "absent",
      detail: p.credentials
        ? `Patients see "${p.displayName}, ${p.credentials}".`
        : `Patients see "${p.displayName}" with no credential after it.`,
      fix: p.credentials ? undefined : { label: "Add your credential", href: "/practice/setup/identity" },
    },
    {
      label: "Specialty",
      state: p.specialty ? "present" : "absent",
      detail: p.specialty ? p.specialty : "Nothing tells a patient what you treat.",
      fix: p.specialty ? undefined : { label: "Add your specialty", href: "/practice/setup/identity" },
    },
    {
      label: "Where you see patients",
      state: p.locations.length > 0 ? "present" : "absent",
      detail: p.locations.length > 0
        ? p.locations.map(l => l.name).join(", ")
        : "Your page shows no location, so a patient cannot tell where they would be seen.",
      fix: p.locations.length > 0 ? undefined
        : { label: "Choose the locations your page shows", href: "/practice/setup/patient-booking?tab=page" },
    },
    {
      label: "Consultations offered",
      state: p.consultationTypes.length > 0 ? "present" : "absent",
      detail: p.consultationTypes.length > 0
        ? p.consultationTypes.map(t => t.label).join(", ")
        : "No consultation type is offered, so there is nothing for a patient to choose.",
      fix: p.consultationTypes.length > 0 ? undefined
        : { label: "Choose what patients may book", href: "/practice/setup/patient-booking?tab=page" },
    },
    {
      label: "Online booking",
      state: p.booking.canBook ? "present" : "absent",
      detail: p.booking.canBook
        ? "A patient can complete a booking from this page."
        : p.booking.whyNot ?? "Patients cannot book from this page yet.",
      fix: p.booking.canBook ? undefined
        : { label: "See what is blocking", href: "/practice/setup/patient-booking?tab=publish" },
    },
    {
      label: "Times to offer",
      state: availability.state === "found" ? "present" : "absent",
      detail: availability.state === "found"
        ? `Next available: ${availability.label}.`
        : availability.state === "none_in_window"
          ? "Your page is open and has no bookable times, so it tells patients so rather than opening an empty diary."
          : "Whether you have times open could not be checked just now. Nothing has been assumed either way.",
      fix: availability.state === "none_in_window"
        ? { label: "Open times for patients", href: "/practice/setup/patient-booking?tab=clinics" }
        : undefined,
    },
    {
      // ⚠ OPTIONAL, AND MARKED AS OPTIONAL. s17: About collapses when absent -- a missing biography is
      // not a defect, and a page that nags about one teaches practitioners to ignore the list.
      label: "About you (optional)",
      state: p.bio ? "present" : "optional_absent",
      detail: p.bio ? "Your biography appears on the page." : "No biography. The section is simply absent.",
      fix: p.bio ? undefined : { label: "Write a short introduction", href: "/practice/setup/identity" },
    },
    {
      label: "Languages (optional)",
      state: p.languages ? "present" : "optional_absent",
      detail: p.languages ? p.languages : "No languages listed. The section is simply absent.",
    },
    {
      // ⚠ THE ONE CHECK THAT IS NOT THE PRACTITIONER'S TO FIX, AND SAYS SO PLAINLY. Leaving it off the
      // list entirely would be worse: a practitioner who has seen a verified badge on other products
      // would go looking for the setting.
      label: "Verified practitioner badge",
      state: "optional_absent",
      detail: "No verified badge is shown on any profile in this product. Competen records who checked "
        + "a licence and when, but nothing here contacts a professional council -- and a badge tells a "
        + "patient that a regulator was checked. Nothing on your side is missing.",
    },
    {
      // s4/s17: optional, and marked optional. A profile with initials is finished, not deficient.
      label: "Photograph (optional)",
      state: p.photoUrl ? "present" : "optional_absent",
      detail: p.photoUrl
        ? "Your photograph appears on your booking page."
        : "No photograph. Patients see your initials, which is a finished look rather than a gap.",
      fix: p.photoUrl ? undefined : { label: "Add a photograph", href: "/practice/setup/identity" },
    },
  ];

  const missing = checks.filter(c => c.state === "absent").length;

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold text-gray-900">What patients see</h2>
          <a href={`/practice/book/@${p.handle}`} target="_blank" rel="noopener noreferrer"
            className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
            Open your public page ↗
          </a>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
          {/* ⚠ NO PERCENTAGE. s13: "not an arbitrary vanity percentage unless the percentage has a
              canonical definition" -- and there is no canonical definition of a complete profile, so a
              count of what is actually missing is the honest measure. */}
          {missing === 0
            ? "Everything a patient needs to decide is on your page."
            : `${missing} thing${missing === 1 ? "" : "s"} a patient would look for ${missing === 1 ? "is" : "are"} missing.`}
        </p>
        <ul className="mt-2 divide-y divide-gray-100">
          {checks.map(c => <CheckRow key={c.label} c={c} />)}
        </ul>
      </section>

      {/* ── THE PHOTOGRAPH ────────────────────────────────────────────────────────────────────────
          Shown to the PRACTITIONER, beside what patients currently get, because "what will this look
          like" is their question and not a patient's. The patient page itself never draws a labelled
          empty frame: an avatar with initials is a finished treatment, and a dashed box marked
          "no photo" reads as a page that failed to load. */}
      <section className={card}>
        <h2 className="text-[13px] font-bold text-gray-900">Photograph</h2>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {p.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photoUrl} alt={p.displayName} width={64} height={64}
              className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-gray-200" />
          ) : (
            <span aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--cp-primary)] text-[22px] font-bold text-white">
              {p.initials}
            </span>
          )}
          <p className="min-w-[200px] flex-1 text-[11.5px] leading-relaxed text-gray-600">
            {p.photoUrl
              ? "This is what patients see. Location and camera details are removed from a photograph before it is published."
              : "Patients see your initials. You can add a photograph if you would like one — it is optional, and a profile without one is complete."}
          </p>
          <Link href="/practice/setup/identity"
            className="text-[11.5px] font-semibold text-[var(--cp-primary)] hover:underline">
            {p.photoUrl ? "Change or remove it" : "Add a photograph"} →
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold text-gray-900">Preview</h2>
        <p className="mt-0.5 text-[11.5px] text-gray-600">
          This is the page itself, rendered by the same code your patients load.
        </p>
        {/* The public page paints its own canvas, so the preview frames it rather than restyling it. */}
        <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-[var(--cp-canvas)]">
          <ProfileView
            p={p}
            // ⚠ THE PUBLIC PAGE'S OWN REGION COMPONENT, not a preview-shaped copy of its three
            // sentences. The booking link is null here: this is a preview, and a practitioner clicking
            // "Book this time" inside their own dashboard would be starting a patient booking.
            availabilitySlot={<AvailabilityRegion a={availability} bookingPath={null} />}
          />
        </div>
      </section>
    </div>
  );
}
