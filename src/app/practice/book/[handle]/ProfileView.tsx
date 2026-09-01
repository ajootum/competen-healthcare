import Link from "next/link";
import type { PublicBookingProfile } from "@/lib/practice/public-profile";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 -- THE PUBLIC BOOKING PROFILE, RENDERED ONCE.
//
// s13: "Preview must use the same rendering/data contract as the public page to prevent
// configuration/preview drift." So this component is the whole page body, it takes the projection and
// nothing else, and BOTH the public route and the practitioner's preview mount it. A preview that
// renders its own approximation of a public page is a preview that lies on the day they diverge.
//
// It is a server component with no client JavaScript: s16 asks for fast first render, and there is
// nothing here a patient interacts with except links.
//
// ---- THE ORDER IS THE SPECIFICATION (s12) ----------------------------------------------------------
//
//   above fold      who this is, and the one button
//   decision        where, and what can be booked
//   secondary       about, languages
//   trust/footer    what happens with their details, and who runs this
//
// On a phone that order is the DOM order. On a desktop the booking module moves to the right rail
// (md:order-2) and keeps its place at the top of the reading order on the narrow screen, which is the
// only place "above the fold" is a real constraint.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const card = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const h2 = "text-[13px] font-bold text-gray-900";

/** s8's two answers. The patient word, never the location's kind. */
const MODE_LABEL: Record<string, string> = {
  in_person: "In-person",
  virtual: "Online consultation",
};

const AVATAR_BOX = "h-16 w-16 shrink-0 rounded-full md:h-20 md:w-20";

function Avatar({ initials, photoUrl, name }: {
  initials: string; photoUrl: string | null; name: string;
}) {
  // ⚠ NO <img> WITHOUT A SOURCE. s17: "do not show broken image" -- so the absent case is not an image
  // element with an empty src that a browser draws as a broken icon, it is a different element that
  // cannot break at all.
  if (!photoUrl) {
    return (
      <span aria-hidden
        className={`${AVATAR_BOX} flex items-center justify-center bg-[var(--cp-primary)] text-[22px] font-bold text-white md:text-[26px]`}>
        {initials}
      </span>
    );
  }

  // ⚠ THE ALT TEXT IS THE PERSON, NOT THE FILE (s16: "profile photo requires appropriate alt handling").
  // "Profile photo" tells a screen-reader user nothing they did not already know from the heading
  // beside it; the clinician's name is what the image actually depicts.
  //
  // ⚠ AND IT IS A PLAIN <img>, NOT next/image. The source is a Supabase storage host, so next/image
  // would need that host in remotePatterns and would proxy every patient's request through the
  // optimiser for an image already stored at one small size.
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img src={photoUrl} alt={name} width={80} height={80} loading="eager" decoding="async"
      className={`${AVATAR_BOX} object-cover ring-1 ring-gray-200`} />
  );
}

/**
 * s10's reassurance, and every line of it is true of the implemented workflow.
 *
 * ⚠ THERE IS NO "YOU WILL RECEIVE A CONFIRMATION EMAIL" LINE, and its absence is deliberate. Since
 * CPR-SET-COMMS-001 a practice may switch booking confirmations off per message type, and this
 * projection does not read that preference -- so the claim is one this page cannot currently stand
 * behind for every practice. The reference shown on screen is unconditional, so that is what is
 * promised. Making the email claimable means exposing the preference on the public entry.
 */
