import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_ZONE, READER_SHAPES, READER_ZONE_COOKIE, formatForReader, readerZoneCookie, readerZoneSync, resolveReaderClock, validTimeZone, zoneLabel, zoneOffsetMinutes,
  type ReaderClock, type ReaderShape,
} from "./datetime";
import { validateWrite } from "./personalisation/preferences";
import { learnerTimeZone, learnerToday, localDay } from "./individual/scholar/learning-definitions";

const clock = (zone: string): ReaderClock => ({ zone, source: "device" });
const SHAPES = Object.keys(READER_SHAPES) as ReaderShape[];

describe("validTimeZone", () => {
  it("accepts real zones and refuses everything else without throwing", () => {
    expect(validTimeZone("Africa/Kampala")).toBe("Africa/Kampala");
    expect(validTimeZone("UTC")).toBe("UTC");
    for (const bad of ["", "Not/AZone", "+03:00", "Etc/Unknown", "x".repeat(65), "a;b", "<script>", null, undefined, 3, {}]) expect(validTimeZone(bad)).toBeNull();
  });
  it("keeps answering correctly after more names than its cache holds, in any letter case", () => {
    const base = "africa/kampala";
    for (let i = 0; i < 1100; i++) {
      const name = [...base].map((c, n) => ((i >> (n % 11)) & 1 ? c.toUpperCase() : c)).join("");
      expect(validTimeZone(name)).toBe(name);
      zoneOffsetMinutes(new Date("2026-11-06T12:00:00Z"), name);
    }
    expect(validTimeZone("Africa/Kampala")).toBe("Africa/Kampala");
    expect(validTimeZone("Not/AZone")).toBeNull();
  });
});

describe("resolveReaderClock: choice, then device, then network, then home", () => {
  const all = { choice: "Europe/London", device: "Asia/Tokyo", network: "America/New_York" };
  it("takes the first valid source and says which it was", () => {
    expect(resolveReaderClock(all)).toEqual({ zone: "Europe/London", source: "choice" });
    expect(resolveReaderClock({ ...all, choice: null })).toEqual({ zone: "Asia/Tokyo", source: "device" });
    expect(resolveReaderClock({ network: "America/New_York" })).toEqual({ zone: "America/New_York", source: "network" });
    expect(resolveReaderClock({})).toEqual({ zone: DEFAULT_READER_ZONE, source: "default" });
  });
  it("a VPN cannot beat the device: the network is only ever a fallback", () => {
    expect(resolveReaderClock({ device: "Africa/Kampala", network: "Europe/Amsterdam" }).zone).toBe("Africa/Kampala");
  });
  it("skips an invalid value at every level, so a bad stored zone or cookie cannot break a page", () => {
    expect(resolveReaderClock({ choice: "EAT;drop", device: "Not/AZone", network: "garbage!" })).toEqual({ zone: DEFAULT_READER_ZONE, source: "default" });
    expect(resolveReaderClock({ choice: "Not/AZone", device: "Asia/Tokyo" }).source).toBe("device");
  });
});

