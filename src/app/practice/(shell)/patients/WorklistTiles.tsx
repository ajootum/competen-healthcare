"use client";

import Link from "next/link";
import { Count } from "./Honesty";
import { UNSUPPLIED_REASON } from "./refusals";
import { CARE_CARD_SWATCH, CARE_CARD_UNSUPPLIED, WORKLIST_SWATCH } from "@/lib/practice/palette";
import type { Unavailable, WorklistsView, WorklistView } from "./types";

// CPR-PAT-002 s3 -- Today's Care and Continuing Care, the two card rows.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// NINE CARDS, SIX WORKLISTS, AND THE THREE THAT ARE MISSING SAY SO.
//
// The specification names five cards under Today's Care and four under Continuing Care. The engine
// answers six worklists. Six of the nine map onto one exactly; three do not exist behind the screen at
// all, and each of those keeps its slot in the row, loses its colour, and prints the query the engine
// would have to run. That is the whole reason this component is not simply a loop over lists.worklists:
// a row of six where the design has nine looks complete, and it is not.
//
// NO CARD ON THIS SCREEN COUNTS ANYTHING ITSELF. Every figure is a worklist's own count, and where a
// card has no worklist it has no figure. It would be easy to filter the rows a worklist hands over --
// the waiting list's rows carry "In consultation" in a note string, the follow-up rows carry their due
// date -- and every one of those derivations would be a count taken from a page of at most fifty rows
// and displayed as a total. A dash that means "the engine does not answer this" is worth more than a
// number that is right until the day a clinic is busy.
//
// A CARD THAT COULD NOT BE READ SHOWS AN EM DASH, NEVER A ZERO. "Nobody is waiting" and "I could not
// find out who is waiting" are different answers, and only one of them means you can go for lunch.
//
// ⚠ THE COLOUR DECISIONS LIVE IN palette.ts, NOT HERE, and the figure takes the card's colour. This has
// been written on this file before. The version this replaces drew grey cards with dark numbers; the
// user's words, for the third screen running, were "the colors are flat". A tinted badge beside a black
// number leaves the colour on the decoration -- the number is the thing being read.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** One card: either a worklist with a figure, or a named absence with a reason. */
type CareCard = {
  /** CARE_CARD_SWATCH's key, and the card's identity. */
  key: string;
  title: string;
  caption: string;
  /** The engine worklist this card IS, or null when the engine does not answer it. */
  worklist: WorklistView | null;
  /** A sentence that must travel with the figure, because the figure means something narrower than its title. */
  boundary: string | null;
};

/** The engine key each card is drawn from, so a card and its worklist cannot end up different colours. */
const FROM_WORKLIST: Record<string, string> = {
  waiting: "waiting",
  walkIns: "walkIns",
  overdueFollowUps: "dueFollowUps",
  resultsToReview: "pendingResults",
  recentlySeen: "recentPatients",
  newRegistrations: "newRegistrations",
};

