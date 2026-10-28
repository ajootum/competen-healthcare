import { CAPABILITIES, RESEARCH_PRODUCTS, invocableProviders, type Capability, type Registry, type ResearchActivity, type ResearchProduct } from "./registry";

// ── RESEARCH & EVIDENCE ENGINE CONFIGURATION ── COMPETEN-RESEARCH-01 ADDENDUM V2 ──────────────────────────────────────
//
// Two more CONFIG-002 documents beside the registry, in the same scope (platform / research), published together:
//   research.policy     source policies (per product), evidence & citation rules, budgets and limits
//   research.workflows  the research workflows, as configuration: steps from a fixed catalogue, the capabilities they
//                       need, and their own lifecycle. No workflow engine: the steps are the engine's own code, and a
//                       step without code makes its workflow impossible to activate.
//
// ⚠ SOME RULES ARE NOT CONFIGURABLE. Evidence always needs a verified identity; an abstract is never full text; a
// citation is only ever a provider's record. They are constants here, shown in HQ as fixed, and no document changes them.

export const POLICY_PATH = "research.policy";
export const WORKFLOWS_PATH = "research.workflows";

export const FIXED_RULES = [
  "Evidence needs a verified identity: a PMID from PubMed or a DOI confirmed by Crossref.",
  "An abstract is never treated as full text. Full text is never fetched.",
  "Every citation is a provider's own record. Nothing the model writes becomes a reference.",
  "Verified metadata is kept apart from AI interpretation.",
  "Only topic keywords leave Competen, screened for patient identifiers. No learner text, notes or identity.",
  "Research never changes which AI models may answer (clinical eligibility is unchanged).",
] as const;

export type SourcePolicy = { providers: string[]; disciplines: string[]; clinicalApprovedOnly: boolean };
export type ResearchPolicy = {
  sources: Record<ResearchProduct, SourcePolicy>;
  rules: { abstractsAsEvidence: boolean; doiVerification: boolean; maxEvidence: number; excerptChars: number; showFurtherReading: boolean; scholarLink: boolean };
  limits: { timeoutMs: number; retries: number; maxResultsPerRequest: number; cacheDays: number; retentionDays: number; dailyRequests: number; dailySpendUsd: number };
};

export const DEFAULT_POLICY: ResearchPolicy = {
  sources: Object.fromEntries(RESEARCH_PRODUCTS.map(p => [p, { providers: [], disciplines: ["healthcare"], clinicalApprovedOnly: true }])) as unknown as Record<ResearchProduct, SourcePolicy>,
  rules: { abstractsAsEvidence: true, doiVerification: true, maxEvidence: 5, excerptChars: 320, showFurtherReading: true, scholarLink: true },
  limits: { timeoutMs: 6000, retries: 0, maxResultsPerRequest: 5, cacheDays: 30, retentionDays: 30, dailyRequests: 5000, dailySpendUsd: 0 },
};

const n = (v: unknown, lo: number, hi: number, d: number, dp = 0) => { const x = Number(v); const f = 10 ** dp; return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * f) / f)) : d; };
const b = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(x)))].slice(0, 30) : []);

/** Pure. The policy as configured, clamped to its fixed ranges. */
export function resolveResearchPolicy(doc: any): ResearchPolicy { // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = DEFAULT_POLICY, s = doc && typeof doc === "object" ? doc : {};
  return {
    sources: Object.fromEntries(RESEARCH_PRODUCTS.map(p => {
      const x = s.sources?.[p] ?? {};
      return [p, { providers: ids(x.providers), disciplines: Array.isArray(x.disciplines) ? x.disciplines.filter((v: unknown) => typeof v === "string").slice(0, 20) : d.sources[p].disciplines, clinicalApprovedOnly: b(x.clinicalApprovedOnly, true) }];
    })) as Record<ResearchProduct, SourcePolicy>,
    rules: {
      abstractsAsEvidence: b(s.rules?.abstractsAsEvidence, d.rules.abstractsAsEvidence), doiVerification: b(s.rules?.doiVerification, d.rules.doiVerification),
      maxEvidence: n(s.rules?.maxEvidence, 1, 10, d.rules.maxEvidence), excerptChars: n(s.rules?.excerptChars, 0, 600, d.rules.excerptChars),
      showFurtherReading: b(s.rules?.showFurtherReading, d.rules.showFurtherReading), scholarLink: b(s.rules?.scholarLink, d.rules.scholarLink),
    },
    limits: {
      timeoutMs: n(s.limits?.timeoutMs, 1000, 15000, d.limits.timeoutMs), retries: n(s.limits?.retries, 0, 2, d.limits.retries),
      maxResultsPerRequest: n(s.limits?.maxResultsPerRequest, 1, 10, d.limits.maxResultsPerRequest), cacheDays: n(s.limits?.cacheDays, 0, 90, d.limits.cacheDays),
      retentionDays: n(s.limits?.retentionDays, 0, 365, d.limits.retentionDays), dailyRequests: n(s.limits?.dailyRequests, 0, 100000, d.limits.dailyRequests),
      dailySpendUsd: n(s.limits?.dailySpendUsd, 0, 1000, d.limits.dailySpendUsd, 6),
    },
  };
}

