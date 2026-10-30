/* eslint-disable @typescript-eslint/no-explicit-any */
import { publishScope, rollbackVersion, setOverride, type WceActor } from "@/lib/config/workspace-config-write";
import {
  POLICY_PATH, WORKFLOWS_PATH, WORKFLOW_STATUS, resolveResearchPolicy, resolveWorkflows, workflowNeeds, workflowOperational,
  type ResearchPolicy, type Workflow, type WorkflowStatus,
} from "./engine-config";
import { pmcOpenAccess, searchOpenAlex, searchPubmed, verifyDoi, researchContact, type ProviderDeps } from "./providers";
import {
  LIFECYCLE, REGISTRY_PATH, RESEARCH_SCOPE, applyEdit, hasAdapter, resolveRegistry, transitionNeeds,
  type Lifecycle, type ProviderRecord, type Registry,
} from "./registry";
import { researchCostByOutcome, summariseResearchUsage } from "./load";

// ── THE RESEARCH SOURCES & EVIDENCE STUDIO, SERVER SIDE ── COMPETEN-RESEARCH-01 ADDENDUM V2 item 12 ───────────────────
//
// Every change is a DRAFT of one of the three documents (registry, policy, workflows) in scope platform / research, on
// the CONFIG-002 engine: audited in workspace_config_audit, published together as a version, rolled back to any
// version. Nothing a draft says is read at runtime until it is published. Lifecycle steps are the server's: an edit
// cannot set a status, a version or a check. Approval, activation, retirement, spend approval, publication and rollback
// are owner-only, whoever holds hq.platform.research.manage (migration 630, granted to no position).
//
// ⚠ THE ONE CALL A NON-ACTIVE SOURCE MAY MAKE is its connectivity check: run by the server, on an explicit HQ act, with
// a fixed synthetic query (never learner content), and only for a source with an adapter in code -- that check is what
// integration IS. A Phase 2 or Phase 3 source has no adapter, so not even this can reach it.

type Actor = WceActor & { isOwner: boolean };
type Out = { ok: true; detail?: string } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): Out => ({ ok: false, status, error });

async function docs(admin: any) {
  const { data, error } = await admin.from("workspace_config_overrides").select("config_path, draft, published")
    .eq("scope_type", RESEARCH_SCOPE.scopeType).eq("scope_ref", RESEARCH_SCOPE.scopeRef).in("config_path", [REGISTRY_PATH, POLICY_PATH, WORKFLOWS_PATH]);
  if (error) return null;
  const row = (p: string) => (data ?? []).find((r: any) => r.config_path === p) ?? null;
  const pick = (p: string) => { const r = row(p); return { published: r?.published ?? null, draft: r ? (r.draft ?? r.published ?? null) : null, pending: !!r && JSON.stringify(r.draft) !== JSON.stringify(r.published) }; };
  return { registry: pick(REGISTRY_PATH), policy: pick(POLICY_PATH), workflows: pick(WORKFLOWS_PATH) };
}

/** Records as stored: only what differs from code is kept, but simplest is the whole resolved record. */
const writeRegistry = (admin: any, actor: WceActor, reg: Registry) => setOverride(admin, actor, RESEARCH_SCOPE, REGISTRY_PATH, reg);
async function draftRegistry(admin: any): Promise<Registry | null> {
  const d = await docs(admin);
  return d ? resolveRegistry(d.registry.draft) : null;
}

