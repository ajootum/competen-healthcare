import Link from "next/link";
import { APPOINTMENT_STATUS_SWATCH, ENCOUNTER_STATUS_SWATCH } from "@/lib/practice/palette";
// ⚠ planner-ui.ts is deliberately DATABASE-FREE and says so in its own header, which is the only reason
// a client component may import from it. Reaching for locationTone from anywhere in src/lib/practice
// would drag access.ts -> next/headers into the browser bundle and fail `next build` on pages nobody
// touched, while tsc and eslint stayed green.
import { locationTone } from "@/app/practice/(shell)/calendar/planner-ui";

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE SHARED LOOK OF EVERY PATIENT TABLE IN COMPETEN PRACTICE (CP-BOOKED-SEEN-001 s8, s9, s17).
//
// The owner, 2026-08-12: "I would like to achieve this view on these pages" and then "apply it to all
// the patient tables". There are five -- Booked & seen, the register, encounters, follow-ups and
// pathways -- and the spec's rules are not per-page rules, so they live here once.
//
// ⚠ NO "use client". These are plain render functions so a SERVER component can use them; the only
// client code in this family is the collapsible grouping, which needs state. That also keeps them safe
// from the trap that has bitten this codebase before: a FUNCTION on a payload handed to a client
// component type-checks, lints, passes every harness and kills the page at runtime. Everything here
// takes strings that were formatted on the server.
//
// The rules, and where each comes from:
//   s8  PATIENT NUMBER IS METADATA UNDER THE NAME, never its own full-width column -- it was a column
//       on Booked & seen, spending the widest thing on the row on the least-read value.
//   s8  NO ZEBRA STRIPING. Light dividers, compact rhythm, a hover state.
//   s8  THE HEADER STAYS PUT while a long result set scrolls.
//   s9  STATUS IS A TEXT BADGE. Colour supplements the word.
//   s17 MEANING NEVER RELIES ON COLOUR ALONE, which is why there is no bare-dot variant of the badge
//       here to reach for. Somebody who cannot separate amber from grey still reads the status.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** s8: light dividers and a hover state, deliberately NOT `odd:bg-*`. */
export const ROW = "border-t border-gray-100 transition-colors hover:bg-gray-50/70";

/**
 * THE CLINIC'S OWN COLOUR, ON THE CELL THAT NAMES THE CLINIC.
 *
 * The owner picked these colours for the planner (migration 290's color_slot) and then, seeing this
 * table: "the color theme has not landed". It had not. The status pills were tinted and every clinic was
 * the same grey, so the one column a person scans to answer "which of my sites is this?" carried no
 * colour at all -- the fourth time in this project a screen has shipped flat.
 *
 * ⚠ THE RULE THAT KEEPS BEING RELEARNT: THE VALUE TAKES THE COLOUR, not the decoration beside it. A grey
 * clinic name with a coloured dot next to it spends the colour on the dot and leaves the word -- the
 * thing actually being read -- looking like every other word on the row.
 *
 * ⚠ AND THE COLOUR IS NEVER THE ONLY CARRIER (s17). The clinic is spelled out in full on every row; the
 * hue only lets a month of bookings be scanned by site. Two clinics share a hue once a practice passes
 * six locations, which is acceptable precisely because the words are the identity.
 */
export function LocationCell({ locationId, locationName, locationSlot }: {
  locationId: string | null; locationName: string | null; locationSlot: string | null;
}) {
  // No location is a real state, not a missing one -- a booking can genuinely have no site yet.
  if (!locationName)
    return <td className="px-3 py-2 text-[12.5px] italic text-gray-400">not named</td>;
  const tone = locationTone(locationId, locationSlot);
  return (
    <td className="px-3 py-2">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        <span className={`text-[12.5px] font-semibold ${tone.place}`}>{locationName}</span>
      </span>
    </td>
  );
}

/**
 * s8: the header stays visible while the body scrolls. Needs an ancestor that actually scrolls --
 * TABLE_SCROLL below -- because `position: sticky` against a non-scrolling parent silently does nothing.
 */
export const THEAD = "sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm";
export const TH = "px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-500";
/** `cp-scroll` is the hook print rules use to undo the height cap -- a capped box truncates on paper. */
export const TABLE_SCROLL = "cp-scroll max-h-[70vh] overflow-y-auto overflow-x-auto";