// ── WORKFLOWS ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The step catalogue. `implemented`: the engine runs it today. */
export const STEPS = {
  classify_risk: { label: "Classify activity, subject and clinical risk", implemented: true },
  sufficiency: { label: "Decide whether authorised sources are sufficient", implemented: true },
  search: { label: "Search approved providers", implemented: true },
  retrieve: { label: "Retrieve metadata and permitted abstracts", implemented: true },
  verify_identity: { label: "Verify identity, dates and provenance", implemented: true },
  generate: { label: "Generate on the cheapest eligible model", implemented: true },
  verify_claims: { label: "Verify claims against the permitted evidence", implemented: true },
  cite: { label: "Cite notes, library and research apart", implemented: true },
  save: { label: "Save evidence references with the output", implemented: true },
  compare: { label: "Compare findings across studies", implemented: false },
  extract: { label: "Extract study characteristics and findings", implemented: false },
  appraise: { label: "Critically appraise each study", implemented: false },
  synthesise: { label: "Synthesise across sources", implemented: false },
} as const;
export type Step = keyof typeof STEPS;

export const WORKFLOW_STATUS = ["designed", "configured", "active", "paused", "retired"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUS)[number];
export type Workflow = {
  id: string; name: string; status: WorkflowStatus; products: ResearchProduct[]; activities: ResearchActivity[];
  steps: Step[]; needs: Capability[]; modelPolicy: "cheapest_eligible"; maxSources: number; fallback: "notes_only"; version: number;
};

const BASIC_STEPS: Step[] = ["classify_risk", "sufficiency", "search", "retrieve", "verify_identity", "generate", "verify_claims", "cite", "save"];
export const SEED_WORKFLOWS: Record<string, Workflow> = {
  basic: { id: "basic", name: "Basic research", status: "configured", products: ["scholar"], activities: ["learn"], steps: BASIC_STEPS, needs: ["search", "metadata", "abstracts"], modelPolicy: "cheapest_eligible", maxSources: 5, fallback: "notes_only", version: 0 },
  comparison: { id: "comparison", name: "Evidence comparison", status: "designed", products: ["scholar"], activities: ["learn"], steps: [...BASIC_STEPS.slice(0, 5), "extract", "compare", ...BASIC_STEPS.slice(5)], needs: ["search", "abstracts", "comparison", "supporting_conflicting"], modelPolicy: "cheapest_eligible", maxSources: 8, fallback: "notes_only", version: 0 },
  clinical: { id: "clinical", name: "Clinical evidence", status: "designed", products: ["scholar"], activities: ["learn"], steps: [...BASIC_STEPS.slice(0, 5), "appraise", ...BASIC_STEPS.slice(5)], needs: ["search", "abstracts", "quality_indicators", "study_characteristics"], modelPolicy: "cheapest_eligible", maxSources: 8, fallback: "notes_only", version: 0 },
  advanced: { id: "advanced", name: "Advanced research", status: "designed", products: ["scholar"], activities: ["learn"], steps: [...BASIC_STEPS.slice(0, 5), "extract", "appraise", "synthesise", ...BASIC_STEPS.slice(5)], needs: ["search", "abstracts", "synthesis", "citation_relationships"], modelPolicy: "cheapest_eligible", maxSources: 10, fallback: "notes_only", version: 0 },
};

/** Pure. The workflows as configured. Steps and needs come from the catalogues only; a status is clamped to the list. */
export function resolveWorkflows(doc: any): Record<string, Workflow> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out = structuredClone(SEED_WORKFLOWS);
  for (const [id, raw] of Object.entries((doc && typeof doc === "object" ? doc : {}) as Record<string, any>)) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const base = out[id];
    if (!base || !raw || typeof raw !== "object") continue; // workflows are the catalogue's four: a new one needs its steps in code
    out[id] = {
      ...base,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : base.name,
      status: (WORKFLOW_STATUS as readonly string[]).includes(raw.status) ? raw.status : base.status,
      products: Array.isArray(raw.products) ? raw.products.filter((p: unknown) => (RESEARCH_PRODUCTS as readonly unknown[]).includes(p)) : base.products,
      maxSources: n(raw.maxSources, 1, 10, base.maxSources), version: n(raw.version, 0, 1e6, base.version),
    };
  }
  return out;
}

/** Pure. What a workflow still needs before it may be Active for a product and activity. Empty: it may. */
export function workflowNeeds(w: Workflow, reg: Registry, c: { product: ResearchProduct; activity: ResearchActivity; isOwner: boolean }): string[] {
  const need: string[] = [];
  if (!c.isOwner) need.push("a platform owner");
  if (w.status === "retired") need.push("a retired workflow cannot be activated");
  for (const s of w.steps) if (!STEPS[s].implemented) need.push(`the "${STEPS[s].label}" step, which has no code yet`);
  if (!w.products.includes(c.product)) need.push(`${c.product} among its products`);
  for (const cap of w.needs) {
    if (!CAPABILITIES[cap].implemented) need.push(`the ${CAPABILITIES[cap].label} capability, which has no code yet`);
    else if (!invocableProviders(reg, { product: c.product, activity: c.activity, capability: cap }).length) need.push(`an Active source providing ${CAPABILITIES[cap].label}`);
  }
  return [...new Set(need)];
}

/** Pure. Whether a workflow is operational right now: Active AND everything it needs Active. Activation alone is not enough. */
export const workflowOperational = (w: Workflow | undefined, reg: Registry, c: { product: ResearchProduct; activity: ResearchActivity }) =>
  !!w && w.status === "active" && workflowNeeds(w, reg, { ...c, isOwner: true }).length === 0;
