/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-BOOK-PROFILE-001 -- the public booking profile render pin (AC-15).
 *
 * renderToString of the real component with fixtures typed against the ENGINE's own projection, so a
 * fixture cannot drift from the shape the page actually receives. Nothing here touches a database.
 *
 * What this pins, and why each is worth a test:
 *
 *   1. THE THINGS THAT WERE ON THE OLD PAGE AND MUST NEVER RETURN (AC-02, AC-04, AC-05, AC-09): the
 *      internal CP number, the raw booking URL, the "All types" free-text field and the
 *      search-indexing warning. Each was on the live page before this arc; each is a regression a
 *      future edit could reintroduce in one line, and only an OUTPUT scan catches it.
 *   2. THE VERIFIED BADGE APPEARS ONLY WHERE THE PROJECTION SAYS VERIFIED (AC-01/s4). This is the one
 *      claim on the page ABOUT a person rather than about what they offer, and the comp that prompted
 *      this arc showed the badge on a practitioner whose licence has never been checked.
 *   3. CTA ELIGIBILITY (AC-03, AC-12): a booking button exists only where a booking can be completed,
 *      a REQUEST never wears the booking button's words, and neither appears where nothing can be done.
 *   4. OPTIONAL CONTENT COLLAPSES CLEANLY (AC-08/s17) -- no empty "About" heading over nothing.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import ProfileView from "./ProfileView";
import type { PublicBookingProfile } from "@/lib/practice/public-profile";

const full: PublicBookingProfile = {
  handle: "elisham1",
  displayName: "Mullen Elisha",
  initials: "ME",
  photoUrl: null,
  credentials: "BSN",
  specialty: "Pediatric Critical Care",
  subSpecialty: null,
  bio: null,
  languages: "English",
  practiceName: "Nsambya Paediatrics",
  locations: [{ name: "Nsambya Hospital", mode: "in_person" }],
  consultationTypes: [
    { code: "new_consultation", label: "New patient" },
    { code: "scheduled_followup", label: "Follow-up" },
  ],
  booking: {
    state: "open", canBook: true, canRequestWithoutCode: false, requestNote: null,
    whyNot: null, bookingPath: "/practice/book/@elisham1/appointment",
  },
  availabilityNote: null,
  help: { email: "reception@example.org", phone: null },
  privacyNotice: null,
  instructions: null,
};

const render = (p: PublicBookingProfile, slot?: React.ReactNode) =>
  renderToString(
    React.createElement(
      AppRouterContext.Provider,
      { value: { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} } as never },
      React.createElement(ProfileView, { p, availabilitySlot: slot }),
    ),
  ).replace(/<!-- -->/g, "");

