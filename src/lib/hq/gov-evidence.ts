// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-010 — THE THREE EVIDENCE GATES, written once so eleven screens cannot each soften one.
//
// THE PRECEDENCE RULE THIS FILE ENFORCES (owner ruling, 2026-08-18):
//
//     specification / governance rule  ->  available evidence  ->  visual comp
//
// The comp decides layout, hierarchy, interaction and visual intent. It does not decide data semantics,
// calculation methodology, safety rules or evidence requirements. Where the two conflict the
// specification wins, and the comp's illustrative numbers are not requirements to manufacture data.
//
// Four statements govern every function below, and they are the same four Product Health already holds:
//
//     Unknown        is not zero.
//     Not Tested     is not Effective.
//     No history     is not no change.
//     No methodology is not Moderate.
//
// ⚠ EACH GATE IS A TYPE, NOT A CONVENTION. The point is that a caller cannot render a reassuring state
// by forgetting something. `posture()` has no branch that returns a band without a methodology; there is
// nowhere to pass one in. An honesty rule a developer must remember is an honesty rule with a half-life.
//
// ⚠ AND EVERY GATE IS BUILT TO OPEN BY ITSELF. None of these functions tests a feature flag, a date or a
// hard-coded "not yet". Each asks whether the evidence it needs is present and answers from it. Publish
// a methodology and posture starts rendering; accumulate a second observation window and the trend
// starts rendering. Nothing has to be switched on, and — the half that actually bites — nobody has to
// remember to delete a placeholder that has quietly become a lie.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// ── 1. RISK POSTURE ─────────────────────────────────────────────────────────────────────────────────

/**
 * §4/§5's methodology, as much of it as a posture decision needs.
 *
 * ⚠ `bands` IS PART OF THE EVIDENCE, NOT DECORATION. A methodology with scales but no published bands
 * can score an individual risk and still cannot say what the estate's posture IS — the aggregate has
 * nothing to land in. Migration 320's publish guard refuses that combination at the database, and this
 * type refuses it again here, because a guard that exists in only one of the two places is a guard that
 * a future direct write walks past.
 */
export type RiskMethodology = {
  methodologyId: string;
  version: number;
  name: string;
  aggregationRule: string | null;
  publishedAt: string;
  effectiveFrom: string;
  bands: { code: string; label: string; definition: string; sortOrder: number }[];
};

export type PostureState =
  | {
      state: "determined";
      code: string;
      label: string;
      /** §3 requires posture to carry its DEFINITION, so a reader never has to ask what Moderate means. */
      definition: string;
      methodologyName: string;
      methodologyVersion: number;
      aggregationRule: string | null;
    }
  | {
      state: "not_determined";
      /** Rendered verbatim. One sentence, written once, identical on every surface that shows posture. */
      why: string;
      /** What would have to become true. Not a promise — a statement of the missing input. */
      needs: string;
    };

export const POSTURE_NOT_DETERMINED_LABEL = "Not Yet Determined";

/**
 * §3's overall risk posture.
 *
 * ⚠ THE COMP LEADS WITH "Moderate" AND THIS FUNCTION CANNOT RETURN IT TODAY, BY CONSTRUCTION.
 *
 * §4: "A risk score must never be a hidden arbitrary number." With no published methodology there is no
 * scale, no aggregation rule and no band — so "Moderate" would be a word a developer chose, wearing the
 * typography of a governed figure. That is worse than a blank: a blank invites the question, and a
 * confident word ends it.
 *
 * ⚠ NOTE WHAT IS NOT A PARAMETER. There is no `fallback`, no `default`, no `assumeModerate`. The only
 * way to get a band out of this function is to hand it a methodology that has one. When a methodology is
 * published the same call starts answering, with no code change anywhere.
 *
 * ⚠ AND IT REFUSES ON AN EMPTY REGISTER TOO, SEPARATELY. A published methodology over zero assessed
 * risks is not "Low" — nobody has looked. Two different absences, two different sentences, because
 * telling a Director "no methodology" when the real problem is "no assessments" sends them to fix the
 * wrong thing.
 */
