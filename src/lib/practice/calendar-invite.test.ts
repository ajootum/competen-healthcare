/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * CPR-BOOK-FLOW-002 s13 -- the calendar entry, and the two things it must never do.
 *
 *   1. CARRY CLINICAL CONTENT. The file lands in a calendar this product cannot reach afterwards --
 *      synced to a phone, a work account, a shared family calendar. "Appointment with A Nsubuga" on a
 *      lock screen discloses an appointment; "Oncology follow-up" discloses an illness.
 *   2. PRODUCE A FILE A CALENDAR REFUSES. Escaping and folding are the parts that break silently: a
 *      comma in an address is a value separator in iCalendar, and a line over 75 octets makes strict
 *      parsers reject the whole file rather than the line.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { buildIcs, escapeIcsText, icsStamp, foldIcsLine, directionsUrl } from "./calendar-invite";

const NOW = "2026-09-02T06:00:00.000Z";
const base = {
  reference: "CP-7K2M9Q",
  practitioner: "Amara Nsubuga",
  startsAt: "2026-09-09T05:30:00.000Z",
  minutes: 30,
  locationName: "Nsambya Hospital",
  address: "Plot 9, Nsambya Hill, Kampala",
};

describe("iCalendar escaping", () => {
  it("escapes the comma that would otherwise split an address into values", () => {
    expect(escapeIcsText("Plot 9, Nsambya Hill")).toBe("Plot 9\\, Nsambya Hill");
  });

  it("escapes semicolons and newlines", () => {
    expect(escapeIcsText("a;b")).toBe("a\\;b");
    expect(escapeIcsText("a\nb")).toBe("a\\nb");
    expect(escapeIcsText("a\r\nb")).toBe("a\\nb");
  });

  it("escapes the backslash FIRST, so later escapes are not escaped again", () => {
    // ⚠ ORDER-DEPENDENT AND SILENT WHEN WRONG. Escaping commas before backslashes turns "a\,b" into
    // "a\\\,b" -- a literal backslash followed by an escaped comma, which is not what was written.
    expect(escapeIcsText("a\\b")).toBe("a\\\\b");
    expect(escapeIcsText("a\\,b")).toBe("a\\\\\\,b");
  });
});

describe("iCalendar stamps", () => {
  it("renders a UTC stamp with no punctuation", () => {
    expect(icsStamp("2026-09-09T05:30:00.000Z")).toBe("20260909T053000Z");
  });

  it("refuses an instant it cannot read rather than writing a broken one", () => {
    expect(() => icsStamp("not a date")).toThrow();
  });
});

describe("line folding", () => {
  it("leaves a short line alone", () => {
    expect(foldIcsLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds a long line with CRLF and a single leading space", () => {
    const folded = foldIcsLine("LOCATION:" + "x".repeat(200));
    expect(folded).toContain("\r\n ");
    for (const segment of folded.split("\r\n"))
      expect(Buffer.from(segment, "utf8").length).toBeLessThanOrEqual(75);
  });

  it("never splits a multi-byte character in half", () => {
    // A name in a script where one character is several octets: splitting mid-character produces
    // mojibake in somebody's calendar rather than an error anybody would notice.
    const folded = foldIcsLine("SUMMARY:" + "é".repeat(80));
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "é".repeat(80));
  });
});

describe("the calendar entry", () => {
  const ics = buildIcs(base, NOW);

  it("is a complete VCALENDAR with CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it("carries who, where and when", () => {
    expect(ics).toContain("SUMMARY:Appointment with Amara Nsubuga");
    expect(ics).toContain("DTSTART:20260909T053000Z");
    expect(ics).toContain("DTEND:20260909T060000Z");
    expect(ics).toContain("Nsambya Hospital");
  });

  it("uses the booking reference as the UID, so re-adding updates rather than duplicates", () => {
    expect(ics).toContain("UID:CP-7K2M9Q@competenhealthcare.com");
  });

  it("⚠ CARRIES NO CLINICAL CONTENT -- the description is the reference and nothing else", () => {
    const clinical = buildIcs(base, NOW);
    for (const leak of ["oncology", "diabetes", "reason", "diagnosis", "treatment", "cough"])
      expect(clinical.toLowerCase()).not.toContain(leak);
    expect(clinical).toContain("DESCRIPTION:Booking reference CP-7K2M9Q");
  });

  it("omits LOCATION entirely when there is nowhere to name", () => {
    const nowhere = buildIcs({ ...base, locationName: null, address: null }, NOW);
    expect(nowhere).not.toContain("LOCATION:");
    // ...and is still a valid, complete event.
    expect(nowhere).toContain("SUMMARY:Appointment with Amara Nsubuga");
  });

  it("refuses an appointment with no valid time rather than writing a broken entry", () => {
    expect(() => buildIcs({ ...base, startsAt: "nonsense" }, NOW)).toThrow();
  });
});

describe("directions", () => {
  it("prefers the exact link the practice pinned", () => {
    expect(directionsUrl({ name: "X", address: "Somewhere", mapUrl: "https://maps.example/pinned" }))
      .toBe("https://maps.example/pinned");
  });

  it("falls back to a search of the ADDRESS, with the name only as a narrowing term", () => {
    const url = directionsUrl({ name: "Nsambya Hospital", address: "Plot 9, Nsambya Hill", mapUrl: null })!;
    expect(url.startsWith("https://www.google.com/maps/search/")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Plot 9, Nsambya Hill");
  });

  it("offers NOTHING when only a name is known", () => {
    // ⚠ THE ASSERTION THAT MATTERS. A search for a clinic name is a guess, and the wrong guess sends a
    // sick person to the wrong building. No address and no pin means no directions button.
    expect(directionsUrl({ name: "Nsambya Hospital", address: null, mapUrl: null })).toBeNull();
    expect(directionsUrl({ name: null, address: null, mapUrl: null })).toBeNull();
  });

  it("ignores a pinned link that is not https", () => {
    // The database refuses these; this is the second half of the same rule, where it is rendered.
    expect(directionsUrl({ name: "X", address: null, mapUrl: "javascript:alert(1)" })).toBeNull();
    expect(directionsUrl({ name: "X", address: null, mapUrl: "http://insecure.example" })).toBeNull();
  });
});
