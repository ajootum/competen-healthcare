/**
 * HQ-USERS-A -- STATIC HARNESS: user-management authority goes through HQ governance, not profiles.role.
 *
 *   npx tsx scripts/hq-users-authority-harness.ts
 *
 * No credentials, no network. Each check has a planted violation that must turn it RED.
 *   U1  no /api/super-admin/users handler decides authority from the legacy profiles.role column
 *   U2  the read (list) opens with hqApiGate(hq.platform.users.view), every write with the owner gate
 *   U3  the owner gate runs the HQ gate first and then requires isOwner -- the view right opens no write
 *   U4  the page hands the owner flag to the workspace, and every account write control sits behind it
 *   U5  "the last super admin" is counted over role AND roles[]
 */
import { readFileSync, existsSync } from "node:fs";

const F = {
  gate: "src/lib/hq/api-gate.ts",
  list: "src/app/api/super-admin/users/list/route.ts",
  actions: "src/app/api/super-admin/users/actions/route.ts",
  users: "src/app/api/super-admin/users/route.ts",
  page: "src/app/super-admin/users/page.tsx",
  ws: "src/app/super-admin/users/UsersWorkspace.tsx",
} as const;
type K = keyof typeof F;
type Src = Map<string, string>;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const RAW: Src = new Map(Object.values(F).map(f => [f, existsSync(f) ? readFileSync(f, "utf8").replace(/\r\n/g, "\n") : ""]));
const code = (src: Src, k: K) => strip(src.get(F[k]) ?? "");

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
type R = { ok: boolean; detail: string };

const LEGACY = /\b(me|profile|caller)\??\.role\s*[!=]==\s*["']super_admin["']|\.select\(["']role(, full_name)?["']\)\.eq\(["']id["'], user\.id\)/;
const checkNoLegacy = (src: Src): R => {
  const bad = (["list", "actions", "users"] as K[]).filter(k => LEGACY.test(code(src, k)));
  return { ok: bad.length === 0, detail: bad.map(k => F[k]).join(", ") };
};

