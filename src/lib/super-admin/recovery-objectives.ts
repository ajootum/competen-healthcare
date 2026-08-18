/**
 * Competen's recovery objectives. Owner decision, 2026-08-19.
 *
 * ⚠ INITIAL SERVICE TARGETS, EXPLICITLY SUBJECT TO TIGHTENING as the product matures. They are a
 * starting commitment chosen so a rehearsal has something real to be measured against — not a ceiling
 * anyone is defending, and not a claim about what the platform currently achieves.
 *
 * ⚠ AND NOTHING HAS BEEN MEASURED AGAINST THEM YET. A restore has never been rehearsed
 * (docs/COMP-SEC-001-CONFORMANCE-001.md, "Disaster recovery testing: NOT SATISFIED"). Until one is,
 * these are objectives, not capabilities, and the distinction matters: backup conformance today is a
 * claim about Supabase's platform, not a demonstrated fact about this product's recoverability.
 *
 * WHY THEY EXIST AT ALL. Both rows above them in the conformance map — automated backups and
 * high availability — were PLATFORM-ATTESTED with nothing to test against. An objective is what turns
 * "Supabase takes backups" into a question with a pass or fail: can this product be back inside eight
 * hours having lost at most a day?
 *
 * Recorded in docs/adr/ADR-009-recovery-objectives.md. The rehearsal procedure that measures them is
 * docs/COMP-DR-001-rehearsal-runbook.md.
 */

/** Maximum acceptable PERMANENT data loss after a catastrophic failure: 24 hours. */
export const RPO_TARGET_MINUTES = 24 * 60;

/** Target time to restore the core service after a DECLARED disaster: 8 hours. */
export const RTO_TARGET_MINUTES = 8 * 60;

/** For prose — "24h" reads better than "1440m" in a heading. */
export function formatObjective(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}
