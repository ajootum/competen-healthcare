/* eslint-disable @typescript-eslint/no-explicit-any */
import { LEGACY_CODES, type ActivityType, type LcpdConfig } from "../lcpd-config";

// Professional side of the Learning and CPD configuration (LCPD-01): whether migration 490 is on this environment, and so
// which activity types a person may record. Here, not in ../lcpd-config.ts, because only Professional code reads the
// individual_professional_* tables (individual-professional-harness R1).

/**
 * Server gate: migration 490 is on this environment. Until it is, the 373 rules stand (the nine types, hours required,
 * whole points), because the schema would refuse anything else. Probed with a zero-row read of 490's own table.
 */
export async function lcpdSchemaReady(admin: any): Promise<boolean> {
  try { const { error } = await admin.from("individual_professional_cpd_setting").select("user_id").limit(0); return !error; } catch { return false; }
}

/** Pure: the activity types a person may record now. Without 490, only the nine the 373 schema accepts. */
export const recordableTypes = (cfg: LcpdConfig, ready: boolean): ActivityType[] => (ready ? cfg.activityTypes : cfg.activityTypes.filter(t => LEGACY_CODES.has(t.code)));
