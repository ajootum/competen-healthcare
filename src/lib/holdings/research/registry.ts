// ── THE RESEARCH SOURCE REGISTRY ── COMPETEN-RESEARCH-01 ADDENDUM V2 (owner GO 2026-10-28) ────────────────────────────
//
// Every research source the Competen Research & Evidence Engine knows of is a RECORD here: what it is, what it can
// do, who may use it for what, its limits, licensing and provenance, and where it stands in its lifecycle. Records are
// CONFIG-002 documents (workspace_config_overrides, scope platform / research), edited in HQ > AI & Intelligence >
// Research Sources and published without a redeploy. The code holds only what must stay code-enforced: the adapters,
// how they authenticate, and the rules below.
//
// ⚠ REGISTRATION, INTEGRATION, APPROVAL AND ACTIVATION ARE SEPARATE. A record starts Designed and is never operational
// on its own:
//   Designed -> Configured -> Integrated -> Evaluated -> Approved -> Active -> Paused -> Retired
//   Configured  the record is complete enough to integrate (capabilities, products, activities, licensing).
//   Integrated  an ADAPTER EXISTS IN CODE (ADAPTERS) and the server's own connectivity check passed. Configuration
//               alone can never reach this: a provider with no adapter stays at Configured, whatever a document says.
//   Evaluated   an evaluation is recorded (what was tested and where).
//   Approved    the owner approved it, with the access, licensing, governance and cost checks recorded, and owner
//               approval of spend for a paid source.
//   Active      the owner activated it. Only now may it be called.
// A change to what was checked (adapter, capabilities, licensing, cost) sends it back to Configured and clears the checks.
//
// ⚠ AN INACTIVE PROVIDER CANNOT BE INVOKED. invocable() is the one gate every call passes (service.ts): Active, an
// adapter in code, inside its effective dates, permitted for the product, the activity and the capability. Anything
// else makes no request and costs nothing. A status written into a published document by hand does not get past it.
//
// ⚠ SECRETS ARE REFERENCES. A record names the environment variable that would hold a key, derived from its id
// (RESEARCH_KEY_<ID>), never a value and never a name an administrator types.

export const RESEARCH_SCOPE = { scopeType: "platform", scopeRef: "research" } as const;
export const REGISTRY_PATH = "research.registry";

export const LIFECYCLE = ["designed", "configured", "integrated", "evaluated", "approved", "active", "paused", "retired"] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  designed: "Designed", configured: "Configured", integrated: "Integrated", evaluated: "Evaluated",
  approved: "Approved", active: "Active", paused: "Paused", retired: "Retired",
};

/** The capability catalogue. `implemented`: the engine has code for it today. A capability without code is a definition. */
export const CAPABILITIES = {
  search: { label: "Literature search", phase: 1, implemented: true },
  metadata: { label: "Bibliographic metadata", phase: 1, implemented: true },
  abstracts: { label: "Abstracts where permitted", phase: 1, implemented: true },
  doi_verification: { label: "DOI and citation verification", phase: 1, implemented: true },
  external_link: { label: "External search link (no retrieval)", phase: 1, implemented: true },
  related_papers: { label: "Related papers", phase: 2, implemented: false },
  evidence_extraction: { label: "Evidence extraction", phase: 2, implemented: false },
  comparison: { label: "Evidence comparison", phase: 2, implemented: false },
  supporting_conflicting: { label: "Supporting and conflicting findings", phase: 2, implemented: false },
  study_characteristics: { label: "Study characteristics", phase: 2, implemented: false },
  synthesis: { label: "Synthesis", phase: 2, implemented: false },
  quality_indicators: { label: "Quality indicators", phase: 2, implemented: false },
  citation_relationships: { label: "Citation relationships", phase: 2, implemented: false },
  advanced_review: { label: "Advanced literature reviews", phase: 3, implemented: false },
  multi_source_synthesis: { label: "Multi-source synthesis", phase: 3, implemented: false },
  question_development: { label: "Research question development", phase: 3, implemented: false },
  evidence_mapping: { label: "Evidence mapping", phase: 3, implemented: false },
  citation_networks: { label: "Citation networks", phase: 3, implemented: false },
  methodology: { label: "Methodology support", phase: 3, implemented: false },
  critical_appraisal: { label: "Critical appraisal", phase: 3, implemented: false },
  gap_identification: { label: "Gap identification", phase: 3, implemented: false },
  writing_assistance: { label: "Writing assistance", phase: 3, implemented: false },
  monitoring_alerts: { label: "Monitoring and alerts", phase: 3, implemented: false },
  web_search: { label: "Web search", phase: 3, implemented: false },
} as const;
export type Capability = keyof typeof CAPABILITIES;
export const isCapability = (v: unknown): v is Capability => typeof v === "string" && Object.prototype.hasOwnProperty.call(CAPABILITIES, v);