/**
 * s6/s7/s8: NAME FIRST, NUMBER UNDERNEATH AS METADATA.
 *
 * ⚠ `unlinkedTitle` exists because a booking can name somebody before a record exists for them. That row
 * is not a broken link, and rendering it as plain text with no explanation reads like one.
 */
export function PatientCell({ patientId, name, patientNumber, unlinkedTitle, sex }: {
  patientId: string | null;
  name: string;
  patientNumber?: string | null;
  unlinkedTitle?: string;
  sex?: string | null;
}) {
  return (
    <td className="px-3 py-2">
      <div className="flex items-center gap-2.5">
        <Avatar name={name} seed={patientId ?? name} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight text-gray-900">
            {patientId
              ? <Link href={`/practice/patients/${patientId}`} className="hover:underline">{name}</Link>
              : <span title={unlinkedTitle ?? "Named at booking, before a patient record existed"}>{name}</span>}
          </div>
          {/* select-all so the number can be lifted in one gesture -- s6 "number remains copyable". */}
          {patientNumber
            ? <div className="mt-0.5 text-[11px] leading-tight text-gray-500">
              <span className="select-all font-mono">{patientNumber}</span><SexGlyph sex={sex ?? null} />
            </div>
            : <div className="mt-0.5 text-[11px] leading-tight text-gray-400">no patient number</div>}
        </div>
      </div>
    </td>
  );
}

/** The avatar tints, deliberately distinct from the STATUS palette so the two are never confused. */
const AVATAR_TONES = [
  "bg-violet-100 text-violet-700", "bg-emerald-100 text-emerald-700", "bg-sky-100 text-sky-700",
  "bg-orange-100 text-orange-700", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700", "bg-cyan-100 text-cyan-700",
];

/**
 * INITIALS IN A TINTED DISC -- the reference design's most visible element, and the one this workspace
 * shipped without because the comp lives in the spec as an IMAGE and the text extraction dropped it.
 *
 * ⚠ THE TINT IS DECORATION AND CARRIES NO MEANING WHATSOEVER. It is not sex, not status, not risk, not
 * location. It exists so a row can be re-found by shape while scrolling. The hue comes from a hash of
 * the patient id, so it is stable for that person for the life of the record -- an index-based colour
 * would repaint every avatar the moment one row was inserted above.
 *
 * ⚠ AND IT IS NOT A PHOTOGRAPH. Practice stores no patient images (recorded in the Patients refusals),
 * so initials are the whole of what can honestly be drawn here.
 */
export function Avatar({ name, seed }: { name: string; seed: string }) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "").join("") || "?";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h * 31) + seed.charCodeAt(i)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    // aria-hidden: the name is right beside it, so a screen reader announcing "AM" first is noise.
    <span aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${tone}`}>
      {initials}
    </span>
  );
}

/**
 * s9 + s17: the word is the status; the colour reinforces it and is never the only carrier.
 *
 * ⚠ AN UNKNOWN STATUS FALLS THROUGH TO GREY AND STILL PRINTS ITS OWN NAME. Swatch maps in this codebase
 * have three times been keyed on a vocabulary the engine does not emit -- every chip then renders grey
 * while compiling perfectly -- so the fallback must stay legible rather than blank.
 */
export function StatusBadge({ status, kind }: { status: string; kind: "appointment" | "encounter" }) {
  const swatch = (kind === "appointment" ? APPOINTMENT_STATUS_SWATCH : ENCOUNTER_STATUS_SWATCH)[status]
    ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${swatch}`}>
      {/* The reference design's leading dot. Decoration only -- currentColor, so it can never disagree
          with the word beside it, and the word is what carries the meaning (s17). */}
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      {titleCase(status)}
    </span>
  );
}

/**
 * "scheduled_followup" -> "Scheduled follow-up", as the reference design writes it.
 *
 * ⚠ THE HYPHENATIONS ARE A LOOKUP, NOT A RULE. There is no general way to know that "followup" takes a
 * hyphen and "walkin" does not, so guessing would produce "Walk-in" and "Teleconsult-ation" alike. An
 * unlisted value falls through to sentence case with underscores opened out, which is always readable --
 * a vocabulary this map has not caught up with must never render blank or raw.
 */
