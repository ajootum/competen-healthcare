/* eslint-disable @typescript-eslint/no-explicit-any */
import { runMeteredAi, isMeteredRefusal, type MeteredRefusal } from "./allowance";
import type { GenerateResult } from "./client";
import type { RiskContext } from "./clinical-risk";
import type { AiProduct } from "./fair-use-policy";
import { FAIR_USE_SCOPE } from "./fair-use-policy";
import { findPatientIdentifiers, PII_LABEL } from "@/lib/privacy/patient-identifiers";

// ── HOLDINGS PERSONAL AI ── COMPETEN IND-007 owner decision D3 ────────────────────────────────────────────
//
// ONE personal AI for every product: one engine (this file, through the Holdings allowance in allowance.ts and the
// gateway's generate()), one identity (the person's own account), and no memory -- nothing is kept between
// requests. What differs per product is a PROFILE, held as no-code policy (CONFIG-002, scope platform /
// ai_fair_use, path ai.assistant.<product>):
//   - the modes it offers and the one it opens in. Scholar opens in Teach Me. Professional opens in
//     professional-development assistance, with CPD planning and reflection drafting alongside.
//   - the data it may ground on. Each product has an AUTHORISED set, fixed here, and the profile can only narrow
//     it. Scholar: the person's Passport, the study material its workspace hands over and the person's own
//     recorded learning (programme, level, Scholar progress). Professional: the Passport and the person's own
//     Professional record. Scholar reads the person's own Professional needs and plan ONLY when the published profile
//     lists own_development (the owner decides). Never another person's record, never an employer's.
//
// ⚠ THIS FILE KNOWS NO PRODUCT'S DATA. The product composes the prompt and loads its own authorised data
// (src/lib/individual/personal-ai.ts for Scholar and Professional), and is told which scopes the profile allows.
// Holdings never imports a product's record readers (product separation, individual-professional-harness R2).
//
// ⚠ THE IDENTIFIER SCREEN COMES FIRST. Text that carries a patient identifier (NHS number, date of birth, hospital
// number) is refused before it is classified, metered or sent. The person is told what to remove.
//
// ⚠ THE SUBJECT IS CLASSIFIED, NOT THE MODE (owner D1). Teach Me about insulin is high-risk clinical, whatever
// the button said.

export type AssistantMode = "teach" | "ask" | "development" | "cpd_plan" | "reflection";
/** `own_learning` (Scholar): the person's own recorded programme, level and Scholar progress. `own_development` (Scholar): their own
 *  Professional needs and plan, a cross-experience read that is OFF unless the published profile lists it (the owner decides). */
export type DataScope = "passport" | "professional_record" | "study_context" | "own_learning" | "own_development";

/** The modes each product's assistant can ever offer, and the allowance activity each one is metered as. */
export const PRODUCT_MODES: Record<AiProduct, readonly AssistantMode[]> = { scholar: ["teach", "ask"], professional: ["development", "cpd_plan", "reflection"] };
export const MODE_ACTIVITY: Record<AssistantMode, string> = { teach: "teach", ask: "ask", development: "assistant", cpd_plan: "assistant", reflection: "assistant" };
export const MODE_LABEL: Record<AssistantMode, string> = {
  teach: "Teach me", ask: "Ask about my material", development: "Professional development", cpd_plan: "Plan my CPD", reflection: "Draft a reflection",
};
/** The data each product's assistant is AUTHORISED to read. A profile can narrow this, never widen it. */
export const AUTHORISED_SCOPES: Record<AiProduct, readonly DataScope[]> = { scholar: ["passport", "study_context", "own_learning", "own_development"], professional: ["passport", "professional_record"] };

export type AssistantProfile = { defaultMode: AssistantMode; modes: AssistantMode[]; scopes: DataScope[] };
export const assistantPath = (p: AiProduct) => `ai.assistant.${p}`;
export const DEFAULT_PROFILE: Record<AiProduct, AssistantProfile> = {
  // own_development is authorised but NOT in the default: the owner publishes it to switch the cross-experience read on.
  scholar: { defaultMode: "teach", modes: ["teach", "ask"], scopes: ["passport", "study_context", "own_learning"] },
  professional: { defaultMode: "development", modes: ["development", "cpd_plan", "reflection"], scopes: ["passport", "professional_record"] },
};

