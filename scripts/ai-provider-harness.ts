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
    /ADAPTERS\[provider\]/.test(afterTable)
    && !/provider === "anthropic"|provider === "openai"|provider === "gemini"/.test(afterTable));

  ok("3c. the result names the provider as well as the model",
    /provider: AiProvider;/.test(client) && /model: string;/.test(client));
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
  ok("5a. the grounding verifier names no provider",
    !/anthropic|openai|gemini/i.test(phrasing));
  ok("5b. and it still runs on whatever the model returned, after generation",
    /verifyGrounded\(result\.text/.test(phrasing));

  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
}
main();
