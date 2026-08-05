import { PRACTICE_NAV, SIDEBAR_SECTIONS, type PracticeNavItem } from "@/lib/practice/navigation";
import { ACTIVITY_REFUSES } from "@/lib/practice/activity";
import { COMMAND_CENTRE_REFUSES } from "@/lib/practice/command-centre";
import { REFUSED_ON_CALENDAR } from "@/lib/practice/calendar";
import { HOSPITAL_BOOKING_REFUSES } from "@/lib/practice/hospital-booking";
import { REFUSED as ASSISTANT_REFUSES } from "@/lib/practice/ai-assistant";
import { NOT_AVAILABLE as INTELLIGENCE_NOT_AVAILABLE } from "@/lib/practice/intelligence";

// THE PRACTICE HANDBOOK -- the user-facing documentation section.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ IT IS DERIVED FROM THE PRODUCT, NOT WRITTEN ABOUT IT. Every line below is read out of the same
// constants the application itself uses: the navigation catalogue decides what sections exist, and each
// engine's own REFUSES list decides what the documentation says the product will not do.
//
// The alternative -- a folder of prose -- is a second description of the software, and a second
// description is one that starts drifting the day after it is written. Documentation that disagrees with
// the product is worse than none, because somebody trusts it. This cannot disagree: change what a module
// refuses and the handbook page changes with it, or the harness fails.
//
// ── WHY THE REFUSALS ARE THE MOST USEFUL PART ───────────────────────────────────────────────────────
//
// Seven engines already declare, in code, the claims they will not make: no bed availability, no
// confidence score, no allergy list on the calendar, no AI-written briefing, no cross-practice baseline.
// Those declarations were written for developers and are exactly what a practitioner most needs, because
// they answer the question a manual never does -- not "what can this do" but "what will it never tell
// me, and what must I therefore keep doing myself".
//
// A clinician deciding whether to trust a screen at 08:00 is better served by one honest limit than by
// three paragraphs of features.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Both shapes the engines use for a refusal, normalised. */
export type Limit = { key: string; label: string; detail: string };

/**
 * THREE SHAPES, BECAUSE SEVEN ENGINES GREW THEM SEPARATELY. Some declare plain sentences, some
 * `{key,label,detail}` and some `{key,label,reason}`. Normalised here rather than made uniform at the
 * source: those constants are read by their own screens too, and rewriting five files to tidy a shape
 * would be a large diff whose only beneficiary is this one.
 */
type LooseRefusal = string | { key?: string; label?: string; detail?: string; reason?: string };

const normalise = (source: string, xs: readonly unknown[]): Limit[] =>
  (xs as readonly LooseRefusal[]).map((x, i) => typeof x === "string"
    // The plain-sentence form. The first clause is the claim, the rest is the reason -- split on the
    // first full stop so the page can lead with the limit rather than the explanation.
    ? { key: `${source}-${i}`, label: x.split(/\.\s|\s--\s/)[0].trim(), detail: x }
    : { key: x.key ?? `${source}-${i}`, label: x.label ?? "", detail: x.detail ?? x.reason ?? "" });

export type HandbookSection = {
  /** The nav href, so a page can link straight to the thing being described. */
  href: string;
  title: string;
  /** What it is for, in one sentence. */
  purpose: string;
  /** The capability it needs, or null when everyone has it. Named, because "why can I not see this" is
   *  the second most common question about any workspace. */
  capability: string | null;
  /** The modules reached from inside it. */
  contains: { href: string; title: string }[];
  /** What this part of the product will NOT claim. */
  limits: Limit[];
};

/**
 * One sentence per section, and the only prose in this file.
 *
 * ⚠ KEYED BY HREF SO A MISSING ONE IS DETECTABLE. A section with no purpose sentence is a section the
 * handbook cannot describe, and the harness fails rather than rendering a heading over nothing -- which
 * is how documentation quietly stops covering half a product.
 */
