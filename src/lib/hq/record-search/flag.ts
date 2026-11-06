/* eslint-disable @typescript-eslint/no-explicit-any */
// HQ-RECORD-SEARCH-01: the switch for searching HQ records from the palette.
//
// ⚠ ABSENT MEANS OFF, AND AN UNREADABLE FLAG MEANS OFF. The row `hq_record_search` in practice_platform_flags is not
// inserted by this change and there is no migration: nobody has turned this on until somebody writes the row. Same
// reader shape as ckriEnabled (src/lib/knowledge/governance.ts), failing closed on an error or a throw.
// It is enforced in every route AND read by the layout (so a palette is not offered a source that would answer 404).
// It is deliberately NOT in the flags route: this is not a launch switch an operator toggles from that screen.

export const HQ_RECORD_SEARCH_FLAG = "hq_record_search";

export async function hqRecordSearchEnabled(admin: any): Promise<boolean> {
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", HQ_RECORD_SEARCH_FLAG).maybeSingle();
    return !error && data?.enabled === true;
  } catch { return false; }
}
