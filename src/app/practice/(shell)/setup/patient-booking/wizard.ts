// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-HFE-002 s14 -- THE FIRST-TIME SETUP WIZARD, AS ARITHMETIC OVER THE READINESS ENGINE.
//
// The wizard stores nothing and decides nothing. Every stage's completion is READ from the same
// readiness checks that refuse a real publish, so the stepper can never disagree with the engine --
// and "persist drafts without making the page live" is already how the product works (page settings
// save unpublished, rules save as drafts), so resume-at-first-incomplete needs no wizard state at
// all: the data IS the state.
//
// ⚠ THE WIZARD ENDS AT FIRST PUBLICATION AND NEVER COMES BACK (s14: "after first publication,
// convert wizard into tabbed management"). published, published_with_warnings and paused are all
// after-first-publication states -- a paused page has been live, and its owner has graduated.
//
// ⚠ A CHECK THAT COULD NOT BE PERFORMED IS NOT A CHECK THAT PASSED. A stage whose evidence is
// unreadable is marked couldNotCheck and still counts as incomplete -- the stepper resumes AT it and
// says why, rather than ticking it or silently skipping it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type WizardCheck = { code: string; state: string };

export type WizardStage = {
  n: 1 | 2 | 3 | 4 | 5;
  title: string;
  /** The tab that owns this stage's work. */
  tab: "page" | "clinics" | "information" | "publish";
  state: "done" | "current" | "todo";
  /** True when the stage's evidence could not be read -- incomplete, with the reason being honesty. */
  couldNotCheck: boolean;
  detail: string;
};

export type WizardView = {
  /** False after first publication -- the tabs stand alone from then on. */
  show: boolean;
  stages: WizardStage[];
  continueTab: WizardStage["tab"] | null;
};

const AFTER_FIRST_PUBLICATION = ["published", "published_with_warnings", "paused"];

export function computeSetupWizard(args: {
  /** The page's publish state; null when no booking page row exists yet. */
  publishState: string | null;
  verdict: string;
  checks: WizardCheck[];
  /** Clinics whose governing rule offers times beyond internal; null when rules were unreadable. */
  onlineClinicCount: number | null;
}): WizardView {
  if (AFTER_FIRST_PUBLICATION.includes(args.publishState ?? "")) {
    return { show: false, stages: [], continueTab: null };
  }

  const of = (code: string): string =>
    args.checks.find(c => c.code === code)?.state ?? "not_checked";
  const group = (codes: string[]): { done: boolean; unknown: boolean } => {
    const states = codes.map(of);
    return {
      done: states.every(s => s === "pass"),
      // Unknown only when nothing outright failed -- a failure is actionable and outranks a gap.
      unknown: states.some(s => s === "not_checked") && !states.some(s => s === "fail"),
    };
  };

  const g1 = group(["HANDLE_CLAIMED", "ACCESS_MODE_SELECTED", "MODE_ADMITS_PATIENTS"]);
  const g2raw = group(["SESSION_BOOKABLE"]);
  const g2 = {
    done: g2raw.done && (args.onlineClinicCount ?? 0) > 0,
    unknown: g2raw.unknown || args.onlineClinicCount === null,
  };
  const g3 = group(["EFFECTIVE_BOOKING_CONSTRAINTS_SATISFIED", "RESERVED_WITHIN_CAPACITY", "RULE_CONFLICTS_RESOLVED"]);
  const g4 = group(["REGISTRATION_FIELDS_VALID", "INTAKE_BUILT"]);
  const g5 = {
    done: false, // while the wizard shows, the page has never been published.
    unknown: args.verdict === "cannot_say",
  };

  const defs: { n: WizardStage["n"]; title: string; tab: WizardStage["tab"]; g: { done: boolean; unknown: boolean }; doneDetail: string; todoDetail: string }[] = [
    {
      n: 1, title: "Booking page", tab: "page", g: g1,
      doneDetail: "Your handle is claimed and the page admits patients.",
      todoDetail: "Claim your handle and choose who can reach the page.",
    },
    {
      n: 2, title: "Clinics & availability", tab: "clinics", g: g2,
      doneDetail: `${args.onlineClinicCount ?? 0} clinic${(args.onlineClinicCount ?? 0) === 1 ? "" : "s"} accepting online bookings.`,
      todoDetail: "Turn on online booking for at least one clinic.",
    },
    {
      n: 3, title: "Booking behaviour", tab: "clinics", g: g3,
      doneDetail: "Booking limits are configured and nothing conflicts.",
      todoDetail: "Give your clinics their booking window and capacity, and resolve any conflict.",
    },
    {
      n: 4, title: "Patient information", tab: "information", g: g4,
      doneDetail: "What patients provide is configured.",
      todoDetail: "Choose what patients provide when they book.",
    },
    {
      n: 5, title: "Review & publish", tab: "publish", g: g5,
      doneDetail: "Published.",
      todoDetail: args.verdict === "ready" || args.verdict === "ready_with_warnings"
        ? "Everything checks out — publishing is the last step."
        : "Review what is left, then publish.",
    },
  ];

  let currentAssigned = false;
  const stages: WizardStage[] = defs.map(d => {
    const done = d.g.done && !d.g.unknown;
    let state: WizardStage["state"] = done ? "done" : "todo";
    if (!done && !currentAssigned) { state = "current"; currentAssigned = true; }
    return {
      n: d.n, title: d.title, tab: d.tab, state,
      couldNotCheck: !done && d.g.unknown,
      detail: done ? d.doneDetail
        : !done && d.g.unknown
          ? "Whether this is complete could not be read just now — that is not the same as it being done."
          : d.todoDetail,
    };
  });

  const current = stages.find(s => s.state === "current") ?? null;
  return { show: true, stages, continueTab: current?.tab ?? null };
}
