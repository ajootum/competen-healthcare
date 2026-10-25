/* eslint-disable @typescript-eslint/no-explicit-any */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AI_PROVIDERS } from "./config";

// ── NO-CODE AI PROVIDER REGISTRATION ── owner "COMPETEN HOLDINGS — NO-CODE AI PROVIDER EXTENSIBILITY", 25 Oct 2026 ──────
//
// A provider that speaks a VERIFIED COMPATIBLE protocol can be registered from HQ without code or SQL, and is then
// routed, priced, evaluated, made eligible and metered through the SAME gateway, routing, pricing, eligibility and
// fair-use engine as Anthropic, OpenAI and Gemini. One protocol is supported: the OpenAI chat-completions protocol
// (POST {endpoint}/chat/completions), which the existing OpenAI adapter already speaks. Anything else needs an adapter
// in code, and the registration says so instead of pretending.
//
// The registry is the CONFIG-002 document `ai.provider_registry` in the AI governance scope (platform / ai_fair_use),
// edited on /super-admin/ai/fair-use under hq.platform.ai.manage and published with the other AI policies.
//
// ⚠ CREDENTIALS NEVER LIVE HERE. A registered provider's key is the environment variable AI_PROVIDER_KEY_<ID>, its
// NAME DERIVED from the provider id -- never typed by an administrator, so configuration cannot point a provider at
// another secret (the service key, another vendor's key). The value is never read into configuration, never returned to
// a browser, and redacted from every error message.
//
// ⚠ ONLY APPROVED ENDPOINTS (SSRF). An endpoint must be https, on the default port, carry no user-info, be a host the
// DEPLOYMENT allowlists (AI_PROVIDER_ALLOWED_HOSTS -- so HQ configuration alone can never send user content to a new
// host), and not be a loopback, private, link-local, metadata or internal name. The address is checked again at CALL
// time, after DNS resolution, and redirects are refused.
//
// ⚠ INACTIVE AND CLINICALLY UNAPPROVED BY DEFAULT. A registration starts inactive and is never routed. Activation is a
// separate audited act that requires four recorded checks -- connectivity and capability (run by the server with a
// synthetic prompt, never user content), privacy and security (attested by the administrator). Clinical eligibility is
// separate again: an ai_model_eligibility row from an activity-specific evaluation, exactly as for every provider.

export const PROVIDER_REGISTRY_PATH = "ai.provider_registry";
export const SUPPORTED_PROTOCOLS = ["openai_chat_completions"] as const;
export type Protocol = typeof SUPPORTED_PROTOCOLS[number];
export const PROVIDER_ID = /^[a-z][a-z0-9]{1,30}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{1,99}$/i;
const TIERS = ["cheap", "reasoning", "heavy"] as const;
type Tier = typeof TIERS[number];

export type CheckRecord = { at: string; by: string | null; ok: boolean; detail: string | null };
export type RegisteredProvider = {
  id: string; label: string; protocol: Protocol; endpoint: string;
  models: Partial<Record<Tier, string>>; maxOutputTokens: number;
  status: "inactive" | "active";
  checks: { connectivity?: CheckRecord; capability?: CheckRecord; privacy?: CheckRecord & { termsRef: string; region: string; noTraining: boolean }; security?: CheckRecord };
};
export type ProviderRegistry = Record<string, RegisteredProvider>;

/** The environment variable that holds a registered provider's key. Derived, never configured. */
export const credentialEnvName = (id: string) => `AI_PROVIDER_KEY_${id.toUpperCase()}`;
/** The key, from the environment only. Callers use it to authenticate and nothing else. */
export const registeredKey = (id: string, env: Record<string, string | undefined> = process.env) => (PROVIDER_ID.test(id) ? env[credentialEnvName(id)] ?? null : null);

/** The hosts this DEPLOYMENT permits registered providers to use. Empty: none. */
export const allowedHosts = (env: Record<string, string | undefined> = process.env) =>
  (env.AI_PROVIDER_ALLOWED_HOSTS ?? "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);

const BLOCKED_NAMES = /^(localhost|metadata|metadata\.google\.internal|instance-data)$|\.(local|localhost|internal|intranet|lan|home|corp)$/i;

/** Pure: is an IP address private, loopback, link-local, carrier-grade NAT, metadata, multicast or unspecified? */
export function isNonPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isNonPublicIp(mapped[1]);
    return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
  }
  return true;   // not an IP at all: never treated as public
}

/** Pure: an endpoint a registered provider may use, or the reason it may not. */
export function checkEndpoint(raw: unknown, env: Record<string, string | undefined> = process.env): { ok: true; url: string; host: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.length > 300) return { ok: false, reason: "Give the provider's https endpoint." };
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: "That is not a valid URL." }; }
  if (u.protocol !== "https:") return { ok: false, reason: "Only https endpoints are accepted." };
  if (u.username || u.password) return { ok: false, reason: "An endpoint must not carry credentials." };
  if (u.port && u.port !== "443") return { ok: false, reason: "Only the default https port is accepted." };
  if (u.search || u.hash) return { ok: false, reason: "An endpoint has no query or fragment." };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(host) && isNonPublicIp(host)) return { ok: false, reason: "That address is not public." };
  if (isIP(host)) return { ok: false, reason: "Use the provider's host name, not an IP address." };
  if (BLOCKED_NAMES.test(host) || !host.includes(".")) return { ok: false, reason: "That host is not a public provider host." };
  if (!allowedHosts(env).includes(host)) return { ok: false, reason: `This deployment does not permit ${host}. The owner adds it to AI_PROVIDER_ALLOWED_HOSTS.` };
  return { ok: true, url: u.origin + u.pathname.replace(/\/+$/, ""), host };
}

