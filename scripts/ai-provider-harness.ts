/**
 * CPR-AI-PROV -- EXPLICIT PER-DEPLOYMENT PROVIDER SELECTION.
 *
 * Owner decision 2026-08-24: a deployment names its provider in AI_PRIMARY_PROVIDER. API keys report
 * AVAILABILITY and must not determine PREFERENCE.
 *
 * WHAT THIS REPLACED, and why it is worth a harness of its own. The provider used to be whichever key
 * was present, tested in a fixed order. That is inference, and it fails in two directions that both
 * look like nothing happening: adding a second key to try another vendor changed nothing, because the
 * first branch still won -- and removing the first key changed the vendor every patient record is sent
 * to, silently, because the second branch then won. Neither shows up in a log.
 *
 * ⚠ THE ASSERTION THAT MATTERS MOST IS SECTION 4. A safety refusal must never be retried against
 * another vendor. Retrying it is provider shopping -- asking vendors in turn until one agrees to say
 * what the first declined to say -- and in a clinical product that is the worst thing this subsystem
 * could learn to do. It is checked structurally, because there is no fallback to exercise yet: the
 * point is to make ADDING one have to confront this file.
 *
 *   npx --yes tsx scripts/ai-provider-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import { AI_PROVIDERS, aiStatus, availableProviders, primaryProvider } from "../src/lib/ai/config";
import { clinicalGate, resolveModelRouting, routeCandidates, selectRoute, type Route } from "../src/lib/ai/model-routing";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n\r]*/g, "$1");

