/**
 * HQ-USERS-B -- STATIC HARNESS: administrator password reset is one governed path.
 *
 *   npx tsx scripts/hq-users-reset-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED.
 *   R1  the reset route is hqApiGate(["hq.platform.users.reset"]) before anything else, POST only
 *   R2  only three places in src send a recovery email: the governed lib, the owner-only invitation
 *       fallback, and the person's own Forgot password page. users/actions no longer has send_reset.
 *   R3  no users route and not the lib builds a return URL from the request (req.url, Host, origin)
 *   R4  the decision keeps the rule's order, the address is the Auth user's, and the answers are fixed text
 *   R5  no audit row the lib writes names an address, a token or a link
 *   R6  the page offers reset to owners and users.reset holders only, through the governed route
 *   R7  migration 379 seeds the capability with grants to chief_executive and platform_director only, data only
 *   R8  the HQ code catalogue declares the capability
 *   R9  the reset page tells the person when an administrator sent the link
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const F = {
  route: "src/app/api/super-admin/users/reset/route.ts",
  lib: "src/lib/hq/user-reset.ts",
  actions: "src/app/api/super-admin/users/actions/route.ts",
  users: "src/app/api/super-admin/users/route.ts",
  page: "src/app/super-admin/users/page.tsx",
  ws: "src/app/super-admin/users/UsersWorkspace.tsx",
  mig: "supabase/migrations/379-hq-platform-users-reset-capability.sql",
  spaces: "src/lib/hq/spaces.ts",
  resetPage: "src/app/reset-password/page.tsx",
  forgot: "src/app/forgot-password/page.tsx",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const read = (f: string) => existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : "";
const RAW: Src = new Map(Object.values(F).map(f => [f, read(f)]));
const code = (src: Src, k: K) => k === "mig" || k === "spaces" ? (src.get(F[k]) ?? "") : strip(src.get(F[k]) ?? "");
const walk = (d: string): string[] => readdirSync(d).flatMap(e => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e) && !/\.test\./.test(e) ? [p.replace(/\\/g, "/")] : []; });
const ALL: Src = new Map(walk("src").map(f => [f, strip(read(f))]));

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };

const checkGate = (src: Src): R => {
  const s = code(src, "route");
  const body = s.slice(s.indexOf("export async function POST"));
  const first = body.indexOf("await "), gate = body.indexOf("await hqApiGate([RESET_CAPABILITY])");
  const cap = /export const RESET_CAPABILITY = "hq\.platform\.users\.reset";/.test(code(src, "lib"));
  return { ok: cap && gate > -1 && gate === first && !/export async function (GET|PUT|PATCH|DELETE)/.test(s), detail: `capability ${cap}, gate at ${gate}, first await at ${first}` };
};
const ALLOWED_SENDERS = new Set([F.lib, F.actions, F.forgot]);
const checkOnePath = (all: Src, src: Src): R => {
  const senders = [...all].filter(([, s]) => /resetPasswordForEmail\(/.test(s)).map(([f]) => f);
  const extra = senders.filter(f => !ALLOWED_SENDERS.has(f as never));
  const a = code(src, "actions");
  const noSendReset = !/"send_reset"/.test(a);
  const actionsOnlyInvite = (a.match(/resetPasswordForEmail\(/g) ?? []).length <= 1 && /if \(action === "resend_invite"\) \{[\s\S]*resetPasswordForEmail\(/.test(a);
  return { ok: extra.length === 0 && noSendReset && actionsOnlyInvite, detail: `other senders: ${extra.join(", ")}; actions send_reset gone ${noSendReset}, invite-only ${actionsOnlyInvite}` };
};
const REQUEST_ORIGIN = /new URL\(req\.url\)\.origin|req\.nextUrl\.origin|headers\(\)[\s\S]{0,40}\.get\(["'](host|origin|x-forwarded-host)["']\)|req\.headers\.get\(["'](host|origin|x-forwarded-host)["']\)/;
const checkTrustedOrigin = (src: Src): R => {
  const bad = (["route", "lib", "actions", "users"] as K[]).filter(k => REQUEST_ORIGIN.test(code(src, k)));
  const lib = /export const resetReturnUrl = \(\) => `\$\{SITE_URL\}\/reset-password\?initiated=admin`;/.test(code(src, "lib"));
  return { ok: bad.length === 0 && lib, detail: `request-derived origin in: ${bad.map(k => F[k]).join(", ")}; lib uses SITE_URL ${lib}` };
};
const checkDecision = (src: Src): R => {
  const s = code(src, "lib");
  const fn = s.slice(s.indexOf("export function decideReset"), s.indexOf("export function responseFor"));
  const order = ["i.targetId === i.actorId", "i.sentByActor >= ACTOR_LIMIT", "if (!i.target)", "i.target.isOwnerAccount && !i.actorIsOwner", "i.target.suspended", "!i.target.emailVerified", "i.sentForTarget >= TARGET_LIMIT"].map(n => fn.indexOf(n));
  const ordered = order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1]));
  const authEmail = /email: au\.user\.email \?\? null,/.test(s) && /emailVerified: !!au\.user\.email_confirmed_at,/.test(s) && !/profiles"\)\.select\([^)]*email/.test(s);
  const limits = /export const TARGET_LIMIT = 3;/.test(s) && /export const ACTOR_LIMIT = 20;/.test(s) && /export const WINDOW_MS = 3_600_000;/.test(s);
  const fixed = /return \{ status: 202, body: \{ ok: true, message: NEUTRAL_MESSAGE \} \};/.test(s) && !/body: \{[^}]*(target|email|link|url)/i.test(s.slice(s.indexOf("export function responseFor"), s.indexOf("export function isSuspended")));
  const dbClock = /const at: string = attempt\.data\.created_at;/.test(s) && /isSuspended\(au\.user\.banned_until, p\?\.account_status, at\)/.test(s) && !/Date\.now\(\)/.test(s);
  return { ok: ordered && authEmail && limits && fixed && dbClock, detail: `order ${ordered}, auth email ${authEmail}, 3/20/hour ${limits}, fixed answers ${fixed}, DB clock ${dbClock}` };
};
const checkAuditClean = (src: Src): R => {
  const s = code(src, "lib");
  const values = [...s.matchAll(/audit\(admin, actor, [A-Z_]+, targetId, (\{[^}]*\})\)/g)].map(m => m[1]);
  const bad = values.filter(v => /email|token|link|url|redirect|target\.email/i.test(v));
  return { ok: values.length >= 5 && bad.length === 0, detail: `${values.length} audit writes, offending: ${bad.join(" | ")}` };
};
const checkUi = (src: Src): R => {
  const page = code(src, "page"), ws = code(src, "ws");
  const flag = /canReset=\{isOwner \|\| capabilities\.includes\("hq\.platform\.users\.reset"\)\}/.test(page);
  const route = /action === "send_reset"\s*\?\s*fetch\("\/api\/super-admin\/users\/reset"/.test(ws);
  const guarded = /\{canReset && \(\s*<button onClick=\{\(\) => \{ setBulkOpen\(false\); bulkAct\("send_reset"/.test(ws) && /\{canReset && u\.id !== currentUserId && \(\s*<button onClick=\{\(\) => \{ setMenuFor\(null\); act\(u\.id, "send_reset"/.test(ws);
  return { ok: flag && route && guarded, detail: `flag ${flag}, governed route ${route}, guarded ${guarded}` };
};
const checkMigration = (src: Src): R => {
  const m = code(src, "mig").split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  const cap = /insert into hq_capability \(code, space, label, description\) values\s+\('hq\.platform\.users\.reset', 'platform'/.test(m);
  const grants = /from \(values \('chief_executive'\), \('platform_director'\)\) as p\(code\)\s+cross join \(values \('hq\.platform\.users\.reset'\)\) as c\(code\)/.test(m);
  const ddl = /\b(create|alter|drop|truncate|update|delete|grant|revoke)\b/i.test(m);
  return { ok: cap && grants && !ddl && /notify pgrst, 'reload schema';\s*$/.test(m), detail: `cap ${cap}, grants ${grants}, ddl ${ddl}` };
};
const checkCatalogue = (src: Src): R => ({ ok: /\{ code: "hq\.platform\.users\.reset",\s+space: "platform"\s+\}/.test(code(src, "spaces")), detail: "spaces.ts must declare hq.platform.users.reset" });
const checkResetPage = (src: Src): R => ({
  ok: /setFromAdmin\(isAdminInitiated\(window\.location\.search\)\)/.test(code(src, "resetPage")) && /\{fromAdmin && \(/.test(code(src, "resetPage")),
  detail: "the reset page must read ?initiated=admin and say so",
});

const plant = (k: K, from: string, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${from.slice(0, 70)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");

console.log("HQ USERS RESET HARNESS (HQ-USERS-B)\n");
const missing = Object.values(F).filter(f => !RAW.get(f));
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
const run = (n: string, r: R) => ok(n, r.ok, r.detail);
run("R1. the reset route is hqApiGate(hq.platform.users.reset) first, POST only", checkGate(RAW));
run("R2. one governed sender; actions keeps only the owner-only invitation fallback", checkOnePath(ALL, RAW));
run("R3. no return URL is built from the request", checkTrustedOrigin(RAW));
run("R4. the decision order, the Auth address, 3/20 an hour, fixed answers, the DB clock", checkDecision(RAW));
run("R5. no audit row names an address, a token or a link", checkAuditClean(RAW));
run("R6. reset is offered to owners and users.reset holders, through the governed route", checkUi(RAW));
run("R7. 379 seeds the capability and its two grants together, data only", checkMigration(RAW));
run("R8. the HQ code catalogue declares hq.platform.users.reset", checkCatalogue(RAW));
run("R9. the reset page says when an administrator sent the link", checkResetPage(RAW));
console.log("");
red("R1 on a route gated by the view right", checkGate(plant("route", "await hqApiGate([RESET_CAPABILITY])", `await hqApiGate(["hq.platform.users.view"])`)));
red("R2 on send_reset back in actions", checkOnePath(ALL, plant("actions", `type Action = "suspend" | "unsuspend" | "resend_invite";`, `type Action = "suspend" | "unsuspend" | "resend_invite" | "send_reset";`)));
red("R2 on a second sender elsewhere", checkOnePath(new Map([...ALL, ["src/app/api/rogue/route.ts", "admin.auth.resetPasswordForEmail(x)"]]), RAW));
red("R3 on a request-derived origin", checkTrustedOrigin(plant("users", "const origin = SITE_URL;", "const origin = new URL(req.url).origin;")));
red("R4 on the owner rule moved after the send checks", checkDecision(plant("lib", `  if (i.target.isOwnerAccount && !i.actorIsOwner) return { kind: "refuse", reason: "owner_target" };\n`, "")));
red("R4 on the profiles address", checkDecision(plant("lib", "email: au.user.email ?? null,", "email: p?.email ?? null,")));
red("R4 on an app-clock window", checkDecision(plant("lib", "const at: string = attempt.data.created_at;", "const at: string = new Date(Date.now()).toISOString();")));
red("R4 on an answer that names the target", checkDecision(plant("lib", "return { status: 202, body: { ok: true, message: NEUTRAL_MESSAGE } };", "return { status: 202, body: { ok: true, message: NEUTRAL_MESSAGE, target: 1 } };")));
red("R5 on an address in the audit", checkAuditClean(plant("lib", `{ initiated_by: "administrator", channel: "supabase_recovery" }`, `{ initiated_by: "administrator", email: target.email }`)));
red("R6 on reset sent to the owner-only actions route", checkUi(plant("ws", `? fetch("/api/super-admin/users/reset"`, `? fetch("/api/super-admin/users/actions"`)));
red("R6 on reset offered to every viewer", checkUi(plant("page", `canReset={isOwner || capabilities.includes("hq.platform.users.reset")}`, "canReset={true}")));
red("R7 on a grant to a third position", checkMigration(plant("mig", "(values ('chief_executive'), ('platform_director')) as p(code)", "(values ('chief_executive'), ('platform_director'), ('individual_product_administrator')) as p(code)")));
red("R7 on DDL in the data-only file", checkMigration(plant("mig", "notify pgrst, 'reload schema';", "create view v as select 1;\nnotify pgrst, 'reload schema';")));
red("R8 on a missing catalogue entry", checkCatalogue(plant("spaces", `{ code: "hq.platform.users.reset",`, `{ code: "hq.platform.users.reset_x",`)));
red("R9 on a page that ignores the marker", checkResetPage(plant("resetPage", "setFromAdmin(isAdminInitiated(window.location.search));", "")));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