/** At CALL time: the host must still be allowlisted and must resolve only to public addresses. */
export async function checkEndpointResolves(endpoint: string, env: Record<string, string | undefined> = process.env,
  resolve: (host: string) => Promise<{ address: string }[]> = h => lookup(h, { all: true, verbatim: true })): Promise<{ ok: true } | { ok: false; reason: string }> {
  const e = checkEndpoint(endpoint, env);
  if (!e.ok) return e;
  try {
    const addrs = await resolve(e.host);
    if (!addrs.length || addrs.some(a => isNonPublicIp(a.address))) return { ok: false, reason: `${e.host} resolves to an address that is not public.` };
    return { ok: true };
  } catch { return { ok: false, reason: `${e.host} could not be resolved.` }; }
}

/** Pure: a check record as stored. Only the server's actions write these, never a draft from the browser. */
const record = (v: any): CheckRecord | undefined => (v && typeof v.at === "string" && typeof v.ok === "boolean"
  ? { at: v.at, by: typeof v.by === "string" ? v.by : null, ok: v.ok, detail: typeof v.detail === "string" ? v.detail.slice(0, 300) : null } : undefined);

/**
 * Pure: the registry, kept to its known fields. A built-in provider's name cannot be registered. An unsupported
 * protocol, or an endpoint the deployment does not permit, keeps the entry INACTIVE whatever it says.
 */
export function resolveRegistry(s: any, env: Record<string, string | undefined> = process.env): ProviderRegistry {
  const out: ProviderRegistry = {};
  for (const [id, v] of Object.entries(s && typeof s === "object" ? s : {}).slice(0, 20) as [string, any][]) {
    if (!PROVIDER_ID.test(id) || (AI_PROVIDERS as readonly string[]).includes(id)) continue;
    const protocol = (SUPPORTED_PROTOCOLS as readonly string[]).includes(v?.protocol) ? v.protocol as Protocol : null;
    const ep = checkEndpoint(v?.endpoint, env);
    const models: Partial<Record<Tier, string>> = {};
    for (const t of TIERS) if (typeof v?.models?.[t] === "string" && MODEL_ID.test(v.models[t].trim())) models[t] = v.models[t].trim();
    const checks = v?.checks ?? {};
    const privacy = record(checks.privacy);
    const entry: RegisteredProvider = {
      id, label: typeof v?.label === "string" && v.label.trim() ? v.label.trim().slice(0, 80) : id,
      protocol: protocol ?? "openai_chat_completions", endpoint: ep.ok ? ep.url : "", models,
      maxOutputTokens: Number.isInteger(v?.maxOutputTokens) ? Math.min(32000, Math.max(16, v.maxOutputTokens)) : 1500,
      status: "inactive",
      checks: {
        connectivity: record(checks.connectivity), capability: record(checks.capability), security: record(checks.security),
        privacy: privacy ? { ...privacy, termsRef: String(checks.privacy.termsRef ?? "").slice(0, 300), region: String(checks.privacy.region ?? "").slice(0, 80), noTraining: checks.privacy.noTraining === true } : undefined,
      },
    };
    entry.status = v?.status === "active" && protocol && ep.ok && activationProblems(entry).length === 0 ? "active" : "inactive";
    out[id] = entry;
  }
  return out;
}

/** Pure: what stops a registration being activated. Empty: it may be activated (and published). */
export function activationProblems(p: RegisteredProvider): string[] {
  const out: string[] = [];
  if (!p.endpoint) out.push("an approved https endpoint");
  if (!Object.keys(p.models).length) out.push("at least one model");
  const c = p.checks;
  if (!c.connectivity?.ok) out.push("a passed connectivity check");
  if (!c.capability?.ok) out.push("a passed capability check (text, and token usage reported for accounting)");
  if (!c.privacy?.ok || !c.privacy.termsRef || !c.privacy.region || !c.privacy.noTraining) out.push("a recorded privacy check (data-processing terms, processing region, no training on user content)");
  if (!c.security?.ok) out.push("a recorded security check");
  return out;
}

/** Whether a registered provider can be routed now: active, its key in the environment, its host still permitted. */
export const registeredAvailable = (p: RegisteredProvider, env: Record<string, string | undefined> = process.env) =>
  p.status === "active" && !!registeredKey(p.id, env) && checkEndpoint(p.endpoint, env).ok;

/** Remove a secret from any text before it is shown or logged. */
export const redact = (text: string, secret: string | null) => (secret && secret.length >= 6 ? text.split(secret).join("[redacted]") : text);