export function posture(
  methodology: RiskMethodology | null,
  aggregate: { bandCode: string | null; assessedRisks: number },
): PostureState {
  if (!methodology) {
    return {
      state: "not_determined",
      why:
        "Risk posture cannot yet be determined because no approved, versioned risk scale and aggregation "
        + "methodology is active.",
      needs:
        "A published methodology with likelihood and impact scales, an explicit aggregation rule and at "
        + "least one posture band.",
    };
  }
  if (methodology.bands.length === 0) {
    return {
      state: "not_determined",
      why:
        `Methodology "${methodology.name}" v${methodology.version} is published but declares no posture `
        + "bands, so an aggregate score has nothing to resolve into.",
      needs: "At least one posture band on the active methodology.",
    };
  }
  if (aggregate.assessedRisks === 0) {
    return {
      state: "not_determined",
      why:
        "A methodology is active, but no risk has been assessed under it — so there is nothing to "
        + "aggregate. ⚠ That is not a low posture: it means nobody has looked yet.",
      needs: "At least one risk assessed under the active methodology.",
    };
  }
  const band = methodology.bands.find(b => b.code === aggregate.bandCode);
  if (!band) {
    return {
      state: "not_determined",
      why:
        "The aggregate score does not fall in any band the active methodology declares, so posture "
        + "cannot be stated without inventing a boundary.",
      needs: "Bands on the active methodology that cover the full score range.",
    };
  }
  return {
    state: "determined",
    code: band.code,
    label: band.label,
    definition: band.definition,
    methodologyName: methodology.name,
    methodologyVersion: methodology.version,
    aggregationRule: methodology.aggregationRule,
  };
}

// ── 2. CONTROL ASSURANCE ────────────────────────────────────────────────────────────────────────────

/**
 * §6's two effectiveness axes, which are two questions and not one.
 *
 * DESIGN effectiveness  — would this control work if it ran as described?
 * OPERATING effectiveness — did it actually run, and did it work?
 *
 * A control can be well designed and never executed. Averaging the two answers a question nobody asked.
 */
export type EffectivenessValue = "effective" | "partial" | "ineffective" | "not_assessed" | "not_tested";

export const DESIGN_EFFECTIVENESS: EffectivenessValue[] = ["effective", "partial", "ineffective", "not_assessed"];
export const OPERATING_EFFECTIVENESS: EffectivenessValue[] = ["effective", "partial", "ineffective", "not_tested"];

export const EFFECTIVENESS_LABEL: Record<EffectivenessValue, string> = {
  effective: "Effective",
  partial: "Partially effective",
  ineffective: "Ineffective",
  not_assessed: "Not assessed",
  not_tested: "Not tested",
};

export type ControlAssurance = {
  total: number;
  /** §22: assessed is a COUNT OF CONTROLS LOOKED AT, and it is the denominator that must be shown. */
  assessed: number;
  notAssessedDesign: number;
  notTested: number;
  design: { value: EffectivenessValue; label: string; n: number }[];
  operating: { value: EffectivenessValue; label: string; n: number }[];
  /**
   * ⚠ ALWAYS null TODAY, AND THE FIELD EXISTS TO SAY SO IN A TYPE.
   *
   * §22: "Control not tested → render Not Tested, never Effective." The owner's ruling adds the subtler
   * half: 85/132 = 64% must not be published as "Control Effectiveness" either, because it collapses
   * design and operating effectiveness into one number and buries the 10 untested inside a denominator.
   *
   * An aggregate percentage may exist only with a published calculation methodology that states how
   * untested and unknown controls are handled. Until that exists this stays null and the summary card
   * shows counts. The field is here so that adding the methodology is the only change required.
   */
  aggregateEffectivenessPct: null;
  aggregateRefusal: string;
};

/**
 * §6/§22's control assurance, counted and never collapsed.
 *
 * ⚠ THE SUMMARY CARD IS A COUNT AND ITS DENOMINATOR, ON THE OWNER'S INSTRUCTION: "Control Assurance,
 * 85 / 132 assessed, 10 Not Tested", with the distribution on drill-down. Not "87%" (which derives from
 * nothing) and not "64%" (which is honest arithmetic over a dishonest question).
 */
