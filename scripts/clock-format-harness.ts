/**
 * Clock formatting harness. No database, no migration.
 *
 * WHAT IT PROVES:
 *   1. EVERY CLOCK IS 24-HOUR, and midnight is 00:00 rather than 24:00 -- the one moment where
 *      hour12:false and hourCycle "h23" disagree, and where "24:00" on a ward round reads as tomorrow.
 *   2. THE PRACTICE'S ZONE WINS WHEN IT IS GIVEN. A 22:00Z instant is 01:00 the next day in Kampala,
 *      and the formatter must say so rather than reporting the reader's own clock.
 *   3. ⚠ NO CALL SITE FORMATS A CLOCK WITHOUT A LOCALE. `new Date(x).toLocaleString()` uses the
 *      RUNTIME'S locale -- the server's in one place, the reader's laptop in another -- so the same
 *      timestamp could render "2:30 PM" and "14:30" on one screen. Twenty-eight sites were doing it.
 *   4. NOTHING ASKS FOR 12-HOUR ANYWHERE.
 *
 *   npx --yes tsx scripts/clock-format-harness.ts
 */
import { execSync } from "node:child_process";
import {
  formatTime, formatDate, formatDateTime, formatDayTime, formatMinuteOfDay, formatTimeWithSeconds,
} from "../src/lib/datetime";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const TZ = "Africa/Kampala"; // UTC+3, no DST.

function main() {
  console.log("\n=== CLOCK FORMATTING ===\n");

  // ---- 1. 24-hour, and midnight is 00:00 ---------------------------------------------------------
  ok("1a an afternoon time is 24-hour", formatTime("2026-08-04T14:30:00Z", "UTC") === "14:30",
    formatTime("2026-08-04T14:30:00Z", "UTC"));
  ok("1b ⚠ midnight is 00:00, not 24:00 -- the whole reason for hourCycle h23",
    formatTime("2026-08-04T00:00:00Z", "UTC") === "00:00", formatTime("2026-08-04T00:00:00Z", "UTC"));
  ok("1c and no meridiem anywhere in the output",
    !/AM|PM|am|pm/.test([
      formatTime("2026-08-04T14:30:00Z", "UTC"),
      formatDateTime("2026-08-04T14:30:00Z", "UTC"),
      formatDayTime("2026-08-04T14:30:00Z", "UTC"),
      formatTimeWithSeconds("2026-08-04T14:30:00Z", "UTC"),
    ].join(" ")));
  ok("1d one minute before midnight is 23:59", formatTime("2026-08-04T23:59:00Z", "UTC") === "23:59");
  ok("1e minutes past local midnight format the same way", formatMinuteOfDay(0) === "00:00" && formatMinuteOfDay(870) === "14:30",
    `${formatMinuteOfDay(0)} / ${formatMinuteOfDay(870)}`);

  // ---- 2. The practice's zone wins ----------------------------------------------------------------
  //
  // 22:00Z on the 4th is 01:00 on the 5th in Kampala. A formatter that ignored the zone would put a
  // ward round on the wrong day -- the defect CPR-300 already fixed once in the operations home.
  ok("2a a 22:00Z instant is 01:00 in Kampala", formatTime("2026-08-04T22:00:00Z", TZ) === "01:00",
    formatTime("2026-08-04T22:00:00Z", TZ));
  ok("2b and lands on the NEXT day there", formatDate("2026-08-04T22:00:00Z", TZ) === "5 Aug 2026",
    formatDate("2026-08-04T22:00:00Z", TZ));
  ok("2c CONTROL: in UTC the same instant is still the 4th",
    formatDate("2026-08-04T22:00:00Z", "UTC") === "4 Aug 2026", formatDate("2026-08-04T22:00:00Z", "UTC"));

  // ---- Empty in, empty out. A missing timestamp must not render "Invalid Date" on a clinical screen.
  ok("2d a null or unparseable value renders as nothing, never 'Invalid Date'",
    formatTime(null) === "" && formatDateTime(undefined) === "" && formatDate("not a date") === "",
    `${formatTime(null)}|${formatDateTime(undefined)}|${formatDate("not a date")}`);

  // ---- 3. ⚠ No call site formats a clock without a locale -----------------------------------------
  const bare = (() => {
    try {
      return execSync(
        `grep -rnE "Date\\([^)]*\\)\\.toLocale(Time)?String\\(\\)|\\.toLocaleTimeString\\(\\)" src/ --include=*.tsx --include=*.ts`,
        { encoding: "utf8" },
      ).trim().split("\n").filter(l => l && !l.includes("lib/datetime.ts"));
    } catch { return []; } // grep exits 1 when it finds nothing, which is the passing case.
  })();
  ok("3a no clock is rendered without an explicit locale", bare.length === 0,
    bare.slice(0, 3).join(" | "));

  // A grep that can never match would pass forever. Prove the pattern finds the thing it looks for.
  const probe = `new Date(x).toLocaleString()`;
  ok("3b CONTROL: the pattern does match the shape it forbids",
    /Date\([^)]*\)\.toLocale(Time)?String\(\)/.test(probe));

  // ---- 4. Nothing asks for 12-hour ----------------------------------------------------------------
  const twelve = (() => {
    try {
      return execSync(
        `grep -rnE "hour12: *true|hourCycle: *['\\"]h12['\\"]" src/ --include=*.tsx --include=*.ts`,
        { encoding: "utf8" },
      ).trim().split("\n").filter(Boolean);
    } catch { return []; }
  })();
  ok("4a nothing requests a 12-hour clock", twelve.length === 0, twelve.slice(0, 3).join(" | "));

  // ---- 5. ⚠ Every Practice clock names the PRACTICE's zone ------------------------------------
  //
  // formatDayTime's second argument is the timezone. Called with one argument it falls back to the
  // runtime's zone -- the SERVER's on a server component, the DEVICE's on a client one. Neither is the
  // practice's, and a consultation's clock is the practice's or it is wrong.
  //
  // This closes the practice-clock class rather than fixing it once: the 57-site sweep left four behind
  // (ContextPanel x2, EncounterAttachments, EncounterConsole), and nothing would have caught a fifth.
  //
  // ⚠ Scope is src/app/practice only. Elsewhere in the estate a server-zone clock can be correct.
  // ⚠ The pattern reads a single argument as "no comma before the closing paren", so a first
  // argument containing its own call -- formatDayTime(pick(a, b)) -- would read as zoned. No call site
  // has that shape today; if one appears, this needs a paren-matching scan instead of a regex.
  const unzoned = (() => {
    try {
      return execSync(
        `grep -rnE "formatDayTime\\([^,)]*\\)" src/app/practice --include=*.tsx`,
        { encoding: "utf8" },
      ).trim().split("\n").filter(Boolean);
    } catch { return []; }
  })();
  ok("5a every Practice clock is formatted in the practice's timezone, never the runtime's",
    unzoned.length === 0, unzoned.slice(0, 3).join(" | "));

  const ZONED = /formatDayTime\([^,)]*\)/;
  ok("5b CONTROL: the pattern catches a bare call and spares a zoned one",
    ZONED.test("{formatDayTime(e.started_at)}")
      && !ZONED.test("{formatDayTime(e.started_at, props.timezone)}"));

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main();