function buildCards(lists: WorklistsView): { today: CareCard[]; continuing: CareCard[] } {
  const wl = (key: string): WorklistView | null => lists.worklists.find(w => w.key === key) ?? null;

  const today: CareCard[] = [
    {
      key: "waiting", title: "Waiting now", caption: "In the building",
      worklist: wl("waiting"),
      // THE TITLE IS NARROWER THAN THE FIGURE, so the figure has to admit it. The queue read covers
      // WAITING, READY, IN_CONSULTATION and PAUSED as one number.
      boundary: "Counts everyone in the queue — waiting, ready, paused AND already in consultation. The engine returns those four states as one figure, so the card beside this one cannot be subtracted from it.",
    },
    {
      key: "walkIns", title: "Walk-ins", caption: "Today, no booking",
      worklist: wl("walkIns"),
      boundary: null,
    },
    {
      key: "inConsultation", title: "In consultation", caption: "Not answered",
      worklist: null,
      boundary: null,
    },
    {
      key: "followUpsToday", title: "Follow-ups today", caption: "Not answered",
      worklist: null,
      boundary: null,
    },
    {
      key: "urgentReviews", title: "Urgent reviews", caption: "Not answered",
      worklist: null,
      boundary: null,
    },
  ];

  const continuing: CareCard[] = [
    {
      // ⚠ NOT TITLED "OVERDUE FOLLOW-UPS", WHICH IS WHAT THE SPEC CALLS IT. The engine's figure is
      // due_on <= today, so it contains today's as well as the late ones. Titling it "Overdue" would
      // overstate the backlog on the one card whose whole job is to be believed.
      key: "overdueFollowUps", title: "Follow-ups due & overdue", caption: "Open obligations",
      worklist: wl("dueFollowUps"),
      boundary: "Due today OR earlier, as one figure. The specification asks for the overdue ones alone; the engine does not separate them, so this is the larger number and it is labelled as the larger number.",
    },
    {
      key: "resultsToReview", title: "Results to review", caption: "Arrived, unreviewed",
      worklist: wl("pendingResults"),
      boundary: lists.pendingResultsBoundary,
    },
    {
      key: "recentlySeen", title: "Recently seen", caption: "Most recent consultations",
      worklist: wl("recentPatients"),
      boundary: "The most recently started consultations, up to the read limit. NOT a 30-day window — the comp's \"in last 30 days\" is not computed, because nothing here counts a period.",
    },
    {
      key: "newRegistrations", title: "New registrations", caption: "Registered today",
      worklist: wl("newRegistrations"),
      boundary: "Today only, in this practice's own calendar day. The comp's \"in last 7 days\" is a window the engine does not offer.",
    },
  ];

  return { today, continuing };
}