export function controlAssurance(
  controls: { designEffectiveness: EffectivenessValue; operatingEffectiveness: EffectivenessValue }[],
): ControlAssurance {
  const count = (vals: EffectivenessValue[], pick: (c: { designEffectiveness: EffectivenessValue; operatingEffectiveness: EffectivenessValue }) => EffectivenessValue) =>
    vals.map(v => ({ value: v, label: EFFECTIVENESS_LABEL[v], n: controls.filter(c => pick(c) === v).length }));

  const notAssessedDesign = controls.filter(c => c.designEffectiveness === "not_assessed").length;
  const notTested = controls.filter(c => c.operatingEffectiveness === "not_tested").length;

  return {
    total: controls.length,
    // ⚠ ASSESSED MEANS BOTH AXES ANSWERED. A control whose design was reviewed but which has never been
    // tested is not assessed — counting it as such is how the untested disappear.
    assessed: controls.filter(c => c.designEffectiveness !== "not_assessed" && c.operatingEffectiveness !== "not_tested").length,
    notAssessedDesign,
    notTested,
    design: count(DESIGN_EFFECTIVENESS, c => c.designEffectiveness),
    operating: count(OPERATING_EFFECTIVENESS, c => c.operatingEffectiveness),
    aggregateEffectivenessPct: null,
    aggregateRefusal:
      "A single control-effectiveness percentage is not shown. §6 keeps design and operating "
      + "effectiveness as separate judgements, and any aggregate would have to state how untested and "
      + "unknown controls are counted — no such calculation methodology is published, and one that hid "
      + "them would report assurance the estate does not have.",
  };
}

// ── 3. TREND ────────────────────────────────────────────────────────────────────────────────────────

export type Trend<T> =
  | { state: "available"; current: T; prior: T; delta: number; series: number[]; priorPeriod: string }
  | { state: "unavailable"; current: T; why: string };

export const TREND_UNAVAILABLE_LABEL = "Not Available";
export const TREND_UNAVAILABLE_NOTE = "Insufficient historical data";

/**
 * §3/§4's trend, trend-ready and evidence-gated.
 *
 * ⚠ THE COMP PUTS A SPARKLINE AND A "vs Apr 18 – May 17" DELTA ON ALL SIX CARDS, AND NEITHER CAN BE
 * DRAWN. There is no prior observation window: these stores were created on 2026-08-18.
 *
 * ⚠ A FLAT LINE IS NOT THE NEUTRAL RENDERING — IT IS A CLAIM. It says the measure was taken twice and
 * did not move. So is "0% change", and so is a sparkline drawn through one point repeated. Each of the
 * three is a fabricated observation wearing the styling of a real one, which is why this function has no
 * branch that produces any of them: the unavailable case carries `current` and nothing else, so a caller
 * has no series to plot even by accident.
 *
 * When a prior period exists the same call returns `available` with current, prior, delta and series,
 * and the component transitions on its own.
 */
export function trend<T>(input: {
  current: T;
  prior: T | null;
  series: number[];
  priorPeriod: string | null;
  /** Fewest observations before a series may be drawn. Two points is a line, not a trend. */
  minObservations?: number;
}): Trend<T> {
  const min = input.minObservations ?? 2;
  if (input.prior === null || input.priorPeriod === null) {
    return {
      state: "unavailable",
      current: input.current,
      why: "No prior comparison period exists yet, so this figure cannot be shown as rising or falling.",
    };
  }
  if (input.series.length < min) {
    return {
      state: "unavailable",
      current: input.current,
      why:
        `Only ${input.series.length} observation${input.series.length === 1 ? "" : "s"} exist, and at `
        + `least ${min} are needed before a direction can be drawn.`,
    };
  }
  const a = Number(input.current), b = Number(input.prior);
  return {
    state: "available",
    current: input.current,
    prior: input.prior,
    delta: Number.isFinite(a) && Number.isFinite(b) ? a - b : 0,
    series: input.series,
    priorPeriod: input.priorPeriod,
  };
}