/** The products that may consume research, and the activities they may use it for. */
export const RESEARCH_PRODUCTS = ["scholar", "professional", "enterprise", "practice"] as const;
export type ResearchProduct = (typeof RESEARCH_PRODUCTS)[number];
export const RESEARCH_ACTIVITIES = ["learn", "exam", "cpd", "practice_evidence"] as const;
export type ResearchActivity = (typeof RESEARCH_ACTIVITIES)[number];

/**
 * ⚠ THE ADAPTERS THAT EXIST IN CODE. This set is the code side of "Integrated": adding a provider needs an adapter here
 * plus configuration. Phase 2 and Phase 3 sources have none, so none of them can be integrated, approved or called.
 */
export const ADAPTERS = ["pubmed", "openalex", "crossref", "google_scholar_link"] as const;
export type AdapterId = (typeof ADAPTERS)[number];
export const hasAdapter = (id: string): id is AdapterId => (ADAPTERS as readonly string[]).includes(id);

export type CheckRecord = { at: string; by: string | null; ok: boolean; detail: string };
export type ProviderType = "literature_index" | "metadata_registry" | "external_link" | "evidence_tool" | "research_assistant" | "web_search";

export type ProviderRecord = {
  id: string;
  name: string;
  type: ProviderType;
  phase: 1 | 2 | 3;
  status: Lifecycle;
  /** Bumped by every saved change. */
  version: number;
  capabilities: Capability[];
  disciplines: string[];
  products: ResearchProduct[];
  activities: ResearchActivity[];
  /** Lower first. */
  priority: number;
  jurisdiction: string;
  /** The environment variable that would hold a key. Derived from the id, never typed. */
  secretRef: string | null;
  needsKey: boolean;
  rateLimitPerMinute: number;
  dailyRequestBudget: number;
  dailySpendBudgetUsd: number;
  costPerRequestUsd: number;
  /** Results kept from one request, and the most recent years searched (0: any). */
  depth: number;
  freshnessYears: number;
  cacheDays: number;
  retentionDays: number;
  licensing: string;
  provenance: string;
  /** Official API documentation the record rests on. Never fetched by Competen. */
  docsUrl: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  checks: {
    connectivity?: CheckRecord; evaluation?: CheckRecord; access?: CheckRecord; licensing?: CheckRecord;
    governance?: CheckRecord; cost?: CheckRecord; paidApproval?: CheckRecord; approval?: CheckRecord; activation?: CheckRecord;
  };
};
export type Registry = Record<string, ProviderRecord>;

export const secretRefFor = (id: string) => `RESEARCH_KEY_${id.toUpperCase()}`;
const ID = /^[a-z][a-z0-9_]{1,40}$/;

type Seed = Pick<ProviderRecord, "id" | "name" | "type" | "phase" | "capabilities" | "products" | "activities" | "priority" | "licensing" | "provenance" | "docsUrl">
  & Partial<Pick<ProviderRecord, "needsKey" | "costPerRequestUsd" | "rateLimitPerMinute" | "disciplines">>;