const WORD_FORMS: Record<string, string> = {
  followup: "follow-up", walkin: "walk-in", "no": "no", show: "show",
};
export function titleCase(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const opened = s.toLowerCase().replace(/_/g, " ").trim();
  const words = opened.split(/\s+/).map(w => WORD_FORMS[w] ?? w);
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * The register's sex, as the single glyph the reference design puts beside the patient number.
 *
 * ⚠ ONLY WHAT WAS RECORDED. "unknown", "unspecified", "other" and an absent value each get NO glyph --
 * a symbol implies somebody wrote it down. The title attribute spells the value out, because a lone
 * glyph is not an accessible label (s17: meaning never rests on a visual alone).
 */
export function SexGlyph({ sex }: { sex: string | null }) {
  const s = (sex ?? "").toLowerCase();
  const glyph = s === "female" ? "♀" : s === "male" ? "♂" : null;
  if (!glyph) return null;
  return <span title={s} className="ml-1 text-[11px] text-rose-400">{glyph}</span>;
}

/** s8's date-group header: the count as a tinted pill, as the reference design draws it. */
export function DayCountPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[var(--cp-primary)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--cp-primary-deep)]">
      {children}
    </span>
  );
}

/** A row of a patient table, already formatted on the server. */
export type PatientTableRow = {
  id: string;
  patientId: string | null;
  patientName: string;
  patientNumber: string | null;
  /** The instant, in ISO. Used ONLY to group; every visible string is pre-formatted. */
  at: string;
  /** "09:00" in the practice timezone. */
  time: string;
  kind: string;
  status: string;
  locationId: string | null;
  locationName: string | null;
  /** Migration 290's per-clinic colour choice. Null means "let the stable hash decide". */
  locationSlot: string | null;
  sex: string | null;
};

/** One calendar day of rows, with the label its header shows. */
export type DayGroup = {
  /** "2026-09-04" in the practice zone -- the grouping key, never displayed. */
  day: string;
  /** s8: "Fri, 04 Sep 2026". Written month, because 04-09 and 09-04 are the same glyphs reordered. */
  label: string;
  rows: PatientTableRow[];
};

/**
 * s8: GROUP MULTI-DAY RESULTS BY CALENDAR DATE, in the PRACTICE's zone.
 *
 * ⚠ THE ZONE IS THE WHOLE DIFFICULTY. Grouping on the ISO string's own date would put a 22:00 Kampala
 * appointment under the following day, because it is 19:00 UTC of the day before. Every boundary on this
 * workspace is a practice-local one (s13), so the key is derived through the formatter rather than by
 * slicing the timestamp.
 */
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function groupByDay(rows: PatientTableRow[], timezone: string): DayGroup[] {
  const keyOf = (iso: string) => {
    try {
      // en-CA yields YYYY-MM-DD, which sorts correctly as a string.
      return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(iso));
    } catch { return iso.slice(0, 10); }
  };
  // ⚠ THE MONTH IS OURS, NOT Intl's. `month: "short"` under en-GB returns "Sept" for September and three
  // letters for every other month, so a grouped list reads "Thu, 13 Aug 2026" above "Fri, 04 Sept 2026"
  // and the columns do not line up. s8's own example is "Fri, 04 Sep 2026". Only the weekday comes from
  // the formatter, because that is the part which genuinely needs the timezone applied.
  const labelOf = (iso: string) => {
    try {
      const d = new Date(iso);
      const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(d);
      // en-CA gives YYYY-MM-DD in the practice zone, which is where the day and month must come from --
      // taking them from the ISO string would be the same off-by-one-day bug the grouping key avoids.
      const [y, m, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d).split("-");
      return `${weekday}, ${dd} ${MONTHS_SHORT[Number(m) - 1] ?? m} ${y}`;
    } catch { return iso.slice(0, 10); }
  };

  const groups: DayGroup[] = [];
  for (const r of rows) {
    const day = keyOf(r.at);
    const last = groups[groups.length - 1];
    // Rows arrive ordered, so a run-length pass is enough and preserves the caller's sort direction.
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, label: labelOf(r.at), rows: [r] });
  }
  return groups;
}

/** s8: "Fri, 04 Sep 2026 · 4 appointments". The count is of THIS day, not the whole result. */
export function dayGroupCaption(g: DayGroup, noun: string, pluralNoun?: string): string {
  const n = g.rows.length;
  return `${g.label} · ${n} ${n === 1 ? noun : pluralNoun ?? `${noun}s`}`;
}
