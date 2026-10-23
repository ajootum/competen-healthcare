/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * INDIVIDUAL ACCESS HARNESS -- COMPETEN-IND-ACCESS-001 s6, over HTTP, STAGING ONLY.
 *
 * Login, routing and the HQ pilot grant, exercised the way a person and an administrator meet them: real
 * sign-ins through /api/auth/login, real session cookies, real redirects (read with redirect: "manual"),
 * and the HQ grant made through /api/hq/individual/grants by an appointed administrator -- never by SQL.
 *
 *   S1  Scholar-only invitation          S6  Uninvited user
 *   S2  Professional-only invitation     S7  Deep-link authentication and destination preservation
 *   S3  Both experiences active          S8  Primary-experience preference and switching
 *   S4  Existing account, new grant      S9  Signed-out, unauthorised (the gate-OFF half: see the note)
 *   S5  Expired / revoked / ended        H   HQ grant refusals: self, 18+, past end date, no capability
 *   I   Invitations for people without an account (migration 378): one identity, no other membership or
 *       estate role, duplicates refused, the real invite link followed, accept, revoke, expiry, schema.
 *       Needs the dev server started with INDIVIDUAL_INVITE_TEST_DELIVERY=link (src/lib/individual/
 *       invitations.ts inviteDeliveryMode: only under next dev, only against non-production). PEND while
 *       378 is not applied.
 *
 * ⚠ IT NEEDS A DEV SERVER POINTED AT STAGING with `individual_app` ON, and the staging-test legal versions
 * set (the IND-003 staging launcher sets both the remap and the versions). BASE_URL names it.
 *
 * ⚠ IT NEVER WRITES THE RELEASE FLAG. Other sessions share staging and own that row. With the flag OFF it
 * reports PEND and creates nothing. The gate-OFF behaviour is proved separately, on a server with no
 * service key (the guard's `no client = OFF` path), and by the foundation harness from source.
 *
 * ⚠ STAGING ONLY. .env.local names PRODUCTION. Run with the three Supabase variables remapped:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-access
 *
 * Fixtures are its own (harness-access001-*@competen.test, one temporary HQ appointment and one platform
 * membership for its administrator) and are deleted at the start and the end.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";
import { EXPERIENCES } from "../src/lib/individual/experiences";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
assertSafeTarget(url, "individual-access-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3020";

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = {
  grantor: "harness-access001-grantor@competen.test",
  scholar: "harness-access001-scholar@competen.test",
  pro: "harness-access001-pro@competen.test",
  both: "harness-access001-both@competen.test",
  existing: "harness-access001-existing@competen.test",
  expired: "harness-access001-expired@competen.test",
  revoked: "harness-access001-revoked@competen.test",
  uninvited: "harness-access001-uninvited@competen.test",
};
// A test value generated for this run only.
const PW = `acc001-${Math.random().toString(36).slice(2)}-Aa1!`;
const ids: Record<string, string> = {};

// Must match the staging launcher's test legal versions (staging-only identifiers, never production).
const LEGAL = {
  holdings: { terms: "staging-test-h-terms-1", privacy: "staging-test-h-privacy-1" },
  scholar_operator: { terms: "staging-test-s-terms-1", privacy: "staging-test-s-privacy-1" },
};

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

// Invitation fixtures (group I, migration 378). NOT pre-created: the invitation creates them, except the
// expired one, whose past dates only a fixture can write.
const INVITEES = {
  both: "harness-access001-invitee@competen.test",
  revoked: "harness-access001-invitee-revoked@competen.test",
  expired: "harness-access001-invitee-expired@competen.test",
  reuse: "harness-access001-invitee-reuse@competen.test",
};

async function cleanup() {
  // An invitation row cannot be deleted directly (378's trigger): deleting its identity's profile cascades it.
  for (const email of [...Object.values(FIX), ...Object.values(INVITEES)]) {
    const u = await findUser(email);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("platform_membership").delete().eq("user_id", u.id);
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: `Harness ${email.split("-")[2].split("@")[0]}` } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id as string;
}

// ── HTTP with a cookie jar ──────────────────────────────────────────────────────────────────────────
type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(jar: Jar, res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
async function get(path: string, jar?: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: jar ? { Cookie: cookieHeader(jar) } : {} });
  if (jar) absorb(jar, res);
  const location = res.headers.get("location");
  return { status: res.status, location: location ? new URL(location, BASE).pathname + new URL(location, BASE).search : null, // Server HTML splits adjacent JSX text and expressions with an empty comment; read it as one phrase.
    text: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "") : "" };
}
async function send(method: string, path: string, body: unknown, jar?: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(jar ? { Cookie: cookieHeader(jar) } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body) });
  if (jar) absorb(jar, res);
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}
async function signIn(email: string): Promise<Jar> {
  const jar: Jar = new Map();
  const r = await send("POST", "/api/auth/login", { email, password: PW }, jar);
  if (r.status !== 200 || jar.size === 0) throw new Error(`sign-in ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return jar;
}
const isRedirect = (s: number) => s === 307 || s === 308 || s === 302 || s === 303;
/** Next renders a server redirect() inside a streamed page as a meta refresh / NEXT_REDIRECT when headers are sent. */
function redirectTarget(r: { status: number; location: string | null; text: string }): string | null {
  if (isRedirect(r.status)) return r.location;
  const m = /NEXT_REDIRECT;(?:replace|push);([^;"]+);/.exec(r.text) ?? /<meta id="__next-page-redirect" http-equiv="refresh" content="\d+;url=([^"]+)"/.exec(r.text);
  return m ? decodeURIComponent(m[1].replace(/&amp;/g, "&")) : null;
}

async function acceptTerms(jar: Jar, experience: "scholar" | "professional") {
  const x = experience === "scholar" ? LEGAL.scholar_operator : LEGAL.holdings;
  return send("POST", "/api/individual/terms", { experience, foundation: LEGAL.holdings, experienceDocs: x }, jar);
}
const destinations = async (jar: Jar) => (await send("GET", "/api/auth/destinations", undefined, jar));

async function main() {
  console.log(`INDIVIDUAL ACCESS HARNESS (COMPETEN-IND-ACCESS-001) against ${BASE}\n`);

  const { data: flag, error: flagErr } = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  if (flagErr || flag?.enabled !== true) {
    console.log(`  PEND  individual_app is not ON in this project (${flagErr?.message ?? "row absent or false"}). Nothing created. This harness never writes the flag.`);
    return;
  }
  try { await fetch(BASE); } catch { console.log(`  PEND  nothing is serving ${BASE}.`); return; }

  await cleanup();
  for (const [k, email] of Object.entries(FIX)) ids[k] = await makeUser(email);

  // The administrator: an HQ appointment to the Individual Product Administrator position, and the
  // platform membership every HQ staff member holds (gate 1 for the HQ shell).
  const { data: offices } = await admin.from("ogs_offices").select("id, office_type").limit(500);
  const office = ((offices ?? []) as any[]).find(o => o.office_type === `${HQ_OFFICE_TYPE_PREFIX}platform`)
    ?? ((offices ?? []) as any[]).find(o => String(o.office_type ?? "").startsWith(HQ_OFFICE_TYPE_PREFIX));
  const appt = await admin.from("ogs_office_appointments")
    .insert({ office_id: office?.id, person_id: ids.grantor, role: "individual_product_administrator", status: "active" }).select("id").single();
  const pm = await admin.from("platform_membership").insert({ user_id: ids.grantor, status: "active", source: "explicit_grant", note: "harness-access001 HQ administrator fixture" });
  ok("0a. fixture: the administrator holds an Individual Product Administrator appointment", !appt.error && !!office, appt.error?.message ?? "");
  ok("0b. fixture: the administrator holds a platform membership (HQ gate 1)", !pm.error, pm.error?.message ?? "");
  await admin.from("platform_membership").insert({ user_id: ids.existing, status: "active", source: "explicit_grant", note: "harness-access001 existing-account fixture" });

  const hq = await signIn(FIX.grantor);

  // ── H. THE HQ GRANT, BY THE SCREEN'S OWN API ─────────────────────────────────────────────────────
  const page = await get("/super-admin/individual", hq);
  ok("H1. the administrator opens the HQ Individual pilot access screen", page.status === 200 && page.text.includes("Individual pilot access"), `status=${page.status} -> ${page.location}`);
  const look = await send("GET", `/api/hq/individual/grants?email=${encodeURIComponent(FIX.scholar.toUpperCase())}`, undefined, hq);
  ok("H2. lookup by email (case-insensitive) finds the existing account and reports no Individual access yet",
    look.status === 200 && look.json.found === true && look.json.person?.id === ids.scholar && look.json.membership === null && look.json.entitlements?.length === 0, JSON.stringify(look.json).slice(0, 200));
  const none = await send("GET", "/api/hq/individual/grants?email=nobody-access001%40competen.test", undefined, hq);
  ok("H3. an email with no account is 'not found', never an account created", none.status === 200 && none.json.found === false);
  const grant = (target: string, experiences: string[], extra: Record<string, unknown> = {}) =>
    send("POST", "/api/hq/individual/grants", { targetUserId: target, experiences, adultConfirmed: true, ...extra }, hq);
  const self = await grant(ids.grantor, ["professional"]);
  ok("H4. the administrator cannot grant themselves", self.status === 403 && self.json.error?.code === "SELF_GRANT");
  const noAdult = await send("POST", "/api/hq/individual/grants", { targetUserId: ids.scholar, experiences: ["scholar"], adultConfirmed: false }, hq);
  ok("H5. D8: Scholar without the 18+ confirmation is refused", noAdult.status === 422 && noAdult.json.error?.code === "AGE_ELIGIBILITY_REQUIRED");
  const past = await grant(ids.uninvited, ["professional"], { endsOn: "2020-01-01" });
  const stranded = await admin.from("individual_membership").select("id").eq("user_id", ids.uninvited);
  ok("H6. an end date in the past is refused by the SCHEMA, and leaves no stranded membership",
    past.status === 422 && past.json.error?.code === "END_DATE_NOT_FUTURE" && (stranded.data ?? []).length === 0, `${past.status} ${JSON.stringify(past.json)} rows=${(stranded.data ?? []).length}`);

  const gS = await grant(ids.scholar, ["scholar"], { note: "harness-access001" });
  const gP = await grant(ids.pro, ["professional"]);
  const gB = await grant(ids.both, ["scholar", "professional"], { endsOn: "2099-12-31" });
  ok("H7. Scholar-only, Professional-only and both are granted through the HQ API",
    gS.status === 201 && gP.status === 201 && gB.status === 201 && gB.json.granted?.length === 2, `${gS.status}/${gP.status}/${gB.status}`);
  const rowsB = await admin.from("individual_entitlement").select("experience_code, operating_entity, ends_at, adult_confirmed_by, source").eq("user_id", ids.both);
  const sRow = (rowsB.data ?? []).find((r: any) => r.experience_code === "scholar");
  const pRow = (rowsB.data ?? []).find((r: any) => r.experience_code === "professional");
  ok("H8. each row carries its operating entity, the validity date and (Scholar) who confirmed 18+",
    sRow?.operating_entity === "scholar_operator" && pRow?.operating_entity === "competen_holdings"
    && String(sRow?.ends_at).startsWith("2099-12-31T23:59:59") && sRow?.adult_confirmed_by === ids.grantor && sRow?.source === "pilot");
  const { data: audit } = await admin.from("audit_log").select("action, new_value").eq("actor_id", ids.grantor).eq("action", "individual_pilot_grant").limit(20);
  ok("H9. every grant is audited under the administrator, with the validity recorded",
    (audit ?? []).length >= 3 && (audit ?? []).some((a: any) => a.new_value?.target_user_id === ids.both && String(a.new_value?.ends_at).startsWith("2099-12-31")));
  const again = await grant(ids.scholar, ["scholar"]);
  ok("H10. granting a live experience again is idempotent (reported, not duplicated)", again.status === 200 && again.json.alreadyLive?.includes("scholar"));

  // ── S1. SCHOLAR-ONLY INVITATION ──────────────────────────────────────────────────────────────────
  const anon = await get("/individual/sign-in?experience=scholar");
  ok("S1a. the Scholar website's Sign in, signed out, goes to the ONE Competen login with the Scholar destination",
    anon.status === 307 && anon.location === "/login?next=%2Findividual%2Fscholar", `${anon.status} -> ${anon.location}`);
  const s = await signIn(FIX.scholar);
  const door = await get("/individual/sign-in?experience=scholar", s);
  ok("S1b. signed in, the same door skips the form and goes straight to Scholar", door.status === 307 && door.location === "/individual/scholar", `${door.status} -> ${door.location}`);
  const first = await get("/individual/scholar", s);
  ok("S1c. first entry goes through the welcome once, carrying the requested experience",
    redirectTarget(first) === "/individual/welcome?for=scholar", `${first.status} -> ${redirectTarget(first)}`);
  const welcome = await get("/individual/welcome?for=scholar", s);
  ok("S1d. the welcome renders for the requested experience", welcome.status === 200 && welcome.text.includes("Continue to Competen Scholar"));
  const done = await send("POST", "/api/individual/preferences", { primaryExperience: "scholar", completeOnboarding: true }, s);
  ok("S1e. completing the welcome records onboarding", done.status === 200);
  const terms = await get("/individual/scholar", s);
  ok("S1f. Scholar then asks for its terms before use (D2), not the welcome again",
    terms.status === 200 && terms.text.includes("Before you use Competen Scholar"), `${terms.status} -> ${redirectTarget(terms)}`);
  const acc = await acceptTerms(s, "scholar");
  const shell = await get("/individual/scholar", s);
  ok("S1g. after acceptance the Scholar shell opens", acc.status === 200 && shell.status === 200 && shell.text.includes("Scholar navigation"), `${acc.status} ${JSON.stringify(acc.json)}`);
  const sOther = await get("/individual/professional", s);
  ok("S1h. Professional, not held, renders the governed not-active state -- never the shell",
    sOther.status === 200 && sOther.text.includes("Competen Professional is not active on your account") && !sOther.text.includes("Professional navigation"));
  const sDest = await destinations(s);
  ok("S1i. the neutral sign-in offers Competen Individual only (no platform membership)",
    sDest.status === 200 && sDest.json.state === "one" && sDest.json.destination?.href === "/individual/home", JSON.stringify(sDest.json).slice(0, 160));

  // ── S2. PROFESSIONAL-ONLY INVITATION ─────────────────────────────────────────────────────────────
  const p = await signIn(FIX.pro);
  const pDoor = await get("/individual/sign-in?experience=professional", p);
  ok("S2a. the Professional website's Sign in lands on Professional", pDoor.location === "/individual/professional");
  await send("POST", "/api/individual/preferences", { primaryExperience: "professional", completeOnboarding: true }, p);
  await acceptTerms(p, "professional");
  const pShell = await get("/individual/professional", p);
  ok("S2b. direct Professional, with no Scholar row ever, opens its shell", pShell.status === 200 && pShell.text.includes("Professional navigation"));
  const pWrong = await get("/individual/sign-in?experience=scholar", p);
  const pWrongPage = await get(pWrong.location ?? "/", p);
  ok("S2c. arriving from the Scholar website, a Professional-only person is told Scholar is not active, with a way to Professional",
    pWrong.location === "/individual/scholar" && pWrongPage.text.includes("Competen Scholar is not active on your account") && pWrongPage.text.includes('href="/individual/professional"'));

  // ── S3 / S8. BOTH EXPERIENCES, PRIMARY AND SWITCHING ─────────────────────────────────────────────
  const b = await signIn(FIX.both);
  await send("POST", "/api/individual/preferences", { primaryExperience: "professional", completeOnboarding: true }, b);
  await acceptTerms(b, "scholar"); await acceptTerms(b, "professional");
  const bHome = await get("/individual/home", b);
  ok("S3a. with both, /individual/home opens the configured primary (Professional)", redirectTarget(bHome) === "/individual/professional", `${redirectTarget(bHome)}`);
  const bMain = await get("/individual/sign-in", b);
  ok("S3b. the Individual door with no experience named resolves through /individual/home", bMain.location === "/individual/home");
  const bExplicit = await get("/individual/sign-in?experience=scholar", b);
  const bScholar = await get("/individual/scholar", b);
  ok("S3c. an explicit Scholar request outranks the Professional primary", bExplicit.location === "/individual/scholar" && bScholar.status === 200 && bScholar.text.includes("Scholar navigation"));
  ok("S3d. the experience switcher offers the other live experience", bScholar.text.includes('href="/individual/professional"'));
  const toScholar = await send("POST", "/api/individual/preferences", { primaryExperience: "scholar" }, b);
  const bHome2 = await get("/individual/home", b);
  ok("S8a. changing the primary to Scholar changes where /individual/home opens", toScholar.status === 200 && redirectTarget(bHome2) === "/individual/scholar");
  const bad = await send("POST", "/api/individual/preferences", { primaryExperience: "scholar" }, p);
  ok("S8b. a primary the person does not hold is refused", bad.status === 400);

  // ── S4. EXISTING ACCOUNT RECEIVING A NEW ENTITLEMENT ─────────────────────────────────────────────
  const e = await signIn(FIX.existing);
  const before = await destinations(e);
  const beforeCodes = (before.json.destinations ?? (before.json.destination ? [before.json.destination] : [])).map((d: any) => d.code ?? d.href);
  const gE = await grant(ids.existing, ["professional"]);
  const after = await destinations(e);
  const afterCodes = (after.json.destinations ?? (after.json.destination ? [after.json.destination] : [])).map((d: any) => d.code ?? d.href);
  ok("S4a. before the grant, the existing account is not offered Individual", !beforeCodes.includes("individual") && !beforeCodes.includes("/individual/home"), JSON.stringify(before.json).slice(0, 160));
  ok("S4b. after the HQ grant, the SAME account (same session, no new identity) is offered Individual beside its estate",
    gE.status === 201 && after.json.state === "many" && afterCodes.includes("individual") && afterCodes.includes("platform"), JSON.stringify(after.json).slice(0, 200));
  const { data: pmE } = await admin.from("platform_membership").select("id").eq("user_id", ids.existing);
  const { data: pmS } = await admin.from("platform_membership").select("id").eq("user_id", ids.scholar);
  ok("S4c. the grant created no platform membership, and kept the existing one", (pmE ?? []).length === 1 && (pmS ?? []).length === 0);

  // ── S5. EXPIRED, REVOKED, ENDED ──────────────────────────────────────────────────────────────────
  await admin.from("individual_membership").insert({ user_id: ids.expired, status: "active", source: "hq_pilot_grant", onboarded_at: new Date().toISOString() });
  await admin.from("individual_entitlement").insert({ user_id: ids.expired, experience_code: "professional", status: "active", source: "pilot",
    operating_entity: "competen_holdings", starts_at: "2024-01-01T00:00:00Z", ends_at: "2024-06-30T23:59:59Z" });
  const x = await signIn(FIX.expired);
  const xP = await get("/individual/professional", x);
  const xHome = await get("/individual/home", x);
  ok("S5a. an expired entitlement (DB clock) opens nothing: the experience shows not-active, home says nothing is active",
    xP.text.includes("Competen Professional is not active on your account") && xHome.status === 200 && xHome.text.includes("No experience is active on your account right now"));
  await admin.from("individual_membership").insert({ user_id: ids.revoked, status: "revoked", revoked_at: new Date().toISOString(), source: "hq_pilot_grant" });
  const r = await signIn(FIX.revoked);
  const rS = await get("/individual/scholar", r);
  const rAcc = await get(redirectTarget(rS) ?? "/individual/access", r);
  ok("S5b. a revoked membership is refused to the access guidance, which says access has ended",
    redirectTarget(rS) === "/individual/access?for=scholar" && rAcc.text.includes("Your Competen Individual access has ended"), `${redirectTarget(rS)}`);
  const end = await send("POST", "/api/hq/individual/grants/end", { targetUserId: ids.pro, experience: "professional" }, hq);
  const pAfter = await get("/individual/professional", p);
  ok("S5c. an experience ended from HQ closes on the next request", end.status === 200 && pAfter.text.includes("Competen Professional is not active on your account"));

  // ── S6. UNINVITED ────────────────────────────────────────────────────────────────────────────────
  const u = await signIn(FIX.uninvited);
  const uS = await get("/individual/scholar", u);
  const uAcc = await get(redirectTarget(uS) ?? "/individual/access", u);
  ok("S6a. an uninvited account asking for Scholar is sent to guidance that names Scholar -- nothing is granted",
    redirectTarget(uS) === "/individual/access?for=scholar" && uAcc.text.includes("Competen Scholar is not on this account") && !uAcc.text.includes('href="/signup"'), `${redirectTarget(uS)}`);
  const { data: uRows } = await admin.from("individual_membership").select("id").eq("user_id", ids.uninvited);
  ok("S6b. no access was created implicitly for the uninvited account", (uRows ?? []).length === 0);
  const uDest = await destinations(u);
  ok("S6c. the neutral sign-in offers the uninvited account no Individual destination", uDest.json.state === "none", JSON.stringify(uDest.json).slice(0, 120));

  // ── S7. DEEP LINK, SIGNED OUT ────────────────────────────────────────────────────────────────────
  const seg = EXPERIENCES.scholar.modules[0]?.segment;
  const deep = await get(`/individual/scholar/${seg}`);
  ok("S7a. a signed-out deep link goes to the one login with the FULL path preserved",
    deep.status === 307 && deep.location === `/login?next=${encodeURIComponent(`/individual/scholar/${seg}`)}`, `${deep.status} -> ${deep.location}`);
  const deepIn = await get(`/individual/scholar/${seg}`, s);
  ok("S7b. after signing in, the same deep link opens for the entitled person", deepIn.status === 200, `${deepIn.status} -> ${redirectTarget(deepIn)}`);
  const evil = await get("/individual/sign-in?experience=%2F%2Fevil.example");
  ok("S7c. a crafted ?experience= cannot become a redirect target", evil.location === "/login?next=%2Findividual%2Fhome", `${evil.location}`);

  // ── S9. SIGNED OUT AND UNAUTHORISED ──────────────────────────────────────────────────────────────
  const so = await send("POST", "/api/individual/preferences", { primaryExperience: "scholar" });
  ok("S9a. a signed-out API call is 401", so.status === 401);
  const sHq = await send("GET", `/api/hq/individual/grants?email=${encodeURIComponent(FIX.pro)}`, undefined, s);
  const sGrant = await send("POST", "/api/hq/individual/grants", { targetUserId: ids.uninvited, experiences: ["professional"], adultConfirmed: true }, s);
  ok("S9b. an Individual member without the HQ capability cannot look up or grant", sHq.status === 403 && sGrant.status === 403);
  const sPage = await get("/super-admin/individual", s);
  ok("S9c. and cannot open the HQ screen", sPage.status !== 200 || !sPage.text.includes("Find a Competen account"), `${sPage.status}`);
  const access = await get("/individual/access?for=professional");
  ok("S9d. signed out, the access guidance names the product and signs in back to it",
    access.status === 200 && access.text.includes("Sign in to Competen Professional") && access.text.includes("/login?next=%2Findividual%2Fprofessional"));

  await invitations(hq, s);
  await membershipStatus(hq, s);
}

// ── M. MEMBERSHIP STATUS (LEGAL-001 s13 step 7) AND THE HQ 401 ─────────────────────────────────────────────
async function membershipStatus(hq: Jar, nonHq: Jar) {
  const act = (body: Record<string, unknown>, jar?: Jar) => send("POST", "/api/hq/individual/grants/membership", body, jar);
  const target = ids.existing; // granted Professional in S4; holds a platform membership too
  const e = await signIn(FIX.existing);

  const anon = await act({ targetUserId: target, action: "suspend" });
  const notHq = await act({ targetUserId: target, action: "suspend" }, nonHq);
  const self = await act({ targetUserId: ids.grantor, action: "suspend" }, hq);
  ok("M1. refused: no session is 401 (the hqApiGate fix), no capability is 403, acting on yourself is 403",
    anon.status === 401 && notHq.status === 403 && self.status === 403 && self.json.error?.code === "SELF_GRANT", `${anon.status}/${notHq.status}/${self.status}`);

  const sus = await act({ targetUserId: target, action: "suspend", reason: "Harness: paused for review" }, hq);
  const page = await get("/individual/professional", e);
  const guidance = await get(redirectTarget(page) ?? "/individual/access", e);
  ok("M2. suspend closes access now: the person is sent to guidance that says access is paused",
    sus.status === 200 && sus.json.to === "suspended" && redirectTarget(page)?.startsWith("/individual/access") === true && guidance.text.includes("Your Competen Individual access is paused"),
    `${sus.status} -> ${redirectTarget(page)}`);
  const { data: ents } = await admin.from("individual_entitlement").select("id, status").eq("user_id", target);
  ok("M3. suspension keeps the entitlement history untouched", (ents ?? []).length > 0 && (ents ?? []).every((r: any) => r.status === "active"));

  const back = await act({ targetUserId: target, action: "reinstate" }, hq);
  const home = await get("/individual/home", e);
  ok("M4. reinstate reopens access", back.status === 200 && back.json.to === "active" && !(redirectTarget(home) ?? "").startsWith("/individual/access"), `${back.status} -> ${redirectTarget(home)}`);

  const noReason = await act({ targetUserId: target, action: "revoke" }, hq);
  const rev = await act({ targetUserId: target, action: "revoke", reason: "Harness: left the pilot cohort" }, hq);
  const ended = await get(redirectTarget(await get("/individual/professional", e)) ?? "/individual/access", e);
  ok("M5. revoke needs a reason, then closes access for good: guidance says access has ended",
    noReason.status === 400 && noReason.json.error?.code === "REASON_REQUIRED" && rev.status === 200 && ended.text.includes("Your Competen Individual access has ended"));
  const again = await act({ targetUserId: target, action: "reinstate" }, hq);
  const regrant = await send("POST", "/api/hq/individual/grants", { targetUserId: target, experiences: ["professional"], adultConfirmed: true }, hq);
  const { data: m } = await admin.from("individual_membership").select("status, revoked_at, revoked_by").eq("user_id", target).single();
  ok("M6. revoked is terminal here: no reinstate, no re-grant; the row records when and by whom",
    again.status === 409 && again.json.error?.code === "INVALID_TRANSITION" && regrant.status === 409 && m?.status === "revoked" && !!m?.revoked_at && m?.revoked_by === ids.grantor);
  const { data: pm } = await admin.from("platform_membership").select("id").eq("user_id", target);
  ok("M7. revoking Individual touched no other product: the platform membership is still there", (pm ?? []).length === 1);
  const { data: trail } = await admin.from("audit_log").select("action, new_value").eq("actor_id", ids.grantor).like("action", "individual_membership_%").limit(10);
  const acts = (trail ?? []).map((r: any) => r.action);
  ok("M8. every change is audited with its reason",
    ["individual_membership_suspended", "individual_membership_reinstated", "individual_membership_revoked"].every(a => acts.includes(a))
    && (trail ?? []).some((r: any) => r.action === "individual_membership_revoked" && r.new_value?.reason === "Harness: left the pilot cohort"), acts.join(","));
}

// ── I. INVITATIONS FOR PEOPLE WITHOUT AN ACCOUNT (migration 378) ──────────────────────────────────────
// Needs the dev server started with INDIVIDUAL_INVITE_TEST_DELIVERY=link, so the invite link comes back to
// this harness instead of a mailbox (inviteDeliveryMode: never on a deployed build, never production).
async function invitations(hq: Jar, nonHq: Jar) {
  const probe = await admin.from("individual_invitation").select("id").limit(0);
  if (probe.error) { console.log(`  PEND  group I: individual_invitation is not readable here (${probe.error.code}) -- migration 378 not applied.`); return; }
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const invite = (body: Record<string, unknown>, jar = hq) => send("POST", "/api/hq/individual/invitations", body, jar);

  /** Follow the invite link the way a mailbox click does, then set a password on the session it carries. */
  async function openLinkAndSetPassword(link: string) {
    const hop = await fetch(link, { redirect: "manual" });
    const loc = hop.headers.get("location") ?? "";
    const frag = new URLSearchParams(loc.split("#")[1] ?? "");
    const at = frag.get("access_token"), rt = frag.get("refresh_token");
    let set = false;
    if (at && rt) {
      const c = createClient(url!, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
      const { error } = await c.auth.setSession({ access_token: at, refresh_token: rt });
      if (!error) set = !(await c.auth.updateUser({ password: PW })).error;
    }
    return { loc, set };
  }

  // I1-I2. Invite an address with no account, to both experiences.
  const i1 = await invite({ email: INVITEES.both.toUpperCase(), name: "Harness Invitee", experiences: ["scholar", "professional"], adultConfirmed: true, endsOn: "2099-12-31", expiresInDays: 7, note: "harness-access001" });
  ok("I1. an address with no account is invited (201) -- the link comes back ONLY because this is the test delivery mode",
    i1.status === 201 && i1.json.delivery === "link" && typeof i1.json.testLink === "string" && i1.json.reusedIdentity === false, `${i1.status} ${JSON.stringify(i1.json).slice(0, 160)}`);
  const newId = i1.json.authUserId as string;
  const [prof, pm, prm, im, ie] = await Promise.all([
    admin.from("profiles").select("id, role, email").eq("id", newId).maybeSingle(),
    admin.from("platform_membership").select("id").eq("user_id", newId),
    admin.from("practice_membership").select("id").eq("user_id", newId),
    admin.from("individual_membership").select("id").eq("user_id", newId),
    admin.from("individual_entitlement").select("id").eq("user_id", newId),
  ]);
  ok("I2. the invitation created ONE identity with no estate role, and no platform, practice or Individual membership yet",
    prof.data?.id === newId && prof.data?.role === null && prof.data?.email === INVITEES.both
    && (pm.data ?? []).length === 0 && !prm.error && (prm.data ?? []).length === 0 && (im.data ?? []).length === 0 && (ie.data ?? []).length === 0,
    `role=${prof.data?.role} pm=${(pm.data ?? []).length} prm=${prm.error?.code ?? (prm.data ?? []).length} im=${(im.data ?? []).length}`);

  // I3-I6. Duplicates and refusals, decided before anything is created.
  const dup = await invite({ email: INVITEES.both, experiences: ["professional"] });
  ok("I3. a second invitation to the same address is refused while one is waiting", dup.status === 409 && dup.json.error?.code === "INVITATION_PENDING");
  const existing = await invite({ email: FIX.uninvited, experiences: ["professional"] });
  ok("I4. an address that already has an account is sent to the existing grant path, with the person's id",
    existing.status === 409 && existing.json.error?.code === "ACCOUNT_EXISTS" && existing.json.error?.personId === ids.uninvited);
  const noAdult = await invite({ email: "harness-access001-never@competen.test", experiences: ["scholar"], adultConfirmed: false });
  const never = await findUser("harness-access001-never@competen.test");
  ok("I5. D8: inviting to Scholar without the 18+ confirmation is refused, and creates no identity", noAdult.status === 422 && !never);
  const notHq = await invite({ email: "harness-access001-never@competen.test", experiences: ["professional"] }, nonHq);
  ok("I6. a person without the HQ right cannot invite", notHq.status === 403);
  const look = await send("GET", `/api/hq/individual/grants?email=${encodeURIComponent(INVITEES.both)}`, undefined, hq);
  ok("I7. the HQ lookup shows the waiting invitation (live by the database clock)",
    look.status === 200 && look.json.invitationsProvisioned === true && look.json.invitations?.[0]?.status === "PENDING" && look.json.invitations?.[0]?.live === true);

  // I8-I14. The person: open the link, set a password, sign in once, accept.
  const opened = await openLinkAndSetPassword(i1.json.testLink);
  ok("I8. the invite link lands on the shared password page carrying the Individual destination, and the password is set",
    opened.set && opened.loc.includes("/reset-password") && opened.loc.includes("next=%2Findividual%2Fhome"), opened.loc.split("#")[0]);
  const inv = await signIn(INVITEES.both);
  const home = await get("/individual/home", inv);
  const accessPage = await get(redirectTarget(home) ?? "/individual/access", inv);
  ok("I9. signed in, the invited person holds nothing yet and is shown the invitation on the access page",
    redirectTarget(home)?.startsWith("/individual/access") === true && accessPage.text.includes("You have been invited to Competen Scholar and Competen Professional"));
  const acc = await send("POST", "/api/individual/invitation/accept", {}, inv);
  ok("I10. accepting grants, and continues to the welcome", acc.status === 200 && acc.json.next === "/individual/welcome?for=scholar", `${acc.status} ${JSON.stringify(acc.json)}`);
  const [m2, e2, invRow, prof2] = await Promise.all([
    admin.from("individual_membership").select("status, source, granted_by").eq("user_id", newId).maybeSingle(),
    admin.from("individual_entitlement").select("experience_code, source, operating_entity, ends_at, adult_confirmed_by, adult_confirmed_at, granted_by").eq("user_id", newId),
    admin.from("individual_invitation").select("status, accepted_at, adult_confirmed_at").eq("id", i1.json.invitationId).single(),
    admin.from("profiles").select("role").eq("id", newId).single(),
  ]);
  const sc = (e2.data ?? []).find((r: any) => r.experience_code === "scholar");
  const pr = (e2.data ?? []).find((r: any) => r.experience_code === "professional");
  ok("I11. the grant carries the inviter as grantor, the inviter's 18+ confirmation, operating entities and the validity date",
    m2.data?.status === "active" && m2.data?.granted_by === ids.grantor && sc?.adult_confirmed_by === ids.grantor
    && sc?.adult_confirmed_at === invRow.data?.adult_confirmed_at && sc?.operating_entity === "scholar_operator" && pr?.operating_entity === "competen_holdings"
    && String(sc?.ends_at).startsWith("2099-12-31T23:59:59") && String(pr?.ends_at).startsWith("2099-12-31T23:59:59"),
    JSON.stringify({ m: m2.data, sc, pr }).slice(0, 300));
  ok("I12. the invitation is closed as ACCEPTED, and the identity still holds no estate role", invRow.data?.status === "ACCEPTED" && !!invRow.data?.accepted_at && prof2.data?.role === null);
  const again = await send("POST", "/api/individual/invitation/accept", {}, inv);
  const first = await get("/individual/scholar", inv);
  const dest = await destinations(inv);
  ok("I13. accepting twice is refused; Scholar opens through the welcome (then terms, D2); sign-in offers Individual only",
    again.status === 404 && redirectTarget(first) === "/individual/welcome?for=scholar" && dest.json.state === "one" && dest.json.destination?.href === "/individual/home");
  const { data: auditRows } = await admin.from("audit_log").select("action").in("entity_id", [i1.json.invitationId]).limit(10);
  ok("I14. creation and acceptance are both audited", ["individual_invitation_created", "individual_invitation_accepted"].every(a => (auditRows ?? []).some((r: any) => r.action === a)));

  // I15-I17. Revocation.
  const i2 = await invite({ email: INVITEES.revoked, experiences: ["professional"] });
  const short = await send("POST", "/api/hq/individual/invitations/revoke", { invitationId: i2.json.invitationId, reason: "no" }, hq);
  const rev = await send("POST", "/api/hq/individual/invitations/revoke", { invitationId: i2.json.invitationId, reason: "Harness: invited in error" }, hq);
  const revRow = await admin.from("individual_invitation").select("status, revoked_by, revoked_reason").eq("id", i2.json.invitationId).single();
  ok("I15. revoking needs a reason, keeps the record, and leaves the identity in place",
    i2.status === 201 && short.status === 400 && rev.status === 200 && revRow.data?.status === "REVOKED" && revRow.data?.revoked_by === ids.grantor
    && !!(await findUser(INVITEES.revoked)));
  const opened2 = await openLinkAndSetPassword(i2.json.testLink);
  const r2 = await signIn(INVITEES.revoked);
  const acc2 = await send("POST", "/api/individual/invitation/accept", {}, r2);
  const acc2Page = await get("/individual/access", r2);
  ok("I16. a revoked invitation cannot be accepted; the person is told Individual is not on the account",
    opened2.set && acc2.status === 404 && acc2Page.text.includes("Competen Individual is not on this account") && !acc2Page.text.includes("You have been invited"));
  const reinvite = await invite({ email: INVITEES.revoked, experiences: ["professional"] });
  ok("I17. once that identity has signed in, it is an existing account: re-inviting goes to the grant path", reinvite.status === 409 && reinvite.json.error?.code === "ACCOUNT_EXISTS");

  // I18-I19. Expiry, by the database clock (a fixture: only it can write past dates).
  const xId = await makeUser(INVITEES.expired);
  const past = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const xIns = await admin.from("individual_invitation").insert({
    invited_email: INVITEES.expired, invite_professional: true, expires_at: past(1), created_at: past(10), auth_user_id: xId, created_by: ids.grantor,
  }).select("id").single();
  const x = await signIn(INVITEES.expired);
  const xAcc = await send("POST", "/api/individual/invitation/accept", {}, x);
  const xLook = await send("GET", `/api/hq/individual/grants?email=${encodeURIComponent(INVITEES.expired)}`, undefined, hq);
  ok("I18. an expired invitation cannot be accepted, and HQ sees it as waiting-but-not-live",
    !xIns.error && xAcc.status === 404 && xLook.json.invitations?.[0]?.status === "PENDING" && xLook.json.invitations?.[0]?.live === false, xIns.error?.message ?? "");
  const xNew = await invite({ email: INVITEES.expired, experiences: ["professional"] });
  ok("I19. a new invitation waits until the expired one is revoked (one live invitation per email)", xNew.status === 409 && xNew.json.error?.code === "INVITATION_EXPIRED_PENDING");

  // I20. The schema itself: the history cannot be rewritten or deleted.
  const tamper = await admin.from("individual_invitation").update({ invite_scholar: true }).eq("id", i1.json.invitationId);
  const del = await admin.from("individual_invitation").delete().eq("id", i2.json.invitationId);
  const dupRow = await admin.from("individual_invitation").insert({ invited_email: INVITEES.expired, invite_professional: true, expires_at: new Date(Date.now() + 86_400_000).toISOString(), auth_user_id: xId, created_by: ids.grantor });
  ok("I20. the schema refuses rewriting an invitation, deleting one, and a second pending invitation for one email",
    !!tamper.error && !!del.error && String(dupRow.error?.code) === "23505", `${tamper.error?.message} | ${del.error?.message} | ${dupRow.error?.code}`);

  // I21-I22. Re-invitation cannot inherit unrelated authority (owner review item 5). An identity an earlier
  // invitation created, never signed into, is reused only while it holds NOTHING.
  const ri1 = await invite({ email: INVITEES.reuse, experiences: ["professional"] });
  await send("POST", "/api/hq/individual/invitations/revoke", { invitationId: ri1.json.invitationId, reason: "Harness: re-invitation test" }, hq);
  const ri2 = await invite({ email: INVITEES.reuse, experiences: ["professional"] });
  ok("I21. a clean, never-signed-in identity from a revoked invitation is reused, not duplicated",
    ri1.status === 201 && ri2.status === 201 && ri2.json.reusedIdentity === true && ri2.json.authUserId === ri1.json.authUserId, `${ri1.status}/${ri2.status} ${JSON.stringify(ri2.json).slice(0, 120)}`);
  await send("POST", "/api/hq/individual/invitations/revoke", { invitationId: ri2.json.invitationId, reason: "Harness: re-invitation test" }, hq);
  // Somebody has since given that identity standing (a platform membership, as a fixture).
  await admin.from("platform_membership").insert({ user_id: ri1.json.authUserId, status: "active", source: "explicit_grant", note: "harness-access001 standing fixture" });
  const ri3 = await invite({ email: INVITEES.reuse, experiences: ["professional"] });
  ok("I22. once that identity holds any standing, re-inviting is refused as an existing account -- no fresh sign-in link to an inbox with authority",
    ri3.status === 409 && ri3.json.error?.code === "ACCOUNT_EXISTS", `${ri3.status} ${JSON.stringify(ri3.json).slice(0, 120)}`);
}

main()
  .catch(err => { fails.push(`crashed: ${err?.message ?? err}`); console.log(`  FAIL  crashed: ${err?.stack ?? err}`); })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${fails.length} failed`);
    if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exitCode = 1; }
  });
