/* eslint-disable @typescript-eslint/no-explicit-any */

// The link from Competen Individual to LifeOS: a plain address, with nothing imported from LifeOS (ADR-018).
//
// Shown only when the owner sets practice_platform_flags.flag = 'individual_lifeos_entry'. An absent row, a failed read
// or a missing client all mean no link. It has the same posture as individualAppEnabled, and never throws.

export const INDIVIDUAL_LIFEOS_ENTRY_FLAG = "individual_lifeos_entry";

export async function lifeosEntryEnabled(admin: any | null): Promise<boolean> {
  if (!admin) return false;
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_LIFEOS_ENTRY_FLAG).maybeSingle();
    if (error) return false;
    return data?.enabled === true;
  } catch {
    return false;
  }
}
