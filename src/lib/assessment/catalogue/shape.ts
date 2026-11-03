/**
 * Assessment catalogue -- the shape of a registry row and the words around it. Pure: no I/O.
 *
 * STATUS IS THE LATEST VERSION'S STATE, nothing else. A registered instrument with no version yet is "No version yet",
 * which is a real state and not a blank. The catalogue never invents a status of its own.
 */

export const VERSION_STATES = ["draft", "in_review", "approved", "published", "retired"] as const;
export type VersionState = (typeof VERSION_STATES)[number];
export type StatusCode = VersionState | "none";

export const STATUS_LABEL: Record<StatusCode, string> = {
  none: "No version yet",
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
  retired: "Retired",
};

export type Tone = "muted" | "neutral" | "info" | "warn" | "good";
export const STATUS_TONE: Record<StatusCode, Tone> = {
  none: "muted",
  draft: "neutral",
  in_review: "warn",
  approved: "info",
  published: "good",
  retired: "muted",
};

export function deriveStatus(latestState: string | null | undefined): StatusCode {
  return (VERSION_STATES as readonly string[]).includes(latestState ?? "") ? (latestState as VersionState) : "none";
}

/** "v2", or an em dash when the instrument has no version. */
export const versionLabel = (versionNo: number | null | undefined) => (versionNo && versionNo > 0 ? `v${versionNo}` : "—");

/** Population and context joined for the second line of a row. */
export function subLine(population: readonly string[], setting: readonly string[]): string {
  return [population.join(", "), setting.join(", ")].filter(Boolean).join(" · ");
}

/** What the search function returns, one row of it. */
export type SearchRow = {
  id: string; code: string; name: string; description: string | null;
  family_code: string | null; family_label: string | null;
  primary_domain_label: string | null; method_labels: string[] | null; population_labels: string[] | null; setting_labels: string[] | null;
  latest_version_no: number | null; latest_state: string | null; published_version_no: number | null;
  owner: string | null; updated_at: string; published_at: string | null; total: number | string;
};

export type CatalogueRow = {
  id: string; code: string; name: string; description: string | null;
  familyCode: string | null; familyLabel: string | null;
  primaryDomain: string | null; methods: string[]; population: string[]; setting: string[];
  sub: string;
  versionNo: number | null; version: string; status: StatusCode; statusLabel: string;
  publishedVersionNo: number | null;
  owner: string; updatedAt: string; publishedAt: string | null;
};

export function shapeRow(r: SearchRow): CatalogueRow {
  const population = r.population_labels ?? [];
  const setting = r.setting_labels ?? [];
  const status = deriveStatus(r.latest_state);
  return {
    id: r.id, code: r.code, name: r.name, description: r.description,
    familyCode: r.family_code, familyLabel: r.family_label,
    primaryDomain: r.primary_domain_label, methods: r.method_labels ?? [], population, setting,
    sub: subLine(population, setting),
    versionNo: r.latest_version_no, version: versionLabel(r.latest_version_no),
    status, statusLabel: STATUS_LABEL[status],
    publishedVersionNo: r.published_version_no,
    owner: r.owner ?? "Competen Holdings", updatedAt: r.updated_at, publishedAt: r.published_at,
  };
}

/** The total comes back on every row (count over the filtered set). An empty page has no row to carry it. */
export function totalOf(rows: readonly SearchRow[]): number {
  return rows.length ? Number(rows[0].total) || 0 : 0;
}

/** "Showing 1 to 50 of 1,203". */
export function showingLabel(shown: number, total: number, offset: number): string {
  if (total === 0 || shown === 0) return "Showing 0 of 0";
  return `Showing ${(offset + 1).toLocaleString("en-GB")} to ${(offset + shown).toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}`;
}

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

// ---- availability words ----------------------------------------------------------------------------------------

export const AVAILABILITY_MODES = ["available", "optional", "unavailable"] as const;
export type AvailabilityMode = (typeof AVAILABILITY_MODES)[number];
export const MODE_LABEL: Record<AvailabilityMode | "none", string> = {
  available: "Available",
  optional: "Optional",
  unavailable: "Not available",
  none: "Not enabled",
};
/** Discovery needs available or optional. A published version is a separate condition. */
export const isEnabledMode = (mode: string | null | undefined) => mode === "available" || mode === "optional";

export const RELATION_LABEL: Record<string, string> = {
  related: "Related to",
  adapted_from: "Adapted from",
  supersedes: "Supersedes",
  companion: "Companion of",
};
export const RELATION_KINDS = ["related", "adapted_from", "supersedes", "companion"] as const;

export const DIMENSION_HELP: Record<string, string> = {
  method: "How the assessment is carried out",
  domain: "What subject it covers. A domain can have subdomains",
  population: "Who or what is assessed",
  setting: "Where it is used",
  level: "The qualification level it applies to",
  specialty: "The specialty it belongs to",
  profession: "The profession it is written for",
  purpose: "What it is used for",
  keyword: "Free search words",
};