const S: Seed[] = [
  // ── Phase 1: real adapters, Configured by default (adapter in code, nothing checked, nothing callable) ──
  { id: "pubmed", name: "PubMed (NCBI E-utilities)", type: "literature_index", phase: 1, capabilities: ["search", "metadata", "abstracts"], products: ["scholar"], activities: ["learn"], priority: 1, rateLimitPerMinute: 180,
    licensing: "NLM E-utilities terms. Abstracts are publishers' copyright: used as private evidence for one answer, shown only as a short excerpt with a link, never redistributed.",
    provenance: "PMID and metadata from NCBI esummary, abstracts from efetch.", docsUrl: "https://www.ncbi.nlm.nih.gov/books/NBK25501/" },
  { id: "openalex", name: "OpenAlex", type: "literature_index", phase: 1, capabilities: ["search", "metadata", "abstracts"], products: ["scholar"], activities: ["learn"], priority: 2, rateLimitPerMinute: 300,
    licensing: "OpenAlex data is CC0. Abstracts come from its inverted index.", provenance: "OpenAlex work ids, DOIs and metadata.", docsUrl: "https://docs.openalex.org/" },
  { id: "crossref", name: "Crossref", type: "metadata_registry", phase: 1, capabilities: ["doi_verification", "metadata"], products: ["scholar"], activities: ["learn"], priority: 3, rateLimitPerMinute: 300,
    licensing: "Crossref metadata is open for reuse.", provenance: "The DOI's registered title and issue date.", docsUrl: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/" },
  { id: "google_scholar_link", name: "Google Scholar (external link only)", type: "external_link", phase: 1, capabilities: ["external_link"], products: ["scholar"], activities: ["learn"], priority: 9, rateLimitPerMinute: 0,
    licensing: "A plain link for the learner to follow. Competen never fetches, scrapes or automates Google Scholar.", provenance: "None: nothing is retrieved.", docsUrl: null },
  // ── Phase 2: structures only. No adapter, no call. ──
  { id: "europe_pmc", name: "Europe PMC", type: "literature_index", phase: 2, capabilities: ["search", "metadata", "abstracts", "related_papers", "citation_relationships"], products: ["scholar"], activities: ["learn"], priority: 4,
    licensing: "To confirm: open access subset terms and text-mining licence per article.", provenance: "To define.", docsUrl: "https://europepmc.org/RestfulWebService" },
  { id: "semantic_scholar", name: "Semantic Scholar", type: "literature_index", phase: 2, capabilities: ["search", "related_papers", "citation_relationships", "study_characteristics"], products: ["scholar"], activities: ["learn"], priority: 5, needsKey: true,
    licensing: "To confirm: API licence agreement and attribution.", provenance: "To define.", docsUrl: "https://api.semanticscholar.org/" },
  { id: "scite", name: "Scite", type: "evidence_tool", phase: 2, capabilities: ["supporting_conflicting", "citation_relationships", "quality_indicators"], products: ["scholar"], activities: ["learn"], priority: 6, needsKey: true,
    licensing: "Commercial. Needs a contract and owner approval of spend.", provenance: "To define.", docsUrl: null },
  { id: "elicit", name: "Elicit", type: "research_assistant", phase: 2, capabilities: ["evidence_extraction", "comparison", "synthesis", "study_characteristics"], products: ["scholar"], activities: ["learn"], priority: 7, needsKey: true,
    licensing: "Commercial. Needs a contract and owner approval of spend.", provenance: "To define.", docsUrl: null },
  // ── Phase 3: definitions and configuration only. ──
  ...([
    ["consensus", "Consensus", "research_assistant", ["synthesis", "supporting_conflicting", "question_development"]],
    ["scispace", "SciSpace", "research_assistant", ["advanced_review", "writing_assistance", "methodology"]],
    ["dimensions", "Dimensions", "literature_index", ["search", "citation_networks", "evidence_mapping"]],
    ["researchrabbit", "ResearchRabbit", "evidence_tool", ["citation_networks", "related_papers", "monitoring_alerts"]],
    ["litmaps", "Litmaps", "evidence_tool", ["citation_networks", "evidence_mapping", "monitoring_alerts"]],
    ["undermind", "Undermind", "research_assistant", ["advanced_review", "gap_identification"]],
    ["brave_search", "Brave Search API", "web_search", ["web_search"]],
    ["exa", "Exa", "web_search", ["web_search", "related_papers"]],
    ["tavily", "Tavily", "web_search", ["web_search", "multi_source_synthesis"]],
  ] as const).map(([id, name, type, caps], i) => ({
    id, name, type: type as ProviderType, phase: 3 as const, capabilities: [...caps] as Capability[], products: [] as ResearchProduct[], activities: [] as ResearchActivity[], priority: 20 + i, needsKey: true,
    licensing: "To confirm: legitimate API access, licence and cost. Needs owner approval before any use.", provenance: "To define.", docsUrl: null,
  })),
];

const seedRecord = (s: Seed): ProviderRecord => ({
  id: s.id, name: s.name, type: s.type, phase: s.phase,
  // Phase 1 has its adapter and its fields: Configured. Everything else: Designed. Nothing is Active by default.
  status: s.phase === 1 ? "configured" : "designed",
  version: 0, capabilities: s.capabilities, disciplines: s.disciplines ?? ["healthcare"], products: s.products, activities: s.activities, priority: s.priority,
  jurisdiction: "global", secretRef: s.needsKey ? secretRefFor(s.id) : null, needsKey: !!s.needsKey,
  rateLimitPerMinute: s.rateLimitPerMinute ?? 60, dailyRequestBudget: s.phase === 1 ? 2000 : 0, dailySpendBudgetUsd: 0, costPerRequestUsd: s.costPerRequestUsd ?? 0,
  depth: 5, freshnessYears: 15, cacheDays: 30, retentionDays: 30, licensing: s.licensing, provenance: s.provenance, docsUrl: s.docsUrl,
  effectiveFrom: null, effectiveTo: null, checks: {},
});
export const SEED_REGISTRY: Registry = Object.fromEntries(S.map(s => [s.id, seedRecord(s)]));

const clampN = (v: unknown, lo: number, hi: number, d: number, dp = 0) => { const n = Number(v); const f = 10 ** dp; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * f) / f)) : d; };
const str = (v: unknown, max: number, d: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);
const isoOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const list = <T extends string>(v: unknown, allowed: readonly T[], d: T[]): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => (allowed as readonly string[]).includes(x as string)))] : d);
const check = (v: any): CheckRecord | undefined => // eslint-disable-line @typescript-eslint/no-explicit-any
  v && typeof v === "object" && typeof v.at === "string" && typeof v.ok === "boolean" ? { at: v.at, by: typeof v.by === "string" ? v.by : null, ok: v.ok, detail: str(v.detail, 500, "") } : undefined;

