// COMPETEN-HQ-IA-02: which product launch switches are OFF, for the HQ sidebar's status badges.
//
// ⚠ A STATUS, NEVER A GATE. The sidebar keeps every link it is allowed to draw; this only says "Off"
// beside the ones whose product is switched off, because those admin pages stay reachable so a product
// can be configured before anybody switches it on. Nothing here writes a flag, and nothing reads this
// to decide what a person may open.
//
// ⚠ THE FLAG NAMES ARE THE PRODUCTS' OWN CONSTANTS, imported rather than retyped (individual-foundation
// 12j holds the Individual flag's name to gate.ts alone), and the semantics are theirs: a flag is ON only
// when its row exists and is enabled. One query instead of six readers.
//
// ⚠ A FAILED READ RETURNS NULL, NOT "ALL OFF". The product readers fail closed to false because they
// guard behaviour; a label must not, or an unreadable table would print "Off" on every product.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { INDIVIDUAL_APP_FLAG } from "@/lib/individual/gate";
import { LEARNING_APP_FLAG, LEARNING_COMMERCE_FLAG } from "@/lib/learning/policy";
import { CASE_LIBRARY_FLAG } from "@/lib/cases/policy";
import { CKRI_FLAG } from "@/lib/knowledge/governance";
import { AI_FAIR_USE_FLAG } from "@/lib/ai/allowance";
import type { NavSwitch } from "@/app/super-admin/_components/nav-tables";

export const HQ_NAV_SWITCH_FLAGS: Record<NavSwitch, string> = {
  "individual": INDIVIDUAL_APP_FLAG,
  "learning": LEARNING_APP_FLAG,
  "learning-commerce": LEARNING_COMMERCE_FLAG,
  "case-library": CASE_LIBRARY_FLAG,
  "ckri": CKRI_FLAG,
  "ai-fair-use": AI_FAIR_USE_FLAG,
};

/** The switches that are off, or null when the flag table could not be read. */
export async function offNavSwitches(admin: any): Promise<NavSwitch[] | null> {
  try {
    const { data, error } = await admin.from("practice_platform_flags")
      .select("flag, enabled").in("flag", Object.values(HQ_NAV_SWITCH_FLAGS));
    if (error) return null;
    const on = new Set(((data ?? []) as { flag: string; enabled: boolean }[]).filter(r => r.enabled === true).map(r => r.flag));
    return (Object.keys(HQ_NAV_SWITCH_FLAGS) as NavSwitch[]).filter(k => !on.has(HQ_NAV_SWITCH_FLAGS[k]));
  } catch {
    return null;
  }
}