/** Run a thunk with a scrubbed, then patched, environment. Restored whatever happens. */
function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const keys = ["AI_PRIMARY_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) process.env[k] = v;
    return fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

function main() {
  console.log("\nCPR-AI-PROV -- PER-DEPLOYMENT PROVIDER SELECTION\n");

  // ── 1. A KEY IS AVAILABILITY, NEVER PREFERENCE ──────────────────────────────────────────────────
  //
  // The old behaviour in one line: with both keys present, Anthropic won because it was tested first.
  // Now the named provider wins, whichever keys exist.
  ok("1a. the named provider is used even when another vendor's key is also present",
    withEnv({ AI_PRIMARY_PROVIDER: "openai", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b" },
      () => aiStatus().provider) === "openai");

  ok("1b. and the same keys with a different name give a different provider",
    withEnv({ AI_PRIMARY_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" },
      () => aiStatus().provider) === "gemini");

  // ⚠ THE FAILURE THE OLD CODE COULD NOT EXPRESS. Naming a provider whose key is absent is a
  // MISCONFIGURATION, and it must be reported as one -- not quietly served by whichever vendor has a
  // key. This is the assertion that would have caught the silent vendor switch.
  const misconfigured = withEnv({ AI_PRIMARY_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a" }, () => aiStatus());
  ok("1c. naming a provider with no key reports it unusable rather than falling back",
    misconfigured.provider === "gemini" && !misconfigured.configured && !misconfigured.canGenerate);
  ok("1d. and it still reports what a key IS held for, as diagnostics",
    misconfigured.available.join(",") === "anthropic");

  ok("1e. a name that is not a provider refuses rather than guessing",
    withEnv({ AI_PRIMARY_PROVIDER: "acme", ANTHROPIC_API_KEY: "a" },
      () => aiStatus().provider) === null);

  // ── 2. THE DEFAULT IS A CONSTANT, NOT A GUESS ───────────────────────────────────────────────────
  //
  // Production ran without AI_PRIMARY_PROVIDER the day this landed, so the unset case must keep
  // working. It must NOT do so by reading the keys, or the inference is back.
  ok("2a. unset names anthropic, so an existing deployment keeps working",
    withEnv({ ANTHROPIC_API_KEY: "a" }, () => aiStatus().provider) === "anthropic");
  ok("2b. ⚠ and unset STILL names anthropic when only another vendor holds a key",
    withEnv({ GEMINI_API_KEY: "g" }, () => primaryProvider()) === "anthropic");
  ok("2c. so that deployment reports unusable rather than silently using the vendor it has",
    withEnv({ GEMINI_API_KEY: "g" }, () => aiStatus().canGenerate) === false);
  ok("2d. with nothing at all, nothing is configured",
    withEnv({}, () => aiStatus().configured) === false);

  ok("2e. availability lists every key held, and nothing chooses from it",
    withEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" },
      () => availableProviders().join(",")) === "anthropic,openai,gemini");

  // ── 3. ONE CONTRACT, THREE ADAPTERS ─────────────────────────────────────────────────────────────
  const client = strip(read("src/lib/ai/client.ts"));
  ok("3a. every provider has an adapter",
    AI_PROVIDERS.every(p => new RegExp(`${p}:\\s*${p}Adapter`).test(client)),
    AI_PROVIDERS.filter(p => !new RegExp(`${p}:\\s*${p}Adapter`).test(client)).join(", "));

  // The dispatcher must not know vendor names outside the adapter table -- that is what makes
  // everything downstream provider-independent.
  const afterTable = client.slice(client.indexOf("const ADAPTERS"));
  ok("3b. the dispatcher selects by table rather than branching on the vendor",
    /ADAPTERS\[provider( as AiProvider)?\]/.test(afterTable)
    && !/provider === "anthropic"|provider === "openai"|provider === "gemini"/.test(afterTable));

  ok("3c. the result names the provider as well as the model",
    /provider: (AiProvider|string);/.test(client) && /model: string;/.test(client));
  ok("3d. and usage telemetry records both",
    /provider,\n\s+model,/.test(client) || /provider,[\s\S]{0,80}model,/.test(client));

  // A model returned by the vendor can differ from the one requested -- a version suffix, a silent
  // upgrade. The log should say what ANSWERED.
  ok("3e. the usage row records the model the vendor returned, not the one requested",
    /recordAiUsage\(\{ \.\.\.base, model: result\.model,/.test(client));

  // ── 4. ⚠ NO PROVIDER SHOPPING ───────────────────────────────────────────────────────────────────
  //
  // The rule that outlives any future fallback policy. Checked structurally because there is nothing
  // to exercise yet, and that is exactly why it is worth pinning: the next person to enable fallback
  // must edit lines that say this.
  ok("4a. fallback is disabled",
    /const FALLBACK_ENABLED = false;/.test(client));
  ok("4b. a refusal is not in the failover-eligible set",
    /FAILOVER_ELIGIBLE: ReadonlyArray<"failed">/.test(client)
    && !/FAILOVER_ELIGIBLE[^=]*=\s*\[[^\]]*refusal/.test(client));
  ok("4c. and the fallback branch excludes a refusal explicitly, not only by omission",
    /FALLBACK_ENABLED && result\.kind !== "refusal"/.test(client));

  // A refusal must reach the caller as a refusal. Collapsing it into a generic failure is how it would
  // become retryable later without anyone deciding to make it so.
  ok("4d. a refusal is returned as its own outcome, distinct from a transport failure",
    /error: "refusal"/.test(client) && /error: "failed"/.test(client));

  // ── 5. WHAT STAYS PROVIDER-INDEPENDENT ──────────────────────────────────────────────────────────
  //
  // The grounding check is the product's safety control, and it must not vary with the vendor.
  const phrasing = strip(read("src/lib/practice/document-phrasing.ts"));
  // The verifier itself now lives in Holdings (src/lib/ai/grounding.ts); the phrasing module re-exports it.
  ok("5a. the grounding verifier names no provider",
    !/anthropic|openai|gemini/i.test(phrasing) && !/anthropic|openai|gemini/i.test(strip(read("src/lib/ai/grounding.ts"))));
  ok("5b. and it still runs on whatever the model returned, after generation",
    /verifyGrounded\(result\.text/.test(phrasing));

  // ── 6. NO-CODE MODEL ROUTING (owner MULTI-PROVIDER AI DIRECTION, 25 October 2026) ──────────────────────────────
  //
  // Anthropic, OpenAI and Gemini are first-class providers of one gateway. Routing is configuration, credentials are
  // not. And a clinical request never falls back to a model that is not eligible.
  const r6 = (sel: typeof selectRoute, resolve: typeof resolveModelRouting) => {
    const OPUS: Route = { provider: "anthropic", model: "claude-opus-4-8" }, SONNET: Route = { provider: "anthropic", model: "claude-sonnet-4-6" };
    const doc = resolve({
      providers: { anthropic: { enabled: true, models: { heavy: "claude-opus-4-8", reasoning: "claude-sonnet-4-6" } }, openai: { enabled: true, models: { heavy: "gpt-4o", reasoning: "gpt-4o" }, key: "not-a-real-credential" }, gemini: { enabled: false, models: { heavy: "gemini-2.0-pro" } } },
      tiers: { cheap: [], reasoning: ["openai", "anthropic"], heavy: ["gemini", "openai", "anthropic"] }, apiKey: "not-a-real-credential",
    });
    const heavy = routeCandidates(doc, SONNET, { product: "scholar", activity: "explain", tier: "heavy" });
    const eligibleOpus = [{ activity: "explain", provider: "anthropic", model_prefix: "claude-opus-4-8", eligible: true, max_risk_tier: "clinical_educational" }];
    return {
      legacy: JSON.stringify(routeCandidates(resolve(null), SONNET, { product: "scholar", activity: "x", tier: "reasoning" })) === JSON.stringify([SONNET]),
      eligibleAlt: JSON.stringify(sel(heavy, ["anthropic", "openai"], clinicalGate(eligibleOpus, "explain", "clinical_educational"))) === JSON.stringify(OPUS),
      neverIneligible: sel(heavy, ["openai"], clinicalGate(eligibleOpus, "explain", "clinical_educational")) === null && sel(heavy, ["anthropic", "openai"], clinicalGate([], "explain", "clinical_educational")) === null,
      keylessSkipped: JSON.stringify(sel(routeCandidates(doc, SONNET, { product: "scholar", activity: "teach", tier: "reasoning" }), ["anthropic"], () => true)) === JSON.stringify(SONNET),
      disabledNever: !heavy.some(c => c.provider === "gemini"),
      noCredential: !/not-a-real-credential|"key"|apiKey/.test(JSON.stringify(doc)),
    };
  };
  const ok6 = r6(selectRoute, resolveModelRouting);
  ok("6a. unpublished routing is exactly today: the primary provider and its tier model", ok6.legacy);
  ok("6b. ⚠ a clinical request takes an ALTERNATIVE only when it is itself eligible", ok6.eligibleAlt);
  ok("6c. ⚠ and never a non-eligible model, whatever else is keyed", ok6.neverIneligible);
  ok("6d. a provider with no key is skipped at selection, not an error, and a disabled one is never used", ok6.keylessSkipped && ok6.disabledNever);
  ok("6e. ⚠ no credential survives the routing document: only its known fields are kept", ok6.noCredential);
  const clientSrc = strip(read("src/lib/ai/client.ts")), engineSrc = strip(read("src/lib/ai/allowance.ts"));
  ok("6f. a routed call takes its key from the environment, by the routed provider, never from the route",
    /const provider = route\?\.provider \?\? status\.provider!;[\s\S]{0,300}?const key = registered \? registeredKey\(provider\) : providerKey\(provider\);/.test(clientSrc)
    && /route\?: \{ provider: string; model: string; endpoint\?: string \};/.test(clientSrc) && !/route\?: \{[^}]*key/i.test(clientSrc));
  ok("6g. the metered path reserves and generates on the SAME route the routing chose",
    /p_provider: status\.provider, p_model: model/.test(engineSrc) && /const status = \{ provider: route\.provider \};\s*const model = route\.model;/.test(engineSrc) && /generate\(\{ \.\.\.m\.generate, tier: m\.tier, maxTokens: maxOut, route \}\)/.test(engineSrc));
  const walk = (d: string): string[] => fs.readdirSync(path.join(root, d), { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name).split(path.sep).join("/")] : []);
  const sdkUsers = ["scripts", "src"].flatMap(d => walk(d)).filter(f => /from "@anthropic-ai\/sdk"|from "openai"|from "@google\/(genai|generative-ai)"/.test(read(f)));
  // src/app/api/copilot/route.ts is a known, pre-existing direct use (Enterprise), named as a follow-up, not widened.
  ok("6h. no new code reaches a vendor SDK directly: only the gateway (and the one named follow-up)",
    sdkUsers.filter(f => f !== "src/lib/ai/client.ts" && f !== "src/app/api/copilot/route.ts" && f !== "scripts/ai-provider-harness.ts").length === 0, sdkUsers.join(", "));

  // ── 7. PROVIDER REGISTRATION (owner NO-CODE AI PROVIDER EXTENSIBILITY) ───────────────────────────────────────────
  //
  // One compatible protocol, credentials named by derivation not configuration, approved endpoints re-checked at call
  // time with redirects refused, and an inactive provider never routed.
  const reg7 = (regSrc: string, cliSrc: string, engSrc: string) => ({
    oneProtocol: /export const SUPPORTED_PROTOCOLS = \["openai_chat_completions"\] as const;/.test(regSrc),
    derivedKey: /export const credentialEnvName = \(id: string\) => `AI_PROVIDER_KEY_\$\{id\.toUpperCase\(\)\}`;/.test(regSrc)
      && /registeredKey = \(id: string, env[^)]*\) => \(PROVIDER_ID\.test\(id\) \? env\[credentialEnvName\(id\)\]/.test(regSrc),
    callTime: /if \(registered\) \{\s*const reach = await checkEndpointResolves\(route!\.endpoint!\);\s*if \(!reach\.ok\) return/.test(cliSrc)
      && cliSrc.indexOf("checkEndpointResolves(route!.endpoint!)") < cliSrc.indexOf("compatibleAdapter(route!.endpoint!, args)"),
    noRedirect: /async function compatibleAdapter[\s\S]{0,200}?redirect: "error"/.test(cliSrc),
    inactiveNever: /\.filter\(p => registeredAvailable\(p\)\)\.map\(p => p\.id\)/.test(engSrc),
  });
  const regSrc = strip(read("src/lib/ai/provider-registry.ts"));
  const r7 = reg7(regSrc, clientSrc, engineSrc);
  ok("7a. one protocol is configurable without code (OpenAI chat completions). Anything else is reported as needing an adapter", r7.oneProtocol);
  ok("7b. ⚠ a registered provider's key is AI_PROVIDER_KEY_<ID>, derived, so configuration cannot name another secret", r7.derivedKey);
  ok("7c. ⚠ its endpoint is checked again at call time, after DNS resolution, before anything is sent", r7.callTime);
  ok("7d. ⚠ and a redirect is refused, so an approved host cannot hand the request on", r7.noRedirect);
  ok("7e. ⚠ an inactive provider is never routed", r7.inactiveNever);

  // Planted failures: each 6 check must go red on one violation.
  const red6 = (label: string, cond: boolean) => ok(`P. ${label} goes RED`, !cond);
  red6("6b/6c with a gate that ignores eligibility", r6((c, a) => c.find(x => a.includes(x.provider)) ?? null, resolveModelRouting).neverIneligible);
  red6("6e with a resolver that keeps every field", r6(selectRoute, (x: unknown) => ({ ...resolveModelRouting(x), extra: x })).noCredential);
  red6("6d with a selector that ignores keys", r6((c, _a, g) => c.find(g) ?? null, resolveModelRouting).keylessSkipped);
  red6("7b with a configurable credential name", reg7(regSrc.replace("env[credentialEnvName(id)]", "env[cfg.credentialEnv]"), clientSrc, engineSrc).derivedKey);
  red6("7c with no call-time check", reg7(regSrc, clientSrc.replace("const reach = await checkEndpointResolves(route!.endpoint!);", "const reach = { ok: true };"), engineSrc).callTime);
  red6("7d with redirects followed", reg7(regSrc, clientSrc.replace('method: "POST", redirect: "error",', 'method: "POST",'), engineSrc).noRedirect);
  red6("7e with inactive providers routed", reg7(regSrc, clientSrc, engineSrc.replace(".filter(p => registeredAvailable(p)).map(p => p.id)", ".map(p => p.id)")).inactiveNever);

  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
}
main();