const firstAwaitIs = (body: string, needle: string) => { const a = body.indexOf("await "); return a > -1 && body.indexOf(needle) === a; };
const handlers = (s: string) => [...s.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\([^)]*\) \{([\s\S]*?)\n\}/g)].map(m => ({ verb: m[1], body: m[2] }));
const checkGates = (src: Src): R => {
  const list = handlers(code(src, "list"));
  const listOk = list.length === 1 && list[0].verb === "GET" && firstAwaitIs(list[0].body, `await hqApiGate(["hq.platform.users.view"])`);
  const actions = handlers(code(src, "actions"));
  const actOk = actions.length === 1 && firstAwaitIs(actions[0].body, `await hqOwnerApiGate(["hq.platform.users.view"])`);
  const users = handlers(code(src, "users"));
  const usersOk = users.length === 3 && users.every(h => firstAwaitIs(h.body, "await requireOwner()") && /if \(ctx instanceof NextResponse\) return ctx;/.test(h.body))
    && /async function requireOwner\(\) \{\s*const ctx = await hqOwnerApiGate\(\["hq\.platform\.users\.view"\]\);/.test(code(src, "users"));
  return { ok: listOk && actOk && usersOk, detail: `list ${listOk}, actions ${actOk}, users ${usersOk} (${users.map(h => h.verb).join(",")})` };
};
const checkOwnerGate = (src: Src): R => {
  const s = code(src, "gate");
  const fn = s.slice(s.indexOf("export async function hqOwnerApiGate"));
  return { ok: /const ctx = await hqApiGate\(capabilities\);\s*if \(isHqRefusal\(ctx\)\) return ctx;\s*return ctx\.isOwner \? ctx : NextResponse\.json\(/.test(fn), detail: "hqOwnerApiGate must be hqApiGate, then isOwner" };
};
const checkUi = (src: Src): R => {
  const page = code(src, "page"), ws = code(src, "ws");
  const passes = /const \{ admin, isOwner \} = await requireHqCapability\("hq\.platform\.users\.view"\)/.test(page) && /canManage=\{isOwner\}/.test(page);
  const guarded = [
    /\{canManage && \(\s*<button onClick=\{\(\) => \{ setAddOpen\(true\)/,
    /\{canManage && <>\s*<button onClick=\{\(\) => \{ setBulkOpen\(false\); bulkAct\("send_reset"/,
    /\{canManage && <>\s*<button onClick=\{\(\) => \{ setMenuFor\(null\); act\(u\.id, "send_reset"/,
    /\{canManage && <UserRoleEditor/,
  ].every(r => r.test(ws));
  const unguardedCalls = (ws.match(/act\(u\.id, "(suspend|unsuspend|send_reset|resend_invite)"/g) ?? []).length;
  return { ok: passes && guarded && unguardedCalls === 4, detail: `page passes the owner flag ${passes}, controls guarded ${guarded}` };
};
const checkLastOwner = (src: Src): R => ({
  ok: /if \(estateRolesOf\(target\)\.includes\("super_admin"\)\)/.test(code(src, "users")) && /\.or\("role\.eq\.super_admin,roles\.cs\.\{super_admin\}"\)/.test(code(src, "users")),
  detail: "the last-super-admin guard must read role and roles[]",
});

const plant = (k: K, from: string, to: string): Src => {
  const s = RAW.get(F[k]) ?? ""; const n = s.replace(from, to);
  if (n === s) throw new Error(`plant did not apply in ${F[k]}: ${from.slice(0, 60)}`);
  return new Map([...RAW, [F[k], n]]);
};
const red = (n: string, r: R) => ok(`P. ${n} goes RED`, !r.ok, "the check passed on a planted violation");

console.log("HQ USERS AUTHORITY HARNESS (HQ-USERS-A)\n");
const missing = Object.values(F).filter(f => !RAW.get(f));
ok("0. every pinned file exists", missing.length === 0, missing.join(", "));
const run = (n: string, r: R) => ok(n, r.ok, r.detail);
run("U1. no users API decides authority from profiles.role", checkNoLegacy(RAW));
run("U2. list = hqApiGate(users.view); actions and every users handler = the owner gate, before anything else", checkGates(RAW));
run("U3. the owner gate is the HQ gate followed by isOwner", checkOwnerGate(RAW));
run("U4. the page passes the owner flag and every account write control sits behind it", checkUi(RAW));
run("U5. the last-super-admin guard counts role and roles[]", checkLastOwner(RAW));
console.log("");
red("U1 on a legacy role test", checkNoLegacy(plant("list", `const admin = ctx.admin;`, `const admin = ctx.admin;\n  const me: any = null; if (me?.role !== "super_admin") return null;`)));
red("U2 on a list route that skips the gate", checkGates(plant("list", `const ctx = await hqApiGate(["hq.platform.users.view"]);`, `await Promise.resolve();\n  const ctx = await hqApiGate(["hq.platform.users.view"]);`)));
red("U2 on actions behind the view right only", checkGates(plant("actions", `await hqOwnerApiGate(["hq.platform.users.view"])`, `await hqApiGate(["hq.platform.users.view"])`)));
red("U2 on a users handler that skips requireOwner", checkGates(plant("users", `export async function DELETE(req: Request) {\n  const ctx = await requireOwner();`, `export async function DELETE(req: Request) {\n  await Promise.resolve();\n  const ctx = await requireOwner();`)));
red("U3 on an owner gate that admits any holder", checkOwnerGate(plant("gate", "return ctx.isOwner ? ctx : NextResponse.json(", "return true ? ctx : NextResponse.json(")));
red("U4 on an unguarded reset in the row menu", checkUi(plant("ws", `{canManage && <>\n                            <button onClick={() => { setMenuFor(null); act(u.id, "send_reset"`, `{<>\n                            <button onClick={() => { setMenuFor(null); act(u.id, "send_reset"`)));
red("U4 on a page that hands everyone the controls", checkUi(plant("page", "canManage={isOwner}", "canManage={true}")));
red("U5 on a count over role only", checkLastOwner(plant("users", `.or("role.eq.super_admin,roles.cs.{super_admin}")`, `.eq("role", "super_admin")`)));

console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
process.exit(fails.length ? 1 : 0);
