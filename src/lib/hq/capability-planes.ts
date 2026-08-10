// The compensating control migration 282 promises.
//
// ⚠ WHY THIS FILE EXISTS. hq_mission_widget.required_capability used to carry a foreign key to
// hq_capability. That key could only ever hold for ONE of the three access planes this product has, so a
// widget in the practice or estate plane was literally unwritable -- proved by a probe that got
// `violates foreign key constraint "hq_mission_widget_required_capability_fkey"` for a practice code.
// Postgres cannot express a conditional foreign key, so migration 282 dropped it and the check moved here.
//
// ⚠ AND THE THREE PLANES DO NOT SHARE A VOCABULARY, WHICH IS EASY TO MISS. HQ codes are `hq.*` and live in
// a code catalogue. PRACTICE codes are BARE -- `appointment.manage`, `encounter.create`, not
// `practice.appointment.manage` -- and have no single code-side catalogue at all: they are string literals
// spread across the practice modules. Estate authority is a ROLE, not a capability. Pretending otherwise
// would mean inventing a catalogue here that nothing else reads, which is how a validator starts approving
// codes the product does not honour.
//
// So each plane is resolved from the most authoritative source that actually exists, and the harness says
// which. A plane whose vocabulary cannot be read yields NULL, never an empty set -- an empty set would make
// every assertion over it pass.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { HQ_CAPABILITY_CODES } from "./spaces";
import { ROLE_PRIORITY } from "@/lib/roles";

export const CAPABILITY_PLANES = ["hq", "practice", "estate"] as const;
export type CapabilityPlane = (typeof CAPABILITY_PLANES)[number];

export type PlaneVocabulary = {
  plane: CapabilityPlane;
  /** null means the vocabulary could not be established -- NOT that it is empty. */
  codes: string[] | null;
  source: string;
};

/**
 * The codes a plane recognises.
 *
 * ⚠ PRACTICE IS DERIVED FROM LIVE DATA, AND THAT IS A WEAKER GUARANTEE THAN THE HQ ONE. It reads the
 * distinct capability_code values actually granted in practice_role_assignment (52 when measured). That
 * catches a typo and a plane mix-up, which is what this control is for. It would NOT catch a real
 * capability that no membership happens to grant yet, and calling it a catalogue would overstate it.
 */
export async function planeVocabulary(admin: any, plane: CapabilityPlane): Promise<PlaneVocabulary> {
  if (plane === "hq")
    return { plane, codes: [...HQ_CAPABILITY_CODES], source: "HQ_CAPABILITIES in src/lib/hq/spaces.ts" };

  if (plane === "estate")
    return { plane, codes: [...ROLE_PRIORITY], source: "ROLE_PRIORITY in src/lib/roles.ts (the estate plane is roles, not capabilities)" };

  try {
    const { data, error } = await admin
      .from("practice_role_assignment").select("capability_code").limit(2000);
    if (error || !data) return { plane, codes: null, source: "practice_role_assignment (unreadable)" };
    const codes = [...new Set((data as any[]).map(r => r.capability_code).filter(Boolean))].sort();
    // ⚠ NO ROWS IS NOT A VOCABULARY. Returning [] here would make "every widget names a known code" pass
    // for any code at all, which is the vacuity trap this codebase keeps finding in its own harnesses.
    return codes.length
      ? { plane, codes, source: `practice_role_assignment (${codes.length} distinct codes granted live)` }
      : { plane, codes: null, source: "practice_role_assignment (no grants exist, so no vocabulary)" };
  } catch {
    return { plane, codes: null, source: "practice_role_assignment (read threw)" };
  }
}

export type PlaneCheck = { widget: string; plane: string; capability: string; problem: string };

/**
 * Validate every widget against its declared plane. Returns the problems, empty when all resolve.
 *
 * A widget whose plane has no readable vocabulary is REPORTED as unverifiable rather than silently passed:
 * "we could not check" and "we checked and it was fine" are different sentences.
 */
export async function checkWidgetPlanes(
  admin: any,
  widgets: { code: string; capability_plane: string | null; required_capability: string }[],
): Promise<PlaneCheck[]> {
  const cache = new Map<string, PlaneVocabulary>();
  const problems: PlaneCheck[] = [];

  for (const w of widgets) {
    const plane = (w.capability_plane ?? "hq") as CapabilityPlane;
    if (!CAPABILITY_PLANES.includes(plane)) {
      problems.push({ widget: w.code, plane: String(w.capability_plane), capability: w.required_capability, problem: "unknown plane" });
      continue;
    }
    if (!cache.has(plane)) cache.set(plane, await planeVocabulary(admin, plane));
    const vocab = cache.get(plane)!;
    if (vocab.codes === null) {
      problems.push({ widget: w.code, plane, capability: w.required_capability, problem: `plane vocabulary unreadable (${vocab.source})` });
      continue;
    }
    if (!vocab.codes.includes(w.required_capability))
      problems.push({ widget: w.code, plane, capability: w.required_capability, problem: `not a ${plane} capability` });
  }
  return problems;
}
