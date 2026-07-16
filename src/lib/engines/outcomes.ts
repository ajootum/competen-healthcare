import type { DecisionOutcome, Maturity } from "@/lib/ckcm";

// Pure decision logic (no server dependencies) — extracted from decisions.ts
// so it is unit-testable. Book I Ch.10 rules.

/** Benner maturity from a 0–6 score. */
export function maturityFromScore(score: number): Maturity {
  if (score <= 1) return "novice";
  if (score === 2) return "advanced_beginner";
  if (score <= 4) return "competent";
  if (score === 5) return "proficient";
  return "expert";
}

/**
 * Derive a governed competency outcome from a validated score.
 * Critical failure always blocks competency regardless of score.
 */
export function outcomeFor(
  score: number | null,
  isPassing: boolean,
  validated: boolean,
  criticalFailure: boolean,
): DecisionOutcome {
  if (criticalFailure) return "not_yet_competent";
  if (score == null) return "not_yet_competent";
  if (isPassing) return validated ? "competent" : "provisionally_competent";
  if (score >= 2) return "requires_remediation";
  return "not_yet_competent";
}
