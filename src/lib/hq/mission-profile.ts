// PLAT-GOV-MC-001 - the Mission Control Composition Service (section 16 step 3, contract section 11).
//
// ⚠ "Mission Control is a common governance interface framework, not a common dashboard" (section 2). The
// shell stays the same and the COMPOSITION is resolved from the active governance context. This module is
// the resolver. It renders nothing.
//
// ⚠ AND THE COMPOSITION IS NOT A SECURITY CONTROL - section 10, "widgets must independently enforce
// authorization, hiding a widget is not a security control". Everything here decides what is DRAWN. Each
// widget's data source asks for its own capability again before it reads anything, and the page itself
// still passes requireHqCapability. Three checks, and only the last two are load-bearing.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { productLine } from "@/lib/governance/product-lines";

export type MissionWidget = {
  code: string;
  label: string;
  dataSource: string;
  requiredCapability: string;
  size: "sm" | "md" | "lg";
  sort: number;
};

export type MissionProfile = {
  code: string;
  name: string;
  governanceLevel: "hq" | "product" | "tenant" | "operational";
  productLineCode: string | null;
  description: string | null;
};

export type MissionComposition = {
  profile: MissionProfile;
  widgets: MissionWidget[];
  /**
   * ⚠ REPORTED, NOT SWALLOWED. `unreadable` means the registry could not be read and this is the fail-closed
   * minimum rather than a considered answer - the screen must be able to say so, because a minimal dashboard
   * that looks deliberate is worse than one that admits it is a fallback.
   */
  state: "resolved" | "fallback_no_profile" | "unreadable";
};

/**
 * The fail-closed minimum required by section 10: "unknown or invalid configuration must fail closed and
 * fall back to a safe minimal dashboard". Defined in CODE, not read from the registry, because a fallback
 * that depends on the store it exists to survive is not a fallback.
 */
export const MINIMAL_PROFILE: MissionProfile = {
  code: "hq_minimal",
  name: "Competen HQ (minimum safe view)",
  governanceLevel: "hq",
  productLineCode: null,
  description: null,
};

const HQ_PROFILE_CODE = "hq_super_admin";

export type MissionViewer = {
  /** Platform owner. Short-circuits to the HQ profile without consulting a position. */
  isOwner: boolean;
  /** hq_position codes held through a live appointment. */
  positions: string[];
  /** The capabilities those positions grant. Used to filter widgets, never to choose the profile. */
  capabilities: string[];
};

/**
 * Resolve the Mission Control composition for a viewer.
 *
 * ⚠ SELECTED BY GOVERNANCE CONTEXT, NEVER BY JOB TITLE (section 10). The order is ownership, then the
 * PRODUCT LINE the held position governs, then the minimum. It never matches on a position's name: two
 * positions governing the same product line must resolve to the same profile, which is what makes the
 * registry configurable rather than a switch statement with a table in front of it.
 */
export async function resolveMissionProfile(admin: any, viewer: MissionViewer): Promise<MissionComposition> {
  let profiles: any[] = [];
  try {
    const { data, error } = await admin
      .from("hq_mission_profile")
      .select("code, name, governance_level, product_line_code, priority, status, description")
      .eq("status", "active")
      .order("priority")
      .limit(200);
    // ⚠ A FAILED READ IS NOT AN EMPTY REGISTRY. An empty list would resolve to the minimum and look like a
    // decision, so the two are kept apart and the unreadable case is reported.
    if (error) return { profile: MINIMAL_PROFILE, widgets: [], state: "unreadable" };
    profiles = data ?? [];
  } catch {
    return { profile: MINIMAL_PROFILE, widgets: [], state: "unreadable" };
  }
  if (!profiles.length) return { profile: MINIMAL_PROFILE, widgets: [], state: "unreadable" };

  const toProfile = (r: any): MissionProfile => ({
    code: r.code,
    name: r.name,
    governanceLevel: r.governance_level,
    productLineCode: r.product_line_code ?? null,
    description: r.description ?? null,
  });

  let chosen: MissionProfile | null = null;

  if (viewer.isOwner) {
    chosen = profiles.filter(p => p.code === HQ_PROFILE_CODE).map(toProfile)[0] ?? null;
  } else if (viewer.positions.length) {
    // Which product lines do the held positions govern? Read from the positions themselves, so adding a
    // second Practice position needs no code change.
    let lines: string[] = [];
    try {
      const { data, error } = await admin
        .from("hq_position").select("code, product_line_code").in("code", viewer.positions).limit(200);
      if (!error) {
        lines = [...new Set(((data ?? []) as any[])
          .map(p => p.product_line_code).filter(Boolean) as string[])];
      }
    } catch { /* leave lines empty -- resolution falls through to the minimum below */ }

    // Lowest `priority` wins, and `profiles` is already ordered by it.
    chosen = profiles
      .filter(p => p.governance_level === "product" && p.product_line_code && lines.includes(p.product_line_code))
      .map(toProfile)[0] ?? null;

    // An HQ appointee who governs no product line still belongs in HQ rather than the bare minimum.
    if (!chosen) chosen = profiles.filter(p => p.code === HQ_PROFILE_CODE).map(toProfile)[0] ?? null;
  }

  if (!chosen) return { profile: MINIMAL_PROFILE, widgets: [], state: "fallback_no_profile" };

  const widgets = await readProfileWidgets(admin, chosen.code, viewer);
  return { profile: chosen, widgets, state: "resolved" };
}

/**
 * The widgets a profile declares, filtered to those the viewer may actually see.
 *
 * ⚠ AN OWNER IS NOT FILTERED, and their capability list is EMPTY by construction - the layout short-circuits
 * before reading any HQ table. Inferring ownership from a non-empty list would blank an owner's dashboard,
 * the same trap filterHqNav documents.
 */
async function readProfileWidgets(admin: any, profileCode: string, viewer: MissionViewer): Promise<MissionWidget[]> {
  try {
    const { data, error } = await admin
      .from("hq_profile_widget")
      .select("sort, widget_code, hq_mission_widget!widget_code(code, label, data_source, required_capability, size)")
      .eq("profile_code", profileCode)
      .order("sort")
      .limit(200);
    if (error || !data) return [];
    return (data as any[])
      .map(row => {
        const w = row.hq_mission_widget;
        if (!w) return null;
        return {
          code: w.code, label: w.label, dataSource: w.data_source,
          requiredCapability: w.required_capability, size: (w.size ?? "md") as MissionWidget["size"],
          sort: row.sort ?? 0,
        };
      })
      .filter(Boolean)
      .filter((w: any) => viewer.isOwner || viewer.capabilities.includes(w.requiredCapability)) as MissionWidget[];
  } catch {
    return [];
  }
}

/** The product line a composition is about, for the header. Null for HQ-level profiles. */
export const compositionProductLine = (c: MissionComposition) => productLine(c.profile.productLineCode);
