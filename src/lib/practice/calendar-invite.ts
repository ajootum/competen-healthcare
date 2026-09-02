// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-FLOW-002 s13 -- "Offer Add to calendar using a safe generated calendar artifact/link."
//
// ⚠ WHAT GOES IN A CALENDAR FILE, AND WHAT MUST NOT.
//
// An .ics lands in somebody's calendar and is then out of this product's reach: synced to a phone, a
// work account, a shared family calendar, a laptop somebody else can see. It is read by whoever glances
// at that screen, which is the same threat model messaging.ts's templates were written for -- so the
// same rule applies. The event carries WHO and WHERE and WHEN, and never why: no reason for the visit,
// no stated condition, no treatment, no patient-quoted diagnosis. "Appointment with A Nsubuga" on a
// lock screen discloses an appointment. "Oncology follow-up" discloses an illness.
//
// ⚠ AND IT IS BUILT IN THE BROWSER FROM DATA THE PAGE ALREADY HAS.
//
// The obvious alternative -- a route that serves the file -- would be a new public endpoint returning a
// named patient's appointment details, addressable by whatever it takes as a parameter, which is an
// enumeration surface this product spent real effort not having. The confirmation screen already holds
// every value the file needs, so nothing new is exposed and no request is made.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type CalendarInvite = {
  /** The reference, so a calendar entry can be matched to the booking without any clinical detail. */
  reference: string;
  practitioner: string;
  /** ISO instant. */
  startsAt: string;
  minutes: number;
  locationName: string | null;
  /** The practice's own address, where it configured one (migration 365). */
  address: string | null;
};

/**
 * RFC 5545 text escaping.
 *
 * ⚠ THIS IS THE PART THAT BREAKS QUIETLY. A comma in an address is a VALUE SEPARATOR in iCalendar, so
 * "Plot 9, Nsambya Hill" silently becomes two values and calendars render it wrong or drop the rest.
 * Backslash first, or every escape this function adds is escaped again by the ones after it.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    // A literal newline ends a property. CRLF and lone CR both collapse to the escaped form.
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** iCalendar's UTC stamp: 20260902T083000Z. */
export function icsStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("an appointment with no valid time cannot become a calendar entry");
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * ⚠ LINES ARE FOLDED AT 75 OCTETS, because RFC 5545 says so and because the parsers that enforce it
 * reject the whole file rather than the long line. An address plus a location name passes 75 easily.
 * Folding is a CRLF followed by ONE space, and the continuation counts its own leading space.
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: step back to a boundary.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuations carry a leading space, which counts toward the 75
  }
  return parts.join("\r\n ");
}

/**
 * The calendar entry for one booked appointment.
 *
 * ⚠ NO ORGANIZER AND NO ATTENDEE. Both take email addresses, and putting the patient's address in a
 * file they may forward -- or the practice's in one that lands in a spam corpus -- buys nothing: the
 * patient already knows who they are, and the practice's contact is on the confirmation screen.
 */
export function buildIcs(invite: CalendarInvite, now: string): string {
  const start = new Date(invite.startsAt);
  if (Number.isNaN(start.getTime())) throw new Error("an appointment with no valid time cannot become a calendar entry");
  const end = new Date(start.getTime() + Math.max(1, invite.minutes) * 60_000);

  const where = [invite.locationName, invite.address].filter(Boolean).join(", ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    // A product id is required. It names this product and nothing about the practice or the patient.
    "PRODID:-//Competen Practice//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // ⚠ THE REFERENCE IS THE UID, so re-adding the same booking updates the entry rather than creating
    // a second one -- and the reference is already the non-clinical handle this product gives patients.
    `UID:${escapeIcsText(invite.reference)}@competenhealthcare.com`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(start.toISOString())}`,
    `DTEND:${icsStamp(end.toISOString())}`,
    `SUMMARY:${escapeIcsText(`Appointment with ${invite.practitioner}`)}`,
    ...(where ? [`LOCATION:${escapeIcsText(where)}`] : []),
    // ⚠ THE REFERENCE, AND NOTHING ELSE. See this file's header on what a calendar entry may carry.
    `DESCRIPTION:${escapeIcsText(`Booking reference ${invite.reference}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF throughout: RFC 5545 requires it, and Outlook is the parser that actually cares.
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/**
 * Where "Get directions" should point.
 *
 * ⚠ AN EXACT LINK BEATS A SEARCH, ALWAYS. Two clinics share a name and a street repeats in the next
 * town, so a search is a guess -- and the wrong guess sends a sick person to the wrong building. Where
 * the practice pinned the place, that is the answer; where it only wrote an address, a search of the
 * ADDRESS is far narrower than one of the name; where it configured neither, there is no button.
 */
export function directionsUrl(location: {
  name?: string | null; address?: string | null; mapUrl?: string | null;
}): string | null {
  const pinned = (location.mapUrl ?? "").trim();
  // The database constrains this to https, and this is the second half of the same rule: a link that
  // reaches a patient is checked where it is rendered as well as where it is stored.
  if (pinned.startsWith("https://")) return pinned;

  const address = (location.address ?? "").trim();
  if (!address) return null;
  // The name is included only alongside a real address, where it narrows rather than guesses.
  const query = [location.name?.trim(), address].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