const PURPOSE: Record<string, string> = {
  "/practice/home":
    "Where a clinic morning starts. It shows what you are doing right now, who is waiting, and what is "
    + "owed to people outside the room. Every figure on it is the length of a list you can open.",
  "/practice/today":
    "The session you are in: what is running, what is next, and the day's events in the order they "
    + "happened. Starting a session here is what makes the rest of the product scope itself to your clinic.",
  "/practice/calendar":
    "The diary. What is booked, when, and where -- across every hospital and clinic you work at.",
  "/practice/patients":
    "The people you look after, and the longitudinal record you hold for each of them. One patient may "
    + "carry several hospital identifiers; this is where they are one person.",
  "/practice/encounters":
    "The consultations themselves. An encounter is the unit of work in this product: booked, walk-in, "
    + "emergency, inpatient or virtual, all recorded the same way.",
  "/practice/documents":
    "Letters, reports and everything that arrives from elsewhere -- results, referrals, discharge "
    + "summaries -- with the review state of each.",
  "/practice/follow-ups":
    "What you committed to, and whether it has happened. Overdue is worked out against your practice's "
    + "own clock, not the server's.",
  "/practice/assistant":
    "Drafting and recall help over your own records. It is an assistant, not a source of truth, and the "
    + "limits below are the ones that matter.",
  "/practice/intelligence":
    "A read-only view of your own practice over time. It changes no record: it counts, groups and "
    + "compares what the operational sections have already written.",
  "/practice/setup":
    "How your practice is configured -- locations, availability, booking rules, team and your own "
    + "personal settings.",
  "/practice/documentation":
    "This handbook. It is generated from the product itself rather than written alongside it, so it "
    + "cannot describe a version of the software that no longer exists.",
};

/** Which engine's declared limits belong to which section. */
const LIMITS: Record<string, Limit[]> = {
  "/practice/home": normalise("command-centre", COMMAND_CENTRE_REFUSES),
  "/practice/today": normalise("activity", ACTIVITY_REFUSES),
  "/practice/calendar": [
    ...normalise("calendar", REFUSED_ON_CALENDAR),
    ...normalise("hospital", HOSPITAL_BOOKING_REFUSES),
  ],
  "/practice/assistant": normalise("assistant", ASSISTANT_REFUSES),
  "/practice/intelligence": normalise("intelligence", INTELLIGENCE_NOT_AVAILABLE),
};

export type Handbook = {
  generatedAt: string;
  sections: { label: string; entries: HandbookSection[] }[];
  /** Every limit in the product, flattened -- the page a sceptical practitioner actually wants. */
  allLimits: Limit[];
  /** Sections the caller cannot open. Documented anyway, and marked, because "what am I missing" is a
   *  fair question and hiding the answer is how a locum concludes the product is broken. */
  hiddenFromYou: string[];
};

/**
 * Build the handbook for a caller.
 *
 * A PURE FUNCTION OVER CONSTANTS. No query, no database, nothing to fail -- which is deliberate: help
 * should be the one screen that still works when everything else is unreadable.
 */
export function practiceHandbook(capabilities: string[], at: Date = new Date()): Handbook {
  const visible = (i: PracticeNavItem) => i.capability === null || capabilities.includes(i.capability);

  const describe = (i: PracticeNavItem): HandbookSection => ({
    href: i.href,
    title: i.label,
    purpose: PURPOSE[i.href] ?? "",
    capability: i.capability,
    contains: PRACTICE_NAV.filter(c => c.parent === i.href && c.built)
      .map(c => ({ href: c.href, title: c.label })),
    limits: LIMITS[i.href] ?? [],
  });

  const sections = SIDEBAR_SECTIONS.map(sec => ({
    label: sec.label,
    entries: PRACTICE_NAV.filter(i => i.primary && i.built && sec.hrefs.includes(i.href)).map(describe),
  })).filter(s => s.entries.length > 0);

  const seen = new Set<string>();
  const allLimits: Limit[] = [];
  for (const l of Object.values(LIMITS).flat()) {
    if (seen.has(l.key)) continue;
    seen.add(l.key);
    allLimits.push(l);
  }

  return {
    generatedAt: at.toISOString(),
    sections,
    allLimits,
    hiddenFromYou: PRACTICE_NAV.filter(i => i.primary && i.built && !visible(i)).map(i => i.label),
  };
}

/** Every primary section the handbook must describe. Exported so the harness checks coverage against the
 *  navigation itself rather than against a list somebody remembered to update. */
export const DOCUMENTED_HREFS = Object.keys(PURPOSE);