export async function loadStudioView(admin: any) {
  const d = await docs(admin);
  if (!d) return null;
  const published = { registry: resolveRegistry(d.registry.published), policy: resolveResearchPolicy(d.policy.published), workflows: resolveWorkflows(d.workflows.published) };
  const draft = { registry: resolveRegistry(d.registry.draft), policy: resolveResearchPolicy(d.policy.draft), workflows: resolveWorkflows(d.workflows.draft) };
  const pending = d.registry.pending || d.policy.pending || d.workflows.pending;
  const next: Partial<Record<Lifecycle, Lifecycle>> = { designed: "configured", configured: "integrated", integrated: "evaluated", evaluated: "approved", approved: "active", paused: "active" };
  const readiness = Object.fromEntries(Object.values(draft.registry).map(r => {
    const to = next[r.status];
    return [r.id, { next: to ?? null, needs: to ? transitionNeeds(r, to, { isOwner: true }) : [], adapter: hasAdapter(r.id) }];
  }));
  const workflowReadiness = Object.fromEntries(Object.values(draft.workflows).map(w => [w.id, {
    needs: workflowNeeds(w, draft.registry, { product: "scholar", activity: "learn", isOwner: true }),
    operationalNow: workflowOperational(published.workflows[w.id], published.registry, { product: "scholar", activity: "learn" }),
  }]));
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [usage, outcomes, aiCost, versions] = await Promise.all([
    admin.from("plat_research_requests").select("action_id, provider, requests, outcome, latency_ms, cost_usd").gte("created_at", since).limit(20000),
    admin.from("plat_ai_outcomes").select("action_id, outcome, rejection_reasons").like("operation", "individual_scholar_learn_research%").gte("created_at", since).limit(5000),
    admin.from("plat_ai_requests").select("cost_usd").eq("operation", "individual_scholar_learn_research").gte("created_at", since).limit(20000),
    admin.from("workspace_config_versions").select("id, label, note, published_by_name, created_at").eq("scope_type", RESEARCH_SCOPE.scopeType).eq("scope_ref", RESEARCH_SCOPE.scopeRef).order("created_at", { ascending: false }).limit(10),
  ]);
  const reasons = new Map<string, number>();
  for (const o of outcomes.data ?? []) for (const r of o.rejection_reasons ?? []) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  return {
    published, draft, pending, readiness, workflowReadiness,
    analytics: {
      usage: usage.error ? null : summariseResearchUsage(usage.data ?? []),
      // Research cost attributed to the Scholar AI action it served, by that action's outcome (joined on action_id).
      costByOutcome: usage.error || outcomes.error ? null : researchCostByOutcome(usage.data ?? [], outcomes.data ?? []),
      outcomes: outcomes.error ? null : {
        total: (outcomes.data ?? []).length,
        accepted: (outcomes.data ?? []).filter((o: any) => o.outcome === "accepted").length,
        partial: (outcomes.data ?? []).filter((o: any) => o.outcome === "partial").length,
        rejected: (outcomes.data ?? []).filter((o: any) => o.outcome === "rejected").length,
        reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      },
      aiCostUsd: aiCost.error ? null : +((aiCost.data ?? []).reduce((s: number, r: any) => s + (Number(r.cost_usd) || 0), 0)).toFixed(4),
    },
    versions: versions.error ? [] : versions.data ?? [],
  };
}

/** Create or edit a record. A new id starts Designed, with no adapter. */
export async function saveProvider(admin: any, actor: Actor, id: string, patch: Record<string, unknown>): Promise<Out> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(id)) return fail(400, "Give an id: lowercase letters, digits and underscores, 2 to 41.");
  const reg = await draftRegistry(admin);
  if (!reg) return fail(503, "The registry could not be read just now.");
  const prev = reg[id] ?? resolveRegistry({ [id]: { name: typeof patch.name === "string" ? patch.name : id } })[id];
  if (prev.status === "retired") return fail(409, "A retired source cannot be changed.");
  const { record, demoted } = applyEdit(prev, patch);
  reg[id] = record;
  const w = await writeRegistry(admin, actor, reg);
  return w.ok ? { ok: true, detail: demoted ? "What was checked changed, so it went back to Configured and its checks were cleared." : undefined } : fail(w.status, w.error);
}

const SYNTHETIC_QUERY = "oxygen therapy";
/** Crossref's documented test DOI. */
const TEST_DOI = { doi: "10.5555/12345678", title: "Toward a Unified Theory of High-Energy Metaphysics: Silly String Theory", year: 2008 };
/** A fixed public PMID for the PubMed Central connectivity check: PMC1790863, an open-access article (licence "CC BY") in the PMC Cloud Service. */
const TEST_PMID = "17299597";