/** Pure: a published profile, clamped to what the product may ever offer and read. */
export function resolveAssistantProfile(product: AiProduct, s: any): AssistantProfile {
  const d = DEFAULT_PROFILE[product];
  if (!s || typeof s !== "object") return d;
  const modes = Array.isArray(s.modes) ? PRODUCT_MODES[product].filter(m => s.modes.includes(m)) : d.modes;
  const scopes = Array.isArray(s.scopes) ? AUTHORISED_SCOPES[product].filter(x => s.scopes.includes(x)) : d.scopes;
  const usable = modes.length ? modes : d.modes;
  const defaultMode = usable.includes(s.defaultMode) ? s.defaultMode as AssistantMode : usable.includes(d.defaultMode) ? d.defaultMode : usable[0];
  return { defaultMode, modes: usable, scopes };
}

/** The published profile. Unpublished or unreadable: the default, which is the product's authorised behaviour. */
export async function loadAssistantProfile(admin: any, product: AiProduct): Promise<AssistantProfile> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published")
      .eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).eq("config_path", assistantPath(product)).maybeSingle();
    return resolveAssistantProfile(product, error ? null : data?.published ?? null);
  } catch { return DEFAULT_PROFILE[product]; }
}

/** Pure: the mode a request runs in, from the profile. A mode the profile does not offer is refused, never swapped. */
export function chooseMode(profile: AssistantProfile, requested: unknown): AssistantMode | null {
  if (requested === undefined || requested === null || requested === "") return profile.defaultMode;
  return profile.modes.includes(requested as AssistantMode) ? requested as AssistantMode : null;
}

/** What the product composes for one request, given the mode and the scopes the profile allows. */
export type Composed =
  | { system: string; user: string; maxTokens?: number; /** The scopes whose data was actually read, for the audit row. Defaults to the profile's. */ scopesRead?: readonly DataScope[] }
  | { error: string; status: number };
export type AssistantRequest = {
  userId: string;
  product: AiProduct;
  mode?: unknown;
  requestId: string;
  /** Everything the person typed or handed over, for the identifier screen. */
  screen: readonly string[];
  /** The request's subject, for the clinical risk classification (owner D1). */
  risk: (mode: AssistantMode, scopes: readonly DataScope[]) => RiskContext;
  compose: (mode: AssistantMode, scopes: readonly DataScope[]) => Promise<Composed>;
};
export type AssistantOutcome =
  | { ok: true; answer: string; mode: AssistantMode; model: string; scopesRead: readonly DataScope[] }
  | { ok: false; kind: "invalid"; status: number; error: string }
  | { ok: false; kind: "metered"; refusal: MeteredRefusal }
  | { ok: false; kind: "generation"; result: Extract<GenerateResult, { ok: false }> };

const invalid = (status: number, error: string): AssistantOutcome => ({ ok: false, kind: "invalid", status, error });

/** Run one personal-AI request for one product. The caller has applied its guard and its quota. Never throws for input. */
export async function runPersonalAssistant(admin: any, r: AssistantRequest): Promise<AssistantOutcome> {
  const profile = await loadAssistantProfile(admin, r.product);
  const mode = chooseMode(profile, r.mode);
  if (!mode) return invalid(400, "That kind of help is not offered here.");
  const found = findPatientIdentifiers(r.screen.join("\n"));
  if (found.length) return invalid(422, `Remove the patient-identifiable details first (${[...new Set(found)].map(k => PII_LABEL[k]).join(", ")}). Nothing was sent.`);

  const composed = await r.compose(mode, profile.scopes);
  if ("error" in composed) return invalid(composed.status, composed.error);
  const result = await runMeteredAi(admin, {
    userId: r.userId, product: r.product, activity: MODE_ACTIVITY[mode], requestId: r.requestId,
    generate: {
      system: composed.system,
      user: composed.user,
      tier: "reasoning",
      maxTokens: composed.maxTokens ?? 900,
      context: { userId: r.userId, attribution: { scope: "person" }, operation: `personal_ai_${r.product}_${mode}` },
    },
    risk: r.risk(mode, profile.scopes),
  });
  if (isMeteredRefusal(result)) return { ok: false, kind: "metered", refusal: result };
  if (!result.ok) return { ok: false, kind: "generation", result };
  return { ok: true, answer: result.text, mode, model: result.model, scopesRead: composed.scopesRead ?? profile.scopes };
}