function CardShell({ card, variant, selected, onSelect }: {
  card: CareCard;
  variant: "today" | "continuing";
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const w = card.worklist;
  const unsupplied = w === null;
  const unreadable = !!w && w.unavailable;
  const s = CARE_CARD_SWATCH[card.key] ?? CARE_CARD_SWATCH.recentlySeen;
  // ⚠ THE ICON OF A LIST IS DEFINED ONCE, IN WORKLIST_SWATCH, and a card that IS a worklist takes it
  // from there rather than carrying a second copy. The other three cards have no worklist behind them,
  // so they fall through to their own glyph. This is the same discipline as the colours: two maps that
  // both describe one list is how two screens end up disagreeing about what that list looks like.
  const listIcon = FROM_WORKLIST[card.key] ? WORKLIST_SWATCH[FROM_WORKLIST[card.key]]?.icon : undefined;
  const icon = unsupplied ? "?" : (listIcon ?? s.icon);
  const dead = unsupplied || unreadable;
  const box = dead ? CARE_CARD_UNSUPPLIED.box : s.box;
  const badge = dead ? CARE_CARD_UNSUPPLIED.badge : s.badge;
  const figure = dead ? CARE_CARD_UNSUPPLIED.figure : s.figure;
  const caption = dead ? CARE_CARD_UNSUPPLIED.caption : s.caption;

  const active = !!w && selected === w.key;
  // Where a list already has a home that can DO something with it -- transition a follow-up, file a
  // letter -- the card offers that destination as well as filtering the register in place.
  const elsewhere = !!w && !w.href.startsWith("/practice/patients");

  const reason: Unavailable = w?.reason ?? null;

  // ⚠ SPANS, NOT DIVS AND PARAGRAPHS. This whole block is rendered INSIDE a <button> on every card that
  // opens a list, and a button may only contain phrasing content -- a <div> or a <p> in there is invalid
  // markup that the browser is free to reparse, which moves the element out of the button it was meant
  // to be part of.
  const body = (
    <>
      <span className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[17px] ${badge}`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-gray-700">{card.title}</span>
          {unsupplied ? (
            <span className={`block text-[30px] font-bold leading-none ${figure}`} title="Not answered by the engine">
              &mdash;
            </span>
          ) : (
            <Count
              count={w!.count}
              atLeast={w!.atLeast}
              reason={reason}
              className={`block text-[30px] font-bold leading-none ${figure}`}
            />
          )}
        </span>
        {variant === "today" && !dead && (
          <span aria-hidden className={`ml-1 shrink-0 self-center text-[18px] ${figure} opacity-50`}>
            &rsaquo;
          </span>
        )}
      </span>

      <span className={`mt-2 block text-[11px] font-medium ${caption}`}>
        {unreadable
          ? (reason === "capability" ? "Not shown to you" : "Could not be read")
          : active ? "Filtering the register" : card.caption}
      </span>
    </>
  );

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border p-4 transition ${
        variant === "continuing" ? "pl-5" : ""} ${box} ${
        active ? "ring-2 ring-[var(--cp-primary)]/50 shadow-sm" : dead ? "" : "hover:shadow-md hover:-translate-y-px"}`}
    >
      {/* The Continuing Care row carries a left accent bar. It is the one structural difference between
          the two rows in the comp, and it is what stops nine tinted cards reading as one nine-wide grid. */}
      {variant === "continuing" && (
        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${dead ? CARE_CARD_UNSUPPLIED.accent : s.accent}`} />
      )}

      {w && !w.unavailable ? (
        <button
          type="button"
          onClick={() => onSelect(active ? null : w.key)}
          aria-pressed={active}
          className="block w-full text-left"
        >
          {body}
        </button>
      ) : (
        <div className="w-full">{body}</div>
      )}

      {unreadable && w.error && (
        <p className="mt-1 font-mono text-[10px] leading-tight text-[var(--cmp-text-warning)]">{w.error}</p>
      )}

      {/* THE CARD PRINTS ITS OWN GAP. An unexplained dash is indistinguishable from a bug, and somebody
          extending the engine should not have to guess which query is missing. */}
      {unsupplied && UNSUPPLIED_REASON[card.key] && (
        <details className="group mt-1">
          <summary className="cursor-pointer list-none text-[10.5px] font-semibold text-slate-500 hover:text-slate-700">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
            Why this has no figure
          </summary>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{UNSUPPLIED_REASON[card.key]}</p>
        </details>
      )}

      {card.boundary && !unsupplied && !unreadable && (
        <details className="group mt-1">
          <summary className="cursor-pointer list-none text-[10.5px] font-semibold text-gray-500 hover:text-gray-700">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">&rsaquo;</span>
            What this figure counts
          </summary>
          <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">{card.boundary}</p>
        </details>
      )}

      {elsewhere && !unreadable && (
        <Link
          href={w!.href}
          className={`mt-1.5 text-[11px] font-semibold hover:underline ${figure}`}
        >
          View list &rarr;
        </Link>
      )}
    </div>
  );
}

function RowHeading({ title, blurb, right }: { title: string; blurb: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-gray-500">{title}</h2>
        <p className="mt-0.5 text-[13px] text-gray-500">{blurb}</p>
      </div>
      {right}
    </div>
  );
}

export default function WorklistTiles({ lists, selected, onSelect }: {
  lists: WorklistsView;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { today, continuing } = buildCards(lists);

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5">
        <RowHeading
          title="Today's care"
          blurb="What needs your attention today"
          right={
            <span className="flex items-center gap-3">
              {selected && (
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="text-[12px] font-semibold text-gray-500 hover:text-gray-800 hover:underline"
                >
                  Clear filter
                </button>
              )}
              <Link
                href="/practice/today"
                className="text-[12.5px] font-semibold text-[var(--cp-primary-deep)] hover:underline"
              >
                View current session &rarr;
              </Link>
            </span>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {today.map(c => (
            <CardShell key={c.key} card={c} variant="today" selected={selected} onSelect={onSelect} />
          ))}
        </div>
        <p className="text-[11px] text-gray-400">
          {lists.today} · {lists.timezone} — this practice&rsquo;s own day, not the server&rsquo;s.
        </p>
      </section>

      <section className="flex flex-col gap-2.5">
        <RowHeading title="Continuing care" blurb="Patients who need ongoing attention" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {continuing.map(c => (
            <CardShell key={c.key} card={c} variant="continuing" selected={selected} onSelect={onSelect} />
          ))}
        </div>
      </section>

      {lists.blindSpots.length > 0 && (
        <p className="rounded-xl bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">
            {lists.blindSpots.length === 1 ? "One list" : `${lists.blindSpots.length} lists`} could not be answered:
          </span>{" "}
          {lists.blindSpots.map(b => `${b.title} (${b.reason === "capability" ? "not permitted" : b.error ?? "read failed"})`).join("; ")}.
          Treat those as unknown rather than empty.
        </p>
      )}
    </div>
  );
}
