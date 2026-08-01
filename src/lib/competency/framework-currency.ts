// Framework currency at read time (XWI P2-10b).
//
// THE GAP. A competency decision is made against a framework AS IT WAS on the day. The framework then moves
// on -- a new version publishes, or it is retired. Nothing downstream noticed: the passport, the readiness
// board and the verify page all showed a decision from framework v1.0.0 exactly as they show one from the
// current v2.0.0, with no way to tell them apart.
//
// WHY THIS IS NOT A FILTER. The obvious fix is to hide decisions whose framework is no longer published.
// That is worse. A passport that quietly drops a competency because the framework was retired is as
// misleading as one that shows it as current -- the clinician WAS assessed, the assessment DID happen, and
// (since migration 182) that record is immutable. Making it vanish rewrites history in the other direction.
// So this labels rather than filters. Nothing disappears; the reader is told what they are looking at.
//
// THE STATE THAT MATTERS MOST IS `unstamped`. Decisions written before migration 179 carry no
// framework_version at all -- 77 of them today. The tempting default is to treat a missing stamp as
// current, because it makes the passport look clean. That is a claim the data does not support: "we did not
// record which version this was assessed against" is a different fact from "this is current", and only one
// of them is true. Unstamped is its own state and never reports as current.

export type CurrencyState = "current" | "superseded" | "retired" | "unstamped" | "unknown_framework";

export type FrameworkCurrency = {
  id: string;
  name: string | null;
  version: string;          // semver assembled from version_major/minor/revision
  pubStatus: string | null;
  isActive: boolean;
};

export type CurrencyVerdict = {
  state: CurrencyState;
  /** short chip text, safe to render as-is */
  label: string;
  /** one sentence a clinician or auditor can act on */
  detail: string;
  /** true when the reader should not treat this as evidence of CURRENT competence */
  caveat: boolean;
  assessedVersion: string | null;
  currentVersion: string | null;
};

// Absent parts read as 0 rather than being skipped: "1.0.0" is a claim, "1..0" is a bug. Matches the
// producer in src/lib/engines/decisions.ts, deliberately -- two different assemblies of the same semver
// would compare unequal and every decision would report superseded.
export const semver = (f: { version_major?: number | null; version_minor?: number | null; version_revision?: number | null }) =>
  `${f.version_major ?? 0}.${f.version_minor ?? 0}.${f.version_revision ?? 0}`;

export const FRAMEWORK_CURRENCY_COLUMNS = "id, name, pub_status, is_active, version_major, version_minor, version_revision";

/** Load the CURRENT state of the given frameworks. Returns an empty map on error rather than throwing:
 *  a passport must still render if this lookup fails -- but see `assessCurrency`, where a framework that is
 *  missing from the map reports `unknown_framework`, NOT `current`. A failed lookup must not manufacture
 *  reassurance. */
export async function loadFrameworkCurrency(
  // Supabase's builder is thenable but not a Promise, so a structural type for it does not typecheck.
  // `any` here matches the house pattern for admin clients across src/lib/competency/.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  frameworkIds: (string | null | undefined)[],
): Promise<Map<string, FrameworkCurrency>> {
  const ids = [...new Set(frameworkIds.filter(Boolean))] as string[];
  const out = new Map<string, FrameworkCurrency>();
  if (!ids.length) return out;
  const res = await admin.from("frameworks").select(FRAMEWORK_CURRENCY_COLUMNS).in("id", ids);
  if (res.error) return out;
  for (const f of (res.data ?? []) as Record<string, unknown>[]) {
    out.set(f.id as string, {
      id: f.id as string,
      name: (f.name as string) ?? null,
      version: semver(f as { version_major?: number | null }),
      pubStatus: (f.pub_status as string) ?? null,
      isActive: f.is_active !== false,
    });
  }
  return out;
}

/** Judge one decision against its framework's current state. */
export function assessCurrency(
  decision: { framework_id?: string | null; framework_version?: string | null },
  frameworks: Map<string, FrameworkCurrency>,
): CurrencyVerdict {
  const fw = decision.framework_id ? frameworks.get(decision.framework_id) : undefined;
  const stamped = decision.framework_version ?? null;

  if (!fw) {
    return {
      state: "unknown_framework", label: "Framework not found",
      detail: "The framework this was assessed against could not be resolved, so its currency cannot be checked.",
      caveat: true, assessedVersion: stamped, currentVersion: null,
    };
  }

  // Retired outranks version drift: if the framework is no longer published, which version it was assessed
  // against stops being the interesting question.
  if (fw.pubStatus !== "published" || !fw.isActive) {
    return {
      state: "retired", label: "Framework withdrawn",
      detail: `Assessed against ${fw.name ?? "this framework"}, which is no longer published. The assessment stands as a record; it is not evidence against a current standard.`,
      caveat: true, assessedVersion: stamped, currentVersion: fw.version,
    };
  }

  if (!stamped) {
    return {
      state: "unstamped", label: "Version not recorded",
      detail: `This decision predates version stamping, so it cannot be shown to match the current ${fw.version}. It is not evidence that it does not, either.`,
      caveat: true, assessedVersion: null, currentVersion: fw.version,
    };
  }

  if (stamped !== fw.version) {
    return {
      state: "superseded", label: `v${stamped} -> v${fw.version}`,
      detail: `Assessed against version ${stamped}; the framework is now at ${fw.version}. Whether that difference matters is a governance judgement, not an automatic one.`,
      caveat: true, assessedVersion: stamped, currentVersion: fw.version,
    };
  }

  return {
    state: "current", label: `v${fw.version}`,
    detail: `Assessed against the current version of ${fw.name ?? "this framework"}.`,
    caveat: false, assessedVersion: stamped, currentVersion: fw.version,
  };
}

/** Roll a set of verdicts into the counts a header or banner needs. */
export function summariseCurrency(verdicts: CurrencyVerdict[]) {
  const by = (s: CurrencyState) => verdicts.filter(v => v.state === s).length;
  return {
    total: verdicts.length,
    current: by("current"),
    superseded: by("superseded"),
    retired: by("retired"),
    unstamped: by("unstamped"),
    unknown: by("unknown_framework"),
    // Anything the reader should not take as proof of current competence.
    caveated: verdicts.filter(v => v.caveat).length,
  };
}