describe("CPR-BOOK-PROFILE-001 public booking profile", () => {
  it("leads with the name and credential, and keeps the handle secondary (AC-01)", () => {
    const html = render(full);
    expect(html).toContain("Mullen Elisha, BSN");
    expect(html).toContain("@elisham1");
    // The name is the h1; the handle must not be.
    expect(html).toMatch(/<h1[^>]*>[^<]*Mullen Elisha/);
    expect(html).not.toMatch(/<h1[^>]*>@elisham1/);
  });

  it("never renders the internal CP number, the raw booking URL, or an indexing warning (AC-02, AC-04, AC-09)", () => {
    const html = render(full);
    expect(html).not.toMatch(/CP-\d{6}-\d/);
    expect(html).not.toMatch(/https?:\/\/[^"]*book/);
    expect(html).not.toMatch(/not listed in search/i);
  });

  it("never renders the identity's free-text consultation field (AC-05)", () => {
    // The live profile that prompted this arc carried consultation_types = "All types". The projection
    // has no field for it at all, so this asserts the rendered surface as well as the contract.
    const html = render(full);
    expect(html).not.toMatch(/All types/i);
    expect(html).toContain("New patient");
    expect(html).toContain("Follow-up");
  });

  it("NEVER renders a verified badge -- the product has no verification that justifies one (s4)", () => {
    // ⚠ THE COMP SHOWED THIS BADGE AND IT WAS BUILT, AND A HARNESS WAS RIGHT TO REFUSE IT.
    // practice-booking-link-harness 5b-tick holds the line: licence_verified_at is "a provenance record
    // rather than a verification. Nothing here contacts a council." A tick tells a patient a regulator
    // was checked. There is no fixture that can turn this on, because the projection carries no field
    // for it -- which is the point.
    expect(render(full)).not.toMatch(/Verified/i);
    expect(JSON.stringify(Object.keys(full))).not.toMatch(/verified|licence/i);
  });

  it("offers one dominant booking action when a booking can be completed (AC-03)", () => {
    const html = render(full);
    expect(html).toContain("Book an appointment");
    expect(html).toContain("/practice/book/@elisham1/appointment");
    expect(html).not.toMatch(/Request an appointment/);
  });

  it("calls a request a request, never a booking (AC-12)", () => {
    const html = render({
      ...full,
      booking: {
        state: "closed", canBook: false, canRequestWithoutCode: true,
        requestNote: "The practice will reply to arrange a time.",
        whyNot: null, bookingPath: "/practice/book/@elisham1/appointment",
      },
    });
    expect(html).toContain("Request an appointment");
    // The words matter: a button saying "Book" that produces a message is the worst sentence here.
    expect(html).not.toMatch(/>\s*Book an appointment\s*</);
  });

  it("shows no enabled call to action where nothing can be completed, and says why (AC-12)", () => {
    const html = render({
      ...full,
      booking: {
        state: "closed", canBook: false, canRequestWithoutCode: false, requestNote: null,
        whyNot: "This practice is not accepting online bookings right now.",
        bookingPath: null,
      },
    });
    expect(html).toContain("This practice is not accepting online bookings right now.");
    expect(html).not.toContain("/practice/book/@elisham1/appointment");
  });

  it("collapses optional content instead of leaving empty headings (AC-08)", () => {
    const bare = render({
      ...full, bio: null, languages: null, instructions: null,
      locations: [], consultationTypes: [], practiceName: null,
    });
    expect(bare).not.toMatch(/>About</);
    expect(bare).not.toMatch(/>Languages</);
    expect(bare).not.toMatch(/>Available at</);
    expect(bare).not.toMatch(/>Consultations offered</);
    // ...while the identity and the booking module still stand.
    expect(bare).toContain("Mullen Elisha");
    expect(bare).toContain("Book an appointment");
  });

  it("renders About and Languages when they exist (AC-08)", () => {
    const html = render({ ...full, bio: "Twelve years in paediatric intensive care." });
    expect(html).toContain("About");
    expect(html).toContain("Twelve years in paediatric intensive care.");
    expect(html).toContain("Languages");
    expect(html).toContain("English");
  });

  it("labels consultation mode in patient words, never the location's kind (AC-06)", () => {
    const html = render({
      ...full,
      locations: [{ name: "Nsambya Hospital", mode: "in_person" }, { name: "Video clinic", mode: "virtual" }],
    });
    expect(html).toContain("Available at");
    expect(html).toContain("In-person");
    expect(html).toContain("Online consultation");
    // The operational vocabulary must not reach the patient.
    expect(html).not.toMatch(/teleconsultation|outreach|independent/i);
  });

  it("renders initials and NO image element when there is no photograph (s17)", () => {
    const html = render(full);
    // ⚠ "DO NOT SHOW BROKEN IMAGE" MEANS THERE IS NO <img> AT ALL, not an <img> with an empty src --
    // a browser draws the second one as a broken-file icon under a clinician's name.
    expect(html).not.toMatch(/<img/);
    expect(html).toContain("ME");
  });

  it("renders the photograph when there is one, with the person as its alt text (s16)", () => {
    const html = render({ ...full, photoUrl: "https://example.supabase.co/storage/v1/object/public/practitioner-photos/abc.jpg" });
    expect(html).toMatch(/<img[^>]+src="https:\/\/example\.supabase\.co[^"]+abc\.jpg"/);
    // The alt describes who is depicted, not the file. "Profile photo" tells a screen-reader user
    // nothing the heading beside it did not already say.
    expect(html).toMatch(/<img[^>]+alt="Mullen Elisha"/);
    // And the initials fallback is not also drawn underneath it.
    expect(html).not.toMatch(/>ME</);
  });

  it("carries the practice's own help contact only when it published one (s15)", () => {
    expect(render(full)).toContain("reception@example.org");
    const none = render({ ...full, help: { email: null, phone: null } });
    expect(none).not.toMatch(/Need help\?/);
  });

  it("renders whatever availability region it is handed, and none when handed nothing (s6)", () => {
    const withSlot = render(full, React.createElement("p", null, "Next available Tomorrow, 08:30"));
    expect(withSlot).toContain("Next available Tomorrow, 08:30");
    expect(render(full)).not.toMatch(/Next available/);
  });

  it("states secure booking and attributes Competen without linking to pages that do not exist (s10, s11)", () => {
    const html = render(full);
    expect(html).toMatch(/Secure online booking/);
    expect(html).toContain("Competen Practice");
    // s11 requires real destinations; this deployment serves no public privacy or terms route.
    expect(html).not.toMatch(/href="\/privacy"/);
    expect(html).not.toMatch(/href="\/terms"/);
  });
});