/**
 * Pure. The registry as configured: every seeded record, with what the published document changes, clamped. Unknown
 * fields are dropped. A record id that is not seeded may be added (a new source is configuration), but it has no
 * adapter, so it can never get past Configured.
 */
export function resolveRegistry(doc: unknown): Registry {
  const out: Registry = structuredClone(SEED_REGISTRY);
  const src = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, any>) : {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [id, raw] of Object.entries(src)) {
    if (!ID.test(id) || !raw || typeof raw !== "object") continue;
    const base = out[id] ?? seedRecord({ id, name: str(raw.name, 120, id), type: "literature_index", phase: 3, capabilities: [], products: [], activities: [], priority: 50, licensing: "To confirm.", provenance: "To define.", docsUrl: null });
    const status = (LIFECYCLE as readonly string[]).includes(raw.status) ? raw.status as Lifecycle : base.status;
    const checks = Object.fromEntries(Object.entries(raw.checks ?? {}).map(([k, v]) => [k, check(v)]).filter(([, v]) => v)) as ProviderRecord["checks"];
    out[id] = {
      ...base,
      name: str(raw.name, 120, base.name), status, version: clampN(raw.version, 0, 1e6, base.version),
      capabilities: list(raw.capabilities, Object.keys(CAPABILITIES) as Capability[], base.capabilities),
      disciplines: Array.isArray(raw.disciplines) ? raw.disciplines.filter((d: unknown): d is string => typeof d === "string" && /^[a-z][a-z0-9_ -]{1,40}$/.test(d)).slice(0, 20) : base.disciplines,
      products: list(raw.products, RESEARCH_PRODUCTS, base.products), activities: list(raw.activities, RESEARCH_ACTIVITIES, base.activities),
      priority: clampN(raw.priority, 0, 99, base.priority), jurisdiction: str(raw.jurisdiction, 80, base.jurisdiction),
      secretRef: base.needsKey ? secretRefFor(id) : null,
      rateLimitPerMinute: clampN(raw.rateLimitPerMinute, 0, 600, base.rateLimitPerMinute), dailyRequestBudget: clampN(raw.dailyRequestBudget, 0, 100000, base.dailyRequestBudget),
      dailySpendBudgetUsd: clampN(raw.dailySpendBudgetUsd, 0, 1000, base.dailySpendBudgetUsd, 6), costPerRequestUsd: clampN(raw.costPerRequestUsd, 0, 10, base.costPerRequestUsd, 6),
      depth: clampN(raw.depth, 1, 10, base.depth), freshnessYears: clampN(raw.freshnessYears, 0, 50, base.freshnessYears),
      cacheDays: clampN(raw.cacheDays, 0, 90, base.cacheDays), retentionDays: clampN(raw.retentionDays, 0, 365, base.retentionDays),
      licensing: str(raw.licensing, 600, base.licensing), provenance: str(raw.provenance, 300, base.provenance),
      effectiveFrom: isoOrNull(raw.effectiveFrom), effectiveTo: isoOrNull(raw.effectiveTo), checks,
    };
  }
  return out;
}