describe("formatForReader with the clock on", () => {
  it("names the zone beside a time of day, and not beside a date alone", () => {
    const at = "2026-11-06T20:22:05Z";
    expect(formatForReader(at, clock("Africa/Kampala"), "time")).toBe("23:22 EAT");
    expect(formatForReader(at, clock("Africa/Kampala"), "timeSeconds")).toBe("23:22:05 EAT");
    expect(formatForReader(at, clock("Africa/Kampala"), "dateTime")).toBe("6 Nov 2026, 23:22 EAT");
    expect(formatForReader(at, clock("Africa/Kampala"), "dayMonthTime")).toBe("6 Nov, 23:22 EAT");
    expect(formatForReader(at, clock("Africa/Kampala"), "date")).toBe("6 Nov 2026");
  });
  it("midnight is 00:00 on the new day, never 24:00", () => {
    const at = "2026-11-06T21:00:00Z";
    expect(formatForReader(at, clock("Africa/Kampala"), "dateTime")).toBe("7 Nov 2026, 00:00 EAT");
    expect(formatForReader(at, clock("UTC"), "dateTime")).toBe("6 Nov 2026, 21:00 UTC");
  });
  it("one minute either side of local midnight falls on two different dates", () => {
    expect(formatForReader("2026-11-06T20:59:00Z", clock("Africa/Kampala"), "date")).toBe("6 Nov 2026");
    expect(formatForReader("2026-11-06T21:00:00Z", clock("Africa/Kampala"), "date")).toBe("7 Nov 2026");
  });
  it("the same instant reads differently per reader, including across the year end", () => {
    const at = "2026-12-31T23:30:00Z";
    expect(formatForReader(at, clock("Pacific/Kiritimati"), "dateTime")).toBe("1 Jan 2027, 13:30 UTC+14");
    expect(formatForReader(at, clock("Pacific/Pago_Pago"), "dateTime")).toBe("31 Dec 2026, 12:30 UTC-11");
  });
  it("follows daylight saving through the repeated hour", () => {
    expect(formatForReader("2026-11-01T05:59:00Z", clock("America/New_York"), "time")).toBe("01:59 EDT");
    expect(formatForReader("2026-11-01T06:00:00Z", clock("America/New_York"), "time")).toBe("01:00 EST");
    expect(formatForReader("2026-10-25T00:59:00Z", clock("Europe/London"), "time")).toBe("01:59 BST");
    expect(formatForReader("2026-10-25T01:00:00Z", clock("Europe/London"), "time")).toBe("01:00 GMT");
  });
  it("never moves a calendar day, however far west the reader is", () => {
    for (const z of ["America/Los_Angeles", "Pacific/Pago_Pago", "Pacific/Kiritimati", "Africa/Kampala"]) {
      expect(formatForReader("2026-11-06", clock(z), "date")).toBe("6 Nov 2026");
    }
  });
  it("a zone this runtime does not know falls back and never throws", () => {
    expect(formatForReader("2026-11-06T20:22:00Z", clock("Not/AZone"), "time")).toBe("23:22 EAT");
  });
  it("an unreadable value gives nothing", () => {
    for (const v of ["not a date", "", null, undefined]) expect(formatForReader(v, clock("Africa/Kampala"), "dateTime")).toBe("");
  });
  it("does not depend on where the code runs, which is what keeps hydration safe", () => {
    const original = process.env.TZ;
    const seen = new Set<string>();
    try {
      for (const tz of ["UTC", "Asia/Tokyo", "America/New_York"]) {
        process.env.TZ = tz;
        seen.add(formatForReader("2026-11-06T20:22:00Z", clock("Africa/Kampala"), "dateTime"));
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
    expect([...seen]).toEqual(["6 Nov 2026, 23:22 EAT"]);
  });
});

describe("formatForReader with the clock off gives exactly what each site gave before", () => {
  const instants = ["2026-11-06T20:22:05Z", "2026-11-06T21:00:00Z", "2026-09-30T00:00:00Z", "2026-01-01T23:59:59Z"];
  const zones = ["UTC", "Africa/Nairobi", undefined];
  it.each(SHAPES)("shape %s", shape => {
    for (const at of instants) for (const zone of zones) {
      const o = { ...READER_SHAPES[shape], ...(zone ? { timeZone: zone } : {}) };
      expect(formatForReader(at, null, shape, zone)).toBe(new Date(at).toLocaleString("en-GB", o));
    }
  });
  it("matches the old date, time and Intl expressions those sites used", () => {
    for (const at of instants) {
      const d = new Date(at);
      expect(formatForReader(at, null, "date", "UTC")).toBe(d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
      expect(formatForReader(at, null, "dateLong", "UTC")).toBe(d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
      expect(formatForReader(at, null, "dayMonth")).toBe(d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
      expect(formatForReader(at, null, "time")).toBe(d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }));
      expect(formatForReader(at, null, "timeSeconds")).toBe(d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      expect(formatForReader(at, null, "dateTime", "Africa/Nairobi")).toBe(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(d));
    }
  });
  it("adds no zone name", () => {
    expect(formatForReader("2026-11-06T20:22:00Z", null, "dateTime", "UTC")).toBe("6 Nov 2026, 20:22");
    expect(formatForReader("2026-11-06T20:22:00Z", undefined, "time", "UTC")).toBe("20:22");
  });
});

describe("zoneLabel", () => {
  const at = new Date("2026-11-06T12:00:00Z");
  it("uses a name only where the real offset matches it", () => {
    expect(zoneLabel(at, "Africa/Kampala")).toBe("EAT");
    expect(zoneLabel(at, "Africa/Nairobi")).toBe("EAT");
    expect(zoneLabel(at, "Africa/Kigali")).toBe("CAT");
    expect(zoneLabel(at, "Africa/Juba")).toBe("CAT");
    expect(zoneLabel(at, "Africa/Lagos")).toBe("WAT");
    expect(zoneLabel(at, "Africa/Johannesburg")).toBe("SAST");
    expect(zoneLabel(at, "Asia/Kolkata")).toBe("IST");
  });
  it("Juba was EAT before February 2021, so the old date reads as an offset and not as a wrong name", () => {
    expect(zoneLabel(new Date("2020-06-01T12:00:00Z"), "Africa/Juba")).toBe("UTC+3");
  });
  it("otherwise states the offset, including half hours and west of UTC", () => {
    expect(zoneLabel(at, "UTC")).toBe("UTC");
    expect(zoneLabel(at, "Asia/Tokyo")).toBe("UTC+9");
    expect(zoneLabel(at, "Asia/Kathmandu")).toBe("UTC+5:45");
    expect(zoneLabel(at, "America/St_Johns")).toBe("UTC-3:30");
    expect(zoneLabel(at, "Etc/GMT-3")).toBe("UTC+3");
  });
  it("offset arithmetic holds at midnight, where h23 matters", () => {
    expect(zoneOffsetMinutes(new Date("2026-11-06T21:00:00Z"), "Africa/Kampala")).toBe(180);
    expect(zoneOffsetMinutes(new Date("2026-11-06T21:00:00.999Z"), "Africa/Kampala")).toBe(180);
  });
});

describe("readerZoneSync cannot loop", () => {
  const network: ReaderClock = { zone: "Europe/Amsterdam", source: "network" };
  it("first visit: writes the device zone and refreshes when the page used another zone", () => {
    expect(readerZoneSync({ device: "Africa/Kampala", cookie: null, clock: network })).toEqual({ write: "Africa/Kampala", refresh: true });
  });
  it("first visit where the estimate was right: writes, with no refresh", () => {
    expect(readerZoneSync({ device: "Europe/Amsterdam", cookie: null, clock: network })).toEqual({ write: "Europe/Amsterdam", refresh: false });
  });
  it("after the refresh the cookie matches, so nothing more happens", () => {
    expect(readerZoneSync({ device: "Africa/Kampala", cookie: "Africa/Kampala", clock: { zone: "Africa/Kampala", source: "device" } })).toEqual({ write: null, refresh: false });
  });
  it("a zone the server rejected still settles: the cookie matches and no refresh follows", () => {
    expect(readerZoneSync({ device: "Africa/Kampala", cookie: "Africa/Kampala", clock: network })).toEqual({ write: null, refresh: false });
  });
  it("travelling: the new zone is written and the page refreshes", () => {
    expect(readerZoneSync({ device: "Asia/Tokyo", cookie: "Africa/Kampala", clock: { zone: "Africa/Kampala", source: "device" } })).toEqual({ write: "Asia/Tokyo", refresh: true });
  });
  it("a learner's own choice is kept: the cookie updates and the page does not refresh", () => {
    expect(readerZoneSync({ device: "Asia/Tokyo", cookie: "Africa/Kampala", clock: { zone: "Europe/London", source: "choice" } })).toEqual({ write: "Asia/Tokyo", refresh: false });
  });
  it("a device with no usable zone does nothing", () => {
    for (const device of ["Etc/Unknown", null, undefined, ""]) expect(readerZoneSync({ device, cookie: null, clock: network })).toEqual({ write: null, refresh: false });
  });
});

describe("readerZoneCookie", () => {
  it("is a year long, Lax, and Secure on https", () => {
    expect(readerZoneCookie("Africa/Kampala", true)).toBe(`${READER_ZONE_COOKIE}=Africa%2FKampala; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
    expect(readerZoneCookie("Africa/Kampala", false)).not.toContain("Secure");
  });
});

describe("the preference door refuses a zone that is not real", () => {
  const def = { label: "Time zone", group: "regional", type: "text", fallback: "Africa/Nairobi", blurb: "" };
  const resolved = [{ key: "timezone", def, editable: true, lockedBy: null }] as never;
  it("keeps a real zone, clears on empty and refuses the rest", () => {
    expect(validateWrite("timezone", "Africa/Kampala", resolved)).toEqual({ ok: true, stored: "Africa/Kampala" });
    expect(validateWrite("timezone", "", resolved)).toEqual({ ok: true, stored: null });
    expect(validateWrite("timezone", "Not/AZone", resolved).ok).toBe(false);
    expect(validateWrite("timezone", "x".repeat(61), resolved).ok).toBe(false);
  });
});

describe("the learner's day is untouched by the reader's clock", () => {
  const headers = (tz: string | null) => ({ get: () => tz });
  it("still comes from the request, with UTC when absent", () => {
    expect(learnerTimeZone(headers("Africa/Nairobi"))).toBe("Africa/Nairobi");
    expect(learnerTimeZone(headers(null))).toBe("UTC");
    expect(learnerTimeZone(headers("Not/AZone"))).toBe("UTC");
    expect(learnerToday(headers("Africa/Kampala"), new Date("2026-11-06T21:00:00Z"))).toBe("2026-11-07");
    expect(localDay("2026-11-06T21:00:00Z", "UTC")).toBe("2026-11-06");
  });
});