/**
 * The PubMed Central connectivity check. SCHOLAR-SQIE-02: a fixed public PMID, never learner content. The test article is
 * known to be open access, so the check passes only when the service returns its licence. A 404 (the retired OA web
 * service), an unreadable answer or a missing licence FAILS: "has no open-access copy" is not a pass for a known
 * open-access article.
 */
export async function checkPmcConnectivity(deps: ProviderDeps): Promise<{ ok: boolean; detail: string }> {
  const started = Date.now();
  const m = await pmcOpenAccess(deps, [TEST_PMID]).catch(() => null);
  const oa = m?.found.get(TEST_PMID) ?? null;
  const ok = oa !== null && !!oa.licence;
  const detail = ok ? `answered in ${Date.now() - started} ms (test PMID ${TEST_PMID}: open-access copy, licence ${oa!.licence})`
    : m === null ? "no answer (the ID converter or the PMC Cloud Service did not respond)"
    : oa ? "failed: the test article came back open access but without a licence"
    : "failed: the test article, known to be open access, came back with no open-access copy";
  return { ok, detail };
}

/** Connectivity, run by the server, for a source with an adapter in code. See the header for why this is the one exception. */
export async function runConnectivity(admin: any, actor: Actor, id: string): Promise<Out> {
  const reg = await draftRegistry(admin);
  if (!reg) return fail(503, "The registry could not be read just now.");
  const r = reg[id];
  if (!r) return fail(404, "No such source.");
  if (!hasAdapter(id)) return fail(409, "This source has no adapter in code, so it cannot be connected. That needs development, not configuration.");
  if (r.type === "external_link") return fail(409, "A link is not retrieved, so there is nothing to connect.");
  if (r.needsKey && r.secretRef && !process.env[r.secretRef]) return fail(409, `Its key is not set in the deployment (${r.secretRef}).`);
  const deps: ProviderDeps = { fetch: fetch as never, timeoutMs: 8000, contact: researchContact(), now: () => new Date() };
  const started = Date.now();
  let ok = false, detail = "";
  if (id === "pubmed" || id === "openalex") {
    const items = await (id === "pubmed" ? searchPubmed(deps, SYNTHETIC_QUERY, 1, false) : searchOpenAlex(deps, SYNTHETIC_QUERY, 1, false)).catch(() => null);
    ok = items !== null; detail = ok ? `answered in ${Date.now() - started} ms, ${items!.length} record(s) for a synthetic query` : "no answer";
  } else if (id === "crossref") {
    const v = await verifyDoi(deps, TEST_DOI).catch(() => null);
    ok = v !== null; detail = ok ? `answered in ${Date.now() - started} ms (test DOI ${v ? "matched" : "did not match"})` : "no answer";
  } else if (id === "pmc") {
    ({ ok, detail } = await checkPmcConnectivity(deps));
  }
  reg[id] = { ...r, checks: { ...r.checks, connectivity: { at: new Date().toISOString(), by: actor.userId, ok, detail } } };
  const w = await writeRegistry(admin, actor, reg);
  return w.ok ? { ok: true, detail } : fail(w.status, w.error);
}

