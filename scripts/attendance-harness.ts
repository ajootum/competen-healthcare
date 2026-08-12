/**
 * Attendance harness. No database, no migration.
 *
 * The Booked & seen page carries the only percentage in Competen Practice. This proves it cannot say the
 * two things a percentage over these counts most easily says wrongly.
 *
 * WHAT IT PROVES:
 *   1. THE DENOMINATOR IS CLOSED. Nothing elapsed means no figure -- never "0% attended" over a week of
 *      bookings that have not happened yet.
 *   2. UNRECORDED IS NOT UNATTENDED. When more elapsed appointments have no outcome than have one, the
 *      percentage is withheld. Live data on 2026-08-12 was 4 unrecorded against 0 resolved, which would
 *      otherwise have printed a true, damning and meaningless "0% attended".
 *   3. THE LINE HOLDS EXACTLY WHERE IT CLAIMS TO -- equal is measurable, one more is not -- so the rule
 *      is a rule rather than a rounding.
 *   4. THE ARITHMETIC IS THE OWNER'S. "Of 40: 31 attended, 6 did not attend, 3 cancelled" is 78%, i.e.
 *      cancellations stay in the denominator, as specified on 2026-08-12.
 *   5. A FLOOR IS ONLY CLAIMED WHEN IT IS ONE. Where unrecorded appointments exist and the figure is
 *      still shown, real attendance can only be higher, never lower.
 *
 *   npx --yes tsx scripts/attendance-harness.ts
 */

import { attendanceVerdict, attendanceBucket } from "../src/lib/practice/patient-lists";

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (ok) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}\n        ${detail}`); }
};

console.log("\nATTENDANCE HARNESS\n");

// 1 ── nothing has elapsed
{
  const v = attendanceVerdict({ elapsed: 0, attended: 0, didNotAttend: 0, noOutcomeRecorded: 0 });
  check("1  an empty window yields no percentage",
    v.attendedPercent === null, `got ${v.attendedPercent}, expected null`);
}

// 2 ── the live 2026-08-12 shape: 5 elapsed, 1 cancelled, 4 unrecorded, nothing resolved
{
  const v = attendanceVerdict({ elapsed: 5, attended: 0, didNotAttend: 0, noOutcomeRecorded: 4 });
  check("2  nothing closed off yields no percentage, not 0%",
    v.attendedPercent === null, `got ${v.attendedPercent}, expected null`);
}

// 3 ── the boundary, from both sides
{
  const equal = attendanceVerdict({ elapsed: 10, attended: 4, didNotAttend: 1, noOutcomeRecorded: 5 });
  check("3a unrecorded EQUAL to resolved is still measurable",
    equal.attendedPercent === 40, `got ${equal.attendedPercent}, expected 40`);
  const over = attendanceVerdict({ elapsed: 11, attended: 4, didNotAttend: 1, noOutcomeRecorded: 6 });
  check("3b one more unrecorded than resolved withholds the figure",
    over.attendedPercent === null, `got ${over.attendedPercent}, expected null`);
}

// 4 ── the owner's own worked example
{
  const v = attendanceVerdict({ elapsed: 40, attended: 31, didNotAttend: 6, noOutcomeRecorded: 0 });
  check("4  'of 40: 31 attended, 6 did not attend, 3 cancelled' is 78%",
    v.attendedPercent === 78, `got ${v.attendedPercent}, expected 78`);
  check("4b cancellations stay in the denominator",
    v.attendedPercent !== Math.round((31 / 37) * 100),
    "31/37 would be 84% -- cancelled appointments must not be excluded");
}

// 5 ── wherever a figure IS shown alongside unrecorded appointments, it can only understate
{
  let violations = 0;
  for (let elapsed = 1; elapsed <= 40; elapsed++) {
    for (let attended = 0; attended <= elapsed; attended++) {
      for (let dna = 0; dna + attended <= elapsed; dna++) {
        for (let none = 0; none + attended + dna <= elapsed; none++) {
          const v = attendanceVerdict({ elapsed, attended, didNotAttend: dna, noOutcomeRecorded: none });
          if (v.attendedPercent === null) continue;
          // If every unrecorded appointment turned out to have been attended, the figure would rise.
          const ceiling = Math.round(((attended + none) / elapsed) * 100);
          if (v.attendedPercent > ceiling) violations++;
        }
      }
    }
  }
  check("5  a shown figure is never above what full recording could yield",
    violations === 0, `${violations} combinations overstated attendance`);
}

// 6 ── a figure is never produced from resolved counts alone when elapsed is smaller (guards a swap)
{
  const v = attendanceVerdict({ elapsed: 3, attended: 3, didNotAttend: 0, noOutcomeRecorded: 0 });
  check("6  a fully attended period is 100%, not above it",
    v.attendedPercent === 100, `got ${v.attendedPercent}, expected 100`);
}

// 7 ── the bucketing, which decides what the percentage is even made of
{
  const b = attendanceBucket;
  check("7a a recorded consultation is attendance",
    b("CONFIRMED", true) === "attended", b("CONFIRMED", true));
  check("7b so is the desk closing the appointment off, with no consultation written",
    b("COMPLETED", false) === "attended", b("COMPLETED", false));
  check("7c and so is arriving -- turning up IS attending",
    b("ARRIVED", false) === "attended", b("ARRIVED", false));
  check("7d a missed appointment is not folded in with the unrecorded ones",
    b("NO_SHOW", false) === "didNotAttend", b("NO_SHOW", false));
  check("7e an elapsed booking nobody actioned is UNRECORDED, never a failure to attend",
    b("REQUESTED", false) === "noOutcomeRecorded" && b("CONFIRMED", false) === "noOutcomeRecorded",
    `${b("REQUESTED", false)} / ${b("CONFIRMED", false)}`);
  check("7f cancelled is its own bucket and never attendance",
    b("CANCELLED", false) === "cancelled", b("CANCELLED", false));
  // ⚠ THE ONE THAT WOULD SLIP THROUGH SILENTLY. A cancelled appointment with an encounter against it is
  // a real shape -- somebody seen, then the booking cancelled by mistake or after the fact. It must not
  // become attendance, because then a cancellation could inflate the figure.
  check("7g ⚠ cancelled WINS over a stray encounter, so a cancellation cannot inflate attendance",
    b("CANCELLED", true) === "cancelled", b("CANCELLED", true));
  // ⚠ AND ITS OPPOSITE, so 7g is not passing merely because cancelled is checked first by accident.
  check("7h ⚠ but a NO_SHOW carrying an encounter IS attendance -- the consultation is the stronger fact",
    b("NO_SHOW", true) === "attended", b("NO_SHOW", true));
}

console.log(failures === 0 ? "\nALL PASS\n" : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