/** What an edit may change. Status, version and checks are the server's, set only by the lifecycle actions. */
export const EDITABLE_FIELDS = ["name", "capabilities", "disciplines", "products", "activities", "priority", "jurisdiction", "rateLimitPerMinute", "dailyRequestBudget",
  "dailySpendBudgetUsd", "costPerRequestUsd", "depth", "freshnessYears", "cacheDays", "retentionDays", "licensing", "provenance", "effectiveFrom", "effectiveTo"] as const;
/** A change to any of these is a change to what was checked: the record goes back to Configured and its checks are cleared. */
const HARD_FIELDS: readonly string[] = ["capabilities", "licensing", "costPerRequestUsd", "products", "activities"];

/** Pure. Apply an edit. Returns the next record and whether it was sent back to Configured. */
export function applyEdit(prev: ProviderRecord, patch: Record<string, unknown>): { record: ProviderRecord; demoted: boolean } {
  if (prev.status === "retired") return { record: prev, demoted: false };
  const picked = Object.fromEntries(Object.entries(patch).filter(([k]) => (EDITABLE_FIELDS as readonly string[]).includes(k)));
  const merged = resolveRegistry({ [prev.id]: { ...prev, ...picked } })[prev.id];
  const hard = HARD_FIELDS.some(f => JSON.stringify((merged as any)[f]) !== JSON.stringify((prev as any)[f])); // eslint-disable-line @typescript-eslint/no-explicit-any
  const beyond = LIFECYCLE.indexOf(prev.status) > LIFECYCLE.indexOf("configured");
  const demoted = hard && beyond;
  return { record: { ...merged, version: prev.version + 1, status: demoted ? "configured" : prev.status, checks: demoted ? {} : prev.checks }, demoted };
}