export const CHECK_KINDS = ["evaluation", "access", "licensing", "governance", "cost", "paidApproval"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** A recorded check: what it rests on, by whom. Spend approval for a paid source is the owner's. */
export async function recordCheck(admin: any, actor: Actor, id: string, kind: CheckKind, note: string): Promise<Out> {
  if (!(CHECK_KINDS as readonly string[]).includes(kind)) return fail(400, "Choose a check.");
  if (kind === "paidApproval" && !actor.isOwner) return fail(403, "Only a platform owner can approve spend on a paid source.");
  const detail = note.trim().slice(0, 500);
  if (detail.length < 10) return fail(422, "Say what the check rests on (at least 10 characters): the evidence, document or run it refers to.");
  const reg = await draftRegistry(admin);
  if (!reg) return fail(503, "The registry could not be read just now.");
  const r = reg[id];
  if (!r) return fail(404, "No such source.");
  if (r.status === "retired") return fail(409, "A retired source cannot change.");
  reg[id] = { ...r, checks: { ...r.checks, [kind]: { at: new Date().toISOString(), by: actor.userId, ok: true, detail } } };
  const w = await writeRegistry(admin, actor, reg);
  return w.ok ? { ok: true } : fail(w.status, w.error);
}

/** One lifecycle step, if everything it needs is in place. Takes effect when published. */
export async function transition(admin: any, actor: Actor, id: string, to: Lifecycle): Promise<Out> {
  if (!(LIFECYCLE as readonly string[]).includes(to)) return fail(400, "Choose a lifecycle state.");
  const reg = await draftRegistry(admin);
  if (!reg) return fail(503, "The registry could not be read just now.");
  const r = reg[id];
  if (!r) return fail(404, "No such source.");
  const needs = transitionNeeds(r, to, actor);
  if (needs.length) return fail(409, `It cannot move to ${to} yet. It needs: ${needs.join("; ")}.`);
  const stamp = { at: new Date().toISOString(), by: actor.userId, ok: true, detail: `${r.status} -> ${to}` };
  const checks: ProviderRecord["checks"] = { ...r.checks, ...(to === "approved" ? { approval: stamp } : {}), ...(to === "active" ? { activation: stamp } : {}) };
  reg[id] = { ...r, status: to, version: r.version + 1, checks };
  const w = await writeRegistry(admin, actor, reg);
  return w.ok ? { ok: true } : fail(w.status, w.error);
}

/** Source policies, evidence and citation rules, budgets and limits: one document, clamped by the resolver. */
export async function savePolicy(admin: any, actor: Actor, doc: unknown): Promise<Out> {
  const clean: ResearchPolicy = resolveResearchPolicy(doc);
  const w = await setOverride(admin, actor, RESEARCH_SCOPE, POLICY_PATH, clean);
  return w.ok ? { ok: true } : fail(w.status, w.error);
}

/** A workflow edit or status change. Active only when everything it needs is in place, and only by an owner. */
export async function saveWorkflow(admin: any, actor: Actor, id: string, patch: { status?: string; name?: string; maxSources?: number }): Promise<Out> {
  const d = await docs(admin);
  if (!d) return fail(503, "The configuration could not be read just now.");
  const wfs = resolveWorkflows(d.workflows.draft);
  const w = wfs[id];
  if (!w) return fail(404, "No such workflow.");
  const status = patch.status as WorkflowStatus | undefined;
  if (status !== undefined && !(WORKFLOW_STATUS as readonly string[]).includes(status)) return fail(400, "Choose a status.");
  if (status === "active") {
    const needs = workflowNeeds(w, resolveRegistry(d.registry.draft), { product: "scholar", activity: "learn", isOwner: actor.isOwner });
    if (needs.length) return fail(409, `It cannot be activated yet. It needs: ${needs.join("; ")}.`);
  }
  if ((status === "retired" || (w.status === "paused" && status === "active")) && !actor.isOwner) return fail(403, "Only a platform owner can do this.");
  const nextW: Workflow = { ...w, ...(patch.name ? { name: String(patch.name).slice(0, 80) } : {}), ...(patch.maxSources ? { maxSources: Number(patch.maxSources) } : {}), ...(status ? { status } : {}), version: w.version + 1 };
  const out = await setOverride(admin, actor, RESEARCH_SCOPE, WORKFLOWS_PATH, resolveWorkflows({ ...wfs, [id]: nextW }));
  return out.ok ? { ok: true } : fail(out.status, out.error);
}

export async function publishResearch(admin: any, actor: Actor, note: string | null): Promise<Out> {
  if (!actor.isOwner) return fail(403, "Only a platform owner can publish research configuration.");
  const r = await publishScope(admin, actor, RESEARCH_SCOPE, { label: "Research sources", note });
  return r.ok ? { ok: true, detail: `${r.modules} document(s) published` } : fail(r.status, r.error);
}

export async function rollbackResearch(admin: any, actor: Actor, versionId: string): Promise<Out> {
  if (!actor.isOwner) return fail(403, "Only a platform owner can roll back research configuration.");
  const r = await rollbackVersion(admin, actor, versionId, { scope: RESEARCH_SCOPE, prune: true });
  return r.ok ? { ok: true } : fail(r.status, r.error);
}