function WhatHappensNext({ codeRequired }: { codeRequired: boolean }) {
  const steps = [
    "Choose a location, consultation type and a time that suits you.",
    codeRequired
      ? "Confirm your email address with a one-time code, so nobody can book in your name."
      : "Give the practice the details it needs to arrange the appointment.",
    "Get your booking reference on screen. No account is needed at any point.",
  ];
  return (
    <ol className="mt-2 space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-gray-600">
          <span aria-hidden
            className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-600">
            {i + 1}
          </span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export default function ProfileView({ p, availabilitySlot }: {
  p: PublicBookingProfile;
  /**
   * The next-available region (s6). A SLOT rather than a value, because the scan behind it is slow
   * enough to matter and this component must not wait for it -- the public route passes a suspended
   * <AvailabilityBlock>, and the practitioner's preview passes the same component. s13's "same
   * rendering contract" is satisfied by both mounting THIS file; what differs is only when the region
   * resolves.
   */
  availabilitySlot?: React.ReactNode;
}) {
  const b = p.booking;

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 px-4 py-8 md:px-6">

      {/* ── IDENTITY (s4) ─────────────────────────────────────────────────────────────────────────
          The name is the h1 and the strongest thing on the page. The handle is a small line UNDER it
          (AC-01) rather than the eyebrow it used to be, and the CP number is not here at all (AC-02). */}
      <header className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center`}>
        <Avatar initials={p.initials} photoUrl={p.photoUrl} name={p.displayName} />
        <div className="min-w-0">
          {/* ⚠ NO VERIFIED BADGE, AND NOT BY OVERSIGHT. The comp shows one; this product's licence
              record is "a provenance record rather than a verification. Nothing here contacts a
              council" (identity-service NOT_BUILT), so s4's condition -- a state that JUSTIFIES the
              claim -- is unmet. See public-profile.ts. It is an owner decision with council
              integration behind it, never a component that can be switched on here. */}
          <h1 className="text-[20px] font-bold leading-tight text-gray-900 md:text-[24px]">
            {p.displayName}{p.credentials ? `, ${p.credentials}` : ""}
          </h1>
          {p.specialty && <p className="mt-0.5 text-[13px] font-semibold text-[var(--cp-primary-deep)]">{p.specialty}</p>}
          {/* Its own line rather than appended: a paediatric urologist is a paediatrician AND a
              urologist, and running the two together reads as one longer specialty name. */}
          {p.subSpecialty && <p className="text-[12.5px] text-gray-600">{p.subSpecialty}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-gray-500">
            {p.locations.length > 0 && <span>{p.locations.map(l => l.name).join(" · ")}</span>}
            {p.practiceName && p.locations.length > 0 && <span aria-hidden className="text-gray-300">|</span>}
            {p.practiceName && <span>{p.practiceName}</span>}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-400">@{p.handle}</p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">

        {/* ── BOOKING (s5, s6) — first on a phone, right rail on a desktop ───────────────────────── */}
        <div className="flex flex-col gap-4 md:order-2">
          <section className={card} aria-labelledby="book-heading">
            {/* ⚠ THE HEADING FOLLOWS THE OFFER, and it did not until a render test caught it: a card
                headed "Book an appointment" above a button that only sends a REQUEST tells a patient
                they have an appointment when they have asked for one. A request is not a booking, and
                the heading is as much a claim as the button. */}
            <h2 id="book-heading" className={h2}>
              {b.canBook ? "Book an appointment"
                : b.canRequestWithoutCode ? "Request an appointment"
                  : "Booking"}
            </h2>

            {b.canBook ? (
              <>
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                  Select a location, consultation type, date and available time.
                </p>

                {/* ⚠ THE PRIMARY CTA DOES NOT WAIT FOR THE DIARY, AND ITS LABEL DOES NOT DEPEND ON IT.
                    s5 fixes the label as "Book an appointment" (AC-03), so the one dominant action is
                    painted immediately and the next-available shortcut -- which carries its own "Book
                    this time" per s6 -- streams in underneath it. */}
                <Link href={b.bookingPath!}
                  className="mt-3 flex w-full items-center justify-center rounded-lg bg-[var(--cp-primary)] px-4 py-3 text-[13px] font-bold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cp-primary)]">
                  Book an appointment
                </Link>

                {availabilitySlot}

                {/* s17's soft state: the page is open, and no clinic offers public times. It is a fact
                    about configuration, so it renders with the page rather than with the scan. */}
                {p.availabilityNote && (
                  <p className="mt-3 text-[11px] leading-relaxed text-gray-600">{p.availabilityNote}</p>
                )}

                <div className="mt-4 border-t border-gray-100 pt-3">
                  <h3 className="text-[11px] font-bold text-gray-900">What happens next</h3>
                  <WhatHappensNext codeRequired />
                </div>
              </>
            ) : b.canRequestWithoutCode ? (
              <>
                {/* ⚠ A REQUEST IS NOT A BOOKING, AND IT NEVER WEARS THE BOOKING BUTTON'S WORDS. */}
                <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                  {b.requestNote ?? "You can ask this practice for an appointment. It is not booked until they reply."}
                </p>
                <Link href={b.bookingPath!}
                  className="mt-3 flex w-full items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] font-bold text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500">
                  Request an appointment
                </Link>
              </>
            ) : (
              // AC-12: no enabled CTA where nothing can be completed. The sentence comes from the
              // engine, so it is true today rather than true when somebody last edited this file.
              <p className="mt-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/70 p-3 text-[11.5px] leading-relaxed text-gray-600">
                {b.whyNot ?? "Online booking is not open for this practitioner at the moment."}
              </p>
            )}

            {b.state === "unreadable" && (
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                Nothing about booking has been assumed here &mdash; the check itself did not complete.
              </p>
            )}
          </section>

          {/* s10/s15: the practice's OWN published contacts. Rendered only where it published one. */}
          {(p.help.email || p.help.phone) && (
            <section className={card} aria-labelledby="help-heading">
              <h2 id="help-heading" className={h2}>Need help?</h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">
                If you have a question about booking, contact the practice.
              </p>
              <ul className="mt-2 space-y-1 text-[12px]">
                {p.help.email && (
                  <li>
                    <a href={`mailto:${p.help.email}`} className="font-semibold text-[var(--cp-primary)] hover:underline">
                      {p.help.email}
                    </a>
                  </li>
                )}
                {p.help.phone && (
                  <li>
                    <a href={`tel:${p.help.phone.replace(/\s+/g, "")}`} className="font-semibold text-[var(--cp-primary)] hover:underline">
                      {p.help.phone}
                    </a>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>

        {/* ── DECISION SUPPORT + SECONDARY (s7, s8, s9) ──────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 md:order-1">

          {/* s7: the types a patient may actually choose, in patient words. Never "All types". */}
          {p.consultationTypes.length > 0 && (
            <section className={card} aria-labelledby="types-heading">
              <h2 id="types-heading" className={h2}>Consultations offered</h2>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {p.consultationTypes.map(t => (
                  <li key={t.code}
                    className="rounded-lg bg-[var(--cp-primary-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--cp-primary-deep)]">
                    {t.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* s8: "Available at", with the mode said out loud. */}
          {p.locations.length > 0 && (
            <section className={card} aria-labelledby="where-heading">
              <h2 id="where-heading" className={h2}>Available at</h2>
              <ul className="mt-2 space-y-2">
                {p.locations.map(l => (
                  <li key={l.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[12.5px] font-semibold text-gray-900">{l.name}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                      {MODE_LABEL[l.mode] ?? MODE_LABEL.in_person}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Anything the practice wants a patient to read before booking. */}
          {p.instructions && (
            <section className={card} aria-labelledby="before-heading">
              <h2 id="before-heading" className={h2}>Before you book</h2>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700">{p.instructions}</p>
            </section>
          )}

          {/* s9/s17: About and Languages collapse entirely when unset -- absence is not a section. */}
          {p.bio && (
            <section className={card} aria-labelledby="about-heading">
              <h2 id="about-heading" className={h2}>About</h2>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-gray-700">{p.bio}</p>
            </section>
          )}

          {p.languages && (
            <section className={card} aria-labelledby="languages-heading">
              <h2 id="languages-heading" className={h2}>Languages</h2>
              <p className="mt-1 text-[12.5px] text-gray-700">{p.languages}</p>
            </section>
          )}
        </div>
      </div>

      {/* ── TRUST AND FOOTER (s10, s11) ────────────────────────────────────────────────────────────
          ⚠ AC-09: the "this page is not listed in search" line is GONE. Search-indexing policy is not a
          patient's task and reading it beside a booking button undermines exactly the confidence the
          rest of this page is for. The robots directive still says it -- to robots.

          ⚠ AND THERE ARE NO PRIVACY OR TERMS LINKS, because this deployment serves no public page at
          either address. s11 requires real destinations, and a dead link in a trust footer is worse
          than a missing one. What the PRACTICE published about its own handling of details is rendered
          here as text, which is a real disclosure rather than a link to nothing. */}
      <footer className="mt-2 flex flex-col gap-2 border-t border-gray-200 pt-4">
        <p className="flex items-center gap-1.5 text-[11.5px] text-gray-600">
          <span aria-hidden>🔒</span>
          Secure online booking. Your details are used to arrange this appointment.
        </p>
        {p.privacyNotice && (
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-gray-500">{p.privacyNotice}</p>
        )}
        <p className="text-[11px] text-gray-400">
          Powered by <Link href="/practice" className="hover:underline">Competen Practice</Link>
        </p>
      </footer>
    </div>
  );
}