/** Pure. What a record still needs before it may move to `to`. Empty: it may. */
export function transitionNeeds(r: ProviderRecord, to: Lifecycle, actor: { isOwner: boolean }, now = new Date()): string[] {
  const at = LIFECYCLE.indexOf(r.status);
  const need: string[] = [];
  if (r.status === "retired") return ["a retired source cannot change"];
  if (["approved", "active", "retired"].includes(to) && !actor.isOwner) need.push("a platform owner");
  switch (to) {
    case "configured":
      if (!r.capabilities.length) need.push("at least one capability");
      if (r.type !== "external_link" && !r.products.length) need.push("at least one product");
      if (/to confirm/i.test(r.licensing)) need.push("its licensing confirmed");
      break;
    case "integrated":
      if (at < LIFECYCLE.indexOf("configured")) need.push("to be Configured first");
      if (!hasAdapter(r.id)) need.push("an adapter in code (none exists for this source)");
      if (r.type !== "external_link" && !r.checks.connectivity?.ok) need.push("a passing connectivity check, run by the server");
      if (r.needsKey && r.secretRef && !process.env[r.secretRef]) need.push(`its key in the deployment (${r.secretRef})`);
      break;
    case "evaluated":
      if (at < LIFECYCLE.indexOf("integrated")) need.push("to be Integrated first");
      if (!r.checks.evaluation?.ok) need.push("an evaluation recorded");
      break;
    case "approved":
      if (at < LIFECYCLE.indexOf("evaluated")) need.push("to be Evaluated first");
      for (const k of ["access", "licensing", "governance", "cost"] as const) if (!r.checks[k]?.ok) need.push(`the ${k} check recorded`);
      if (r.costPerRequestUsd > 0 && !r.checks.paidApproval?.ok) need.push("owner approval of spend for a paid source");
      break;
    case "active":
      if (r.status !== "approved" && r.status !== "paused") need.push("to be Approved (or Paused) first");
      if (!hasAdapter(r.id)) need.push("an adapter in code");
      if (r.effectiveFrom && Date.parse(r.effectiveFrom) > now.getTime()) need.push("its effective date to be reached");
      if (r.effectiveTo && Date.parse(r.effectiveTo) <= now.getTime()) need.push("an effective-to date in the future");
      break;
    case "paused":
      if (r.status !== "active") need.push("to be Active");
      break;
    case "retired":
      break;
    case "designed":
      need.push("a source never goes back to Designed");
  }
  return need;
}

export type InvokeContext = { product: ResearchProduct; activity: ResearchActivity; capability: Capability; now?: Date };

/**
 * ⚠ THE ONE GATE EVERY PROVIDER CALL PASSES. Pure. Null: it may be called. Otherwise the reason code, and nothing is
 * sent. Active is necessary and NOT sufficient: the adapter must exist in code, the capability must be implemented and
 * held, and the product, activity and effective dates must permit it.
 */
export function notInvocable(r: ProviderRecord | undefined, c: InvokeContext): string | null {
  if (!r) return "unknown_provider";
  if (r.status !== "active") return `not_active_${r.status}`;
  if (!hasAdapter(r.id)) return "no_adapter";
  // A status alone (a document edited by hand) is not activation: the server's checks and the owner's acts must be there.
  if (r.type !== "external_link" && !r.checks.connectivity?.ok) return "not_integrated";
  if (!r.checks.approval?.ok || !r.checks.activation?.ok) return "not_approved";
  if (!CAPABILITIES[c.capability]?.implemented) return "capability_not_implemented";
  if (!r.capabilities.includes(c.capability)) return "capability_not_held";
  if (!r.products.includes(c.product)) return "product_not_permitted";
  if (!r.activities.includes(c.activity)) return "activity_not_permitted";
  const now = (c.now ?? new Date()).getTime();
  if (r.effectiveFrom && Date.parse(r.effectiveFrom) > now) return "not_yet_effective";
  if (r.effectiveTo && Date.parse(r.effectiveTo) <= now) return "no_longer_effective";
  if (r.needsKey && r.secretRef && !process.env[r.secretRef]) return "no_key";
  return null;
}

/** Pure. The providers that may be called for this, in priority order. */
export const invocableProviders = (reg: Registry, c: InvokeContext): ProviderRecord[] =>
  Object.values(reg).filter(r => notInvocable(r, c) === null).sort((a, b) => a.priority - b.priority);
