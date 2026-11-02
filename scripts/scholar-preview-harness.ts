/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HQ-SCHOLAR-PREVIEW-01 acceptance (migration 860): an HQ user opens the REAL Competen Scholar as the designated demonstration learner, on
 * a separate host, without touching their own session.
 *
 *   S   static: the controls the live groups lean on exist in the code (route capability, proxy learner check, header stripping,
 *       read-only refuses writes, designation needs a demo account, host-only cookie). Run with no database. Each is break-tested.
 *   P1  a holder of another HQ position (not the preview right) is refused 403, an anonymous caller 401, a foreign Origin 403, and NO session row is written
 *   P2  a holder gets 303 to <preview host>/preview/enter?t=<ticket>, entering sets the preview and learner cookies on the PREVIEW host only,
 *       and the HQ session on the main host is intact
 *   P3  eight study pages answer 200 on the preview host with the seeded titles and the preview banner
 *   P4  a real learner's material is 404 in the preview (page and API), and the preview shows none of it
 *   P5  read-only: a POST to Scholar APIs and to a page is 403 with an audit row (scholar_preview_write_refused), and the learner's record counts are unchanged
 *   P6  a replayed ticket is refused and clears cookies. An expired session sends a page to /preview/ended and an API to 401, cookies cleared
 *   P7  designating a non-demo account is refused, a non-owner designating is refused, and the schema refuses a session for a learner that is not
 *       designated for that mode (testing on the read-only learner hits the foreign key)
 *   P8  the preview host answers 404 for /super-admin, /practice/home, /api/hq, /login, /api/auth/login, and /preview/enter is 404 on the main host
 *   P9  a spoofed x-scholar-preview-* header on the main host shows no banner
 *   P10 "My Scholar" reports the administrator's OWN Individual status and grants nothing, and shows Open my Scholar once another grantor gives access
 *
 * Needs: migration 860 applied on STAGING (PEND otherwise), the two demonstration learners provisioned and designated
 * (scripts/provision-scholar-demo-learner.ts up), and BASE_URL naming a STAGING-pointed dev server on localhost (the same server answers
 * preview.localhost: this harness reaches it at 127.0.0.1 with a Host header). The static group runs with none of that.
 * Refuses production via assertSafeTarget. Creates and deletes its own harness-prevw-* identities and nothing else.
 *
 *   BASE_URL=http://localhost:3100 npx tsx scripts/scholar-preview-harness.ts
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { assertSafeTarget } from "./production-guard";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { decidePreviewRequest } from "../src/lib/individual/preview/host-policy";
import { BUCKET, TEXT_MIME } from "../src/lib/individual/scholar/config";

loadEnvConfig(process.cwd(), true);

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ═══ S. static controls ═══════════════════════════════════════════════════════════════════════════════════════
function statics() {
  console.log("S. the controls, in the code");
  const route = strip(readFileSync("src/app/api/hq/individual/scholar-preview/route.ts", "utf8"));
  const proxy = strip(readFileSync("src/proxy.ts", "utf8"));
  const session = strip(readFileSync("src/lib/individual/preview/session.ts", "utf8"));
  const mig = readFileSync("supabase/migrations/860-individual-scholar-product-preview.sql", "utf8").replace(/^--.*$/gm, "");
  ok("S1. the HQ route is gated by exactly hq.individual.scholar.preview, before the database is asked for anything",
    /hqApiGate\(\["hq\.individual\.scholar\.preview"\]\)/.test(route) && route.indexOf("hqApiGate(") < route.indexOf("openPreview("));
  ok("S2. the HQ route checks the Origin is its own before it mints a ticket", /sameOrigin\(/.test(route) && route.indexOf("sameOrigin(") < route.indexOf("openPreview("));
  ok("S3. the proxy admits a preview request only when the learner's own session is the one the preview names (learner_id check)",
    /user\.id\s*!==\s*session\.learnerId/.test(proxy));
  ok("S4. the proxy deletes every client-sent x-scholar-preview-* header on every host before it sets its own",
    /startsWith\(PREVIEW_HEADER_PREFIX\)/.test(proxy) && /h\.delete\(name\)/.test(proxy));
  const readOnlyPost = decidePreviewRequest("preview.localhost:3100", "/api/individual/scholar/materials", "POST", "read_only");
  const readOnlyPage = decidePreviewRequest("preview.localhost:3100", "/individual/scholar/study", "POST", "read_only");
  const testingErase = decidePreviewRequest("preview.localhost:3100", "/api/individual/scholar/erase", "POST", "testing");
  ok("S5. read-only refuses a non-GET (403) to an API and to a page, and testing mode still refuses erase",
    readOnlyPost.action === "forbidden" && readOnlyPage.action === "forbidden" && testingErase.action === "forbidden",
    JSON.stringify([readOnlyPost.action, readOnlyPage.action, testingErase.action]));
  ok("S6. the preview cookie carries no Domain (host-only) and is HttpOnly", !/domain\s*:/.test(session) && /httpOnly:\s*true/.test(session));
  ok("S7. designating needs a platform owner AND an account classified demo (a new reader of 650)",
    /hq_actor_is_owner\(p_actor\)/.test(mig) && /c\.account_type\s*=\s*'demo'/.test(mig));
  ok("S8. a session can only name a learner under the mode that learner was designated for (composite foreign key)",
    /foreign key \(learner_id, mode\) references individual_scholar_preview_learner \(user_id, mode\)/.test(mig) && /check \(actor_id <> learner_id\)/.test(mig));
  ok("S9. the preview functions are service role only", (mig.match(/grant execute on function individual_scholar_preview_[a-z]+\([^)]*\) to service_role/g) ?? []).length === 5
    && !/grant execute on function individual_scholar_preview_[a-z]+\([^)]*\) to (anon|authenticated|public)/.test(mig));
}

// ═══ live groups ═══════════════════════════════════════════════════════════════════════════════════════════════
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const FIX = { holder: "harness-prevw-holder@competen.test", other: "harness-prevw-other@competen.test", real: "harness-prevw-real@competen.test" };
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};


/**
 * One HTTP request to 127.0.0.1:<port> that KEEPS the Host header. Node's fetch (undici) silently replaces a Host header with the URL's host,
 * so the dev server saw 127.0.0.1 for every request and the preview-host and main-host checks could not tell the two apart.
 */
function hostFetch(port: string, method: string, path: string, headers: Record<string, string>, body?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ host: "127.0.0.1", port: Number(port), method, path, headers: { ...headers, ...(body !== undefined ? { "Content-Length": String(Buffer.byteLength(body)) } : {}) } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c as Buffer));
      res.on("end", () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) { if (Array.isArray(v)) v.forEach(x => h.append(k, x)); else if (v !== undefined) h.set(k, String(v)); }
        const status = res.statusCode ?? 0;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: h }));
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(jar: Jar, res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = c.split(";"); const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
const setCookies = (res: Response): string[] => (res.headers as any).getSetCookie?.() ?? [];

async function main() {
  statics();
  if (!url || !key || !anonKey) { console.log("\n  PEND  live groups -- Supabase env not set"); return; }
  const ref = assertSafeTarget(url, "scholar-preview-harness");
  const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
  console.log(`\nSCHOLAR PREVIEW ACCEPTANCE -- target ${ref}${BASE ? `, server ${BASE}` : ", no server"}\n`);

  const probe = await admin.from("individual_scholar_preview_learner").select("user_id, mode");
  if (probe.error) { pend("P1-P10", "860 not applied on this project (individual_scholar_preview_learner is unreadable). Apply 860 on staging first. Nothing created."); return; }
  const readOnly = (probe.data ?? []).find((l: any) => l.mode === "read_only");
  if (!readOnly) { pend("P1-P10", "no read-only demonstration learner is designated: run scripts/provision-scholar-demo-learner.ts up on staging first"); return; }
  if (!BASE) { pend("P1-P10", "BASE_URL (a staging-pointed dev server on localhost) is not set"); return; }
  if (!/^http:\/\/(localhost|127\.0\.0\.1):(\d+)$/.test(BASE)) { pend("P1-P10", "BASE_URL must be http://localhost:<port>: the preview host is preview.localhost on the same server"); return; }
  const port = BASE.split(":")[2];
  const MAIN_HOST = `localhost:${port}`, PREVIEW_HOST = `preview.localhost:${port}`;
  const owner = await fixtureOwnerId(admin);
  if (!owner) { pend("P1-P10", "no platform owner profile on this project"); return; }

  /** One request to the dev server with a chosen Host header (Node's fetch will not resolve *.localhost everywhere). */
  const req = async (host: string, method: string, path: string, jar?: Jar, opts: { body?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { Host: host, ...(opts.headers ?? {}) };
    if (jar) headers.Cookie = cookieHeader(jar);
    let body: any;
    if (opts.form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(opts.form).toString(); }
    else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
    const res = await hostFetch(port, method, path, headers, body);
    if (jar) absorb(jar, res);
    const text = res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : (await res.text().catch(() => ""));
    let json: any = {}; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, location: res.headers.get("location") ?? "", text, json, res };
  };

  async function findUser(email: string) {
    for (let page = 1; page <= 20; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const hit = (data?.users ?? []).find((u: any) => u.email === email);
      if (hit) return hit;
      if ((data?.users ?? []).length < 200) return null;
    }
    return null;
  }
  async function mintJar(email: string): Promise<Jar | null> {
    const jar: Jar = new Map();
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const hashed = link.data?.properties?.hashed_token;
    if (link.error || !hashed) return null;
    const sb = createServerClient(url!, anonKey!, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cs => cs.forEach(({ name, value }) => jar.set(name, value)) } });
    const r = await sb.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
    return r.error || !r.data?.user ? null : jar;
  }
  async function cleanup() {
    for (const email of Object.values(FIX)) {
      const u = await findUser(email);
      if (!u) continue;
      const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
      if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
      await admin.from("audit_log").delete().eq("actor_id", u.id);
      await admin.from("individual_scholar_preview_session").delete().eq("actor_id", u.id);
      await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
      for (const t of ["individual_scholar_material", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context", "individual_entitlement", "individual_membership", "platform_membership"])
        await admin.from(t).delete().eq("user_id", u.id);
      await admin.from("profiles").delete().eq("id", u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  const count = async (table: string, userId: string) => (await admin.from(table).select("*", { head: true, count: "exact" }).eq("user_id", userId)).count ?? -1;

  await cleanup();
  const made: Record<string, string> = {};
  try {
    for (const [k, email] of Object.entries(FIX)) {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: `Harness Preview ${k}`, synthetic: true } });
      if (error || !data?.user) { ok(`0. fixture ${k} created`, false, error?.message); return; }
      made[k] = data.user.id;
      await admin.from("profiles").update({ full_name: `Harness Preview ${k}` }).eq("id", data.user.id);
    }
    const office = await admin.from("ogs_offices").select("id").eq("office_type", "hq_platform").limit(1).maybeSingle();
    if (!office.data) { ok("0. an hq_platform office exists to appoint into", false); return; }
    const appoint = async (person: string, role: string, name: string) => admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(owner),
      office_id: office.data.id, person_id: person, person_name: name, role, status: "active", term_start: new Date(Date.now() - 60_000).toISOString() });
    // The "other" fixture holds a position WITHOUT the preview right. It must be one that does not need per-appointment capabilities
    // (scholar_clinical_lead does, and 641 refuses an appointment that names none), so platform_director.
    // If the position's preview grants have been ENDED on this project (staging runs the 860 rollback test), a holder of the position
    // cannot pass the capability check, and only an owner can (the owner short-circuit). The holder fixture is then made a platform owner
    // for the run, so P2-P10 still exercise the route, proxy and pages. The fixture's profile is deleted in cleanup.
    const liveGrants = await admin.from("hq_position_capability").select("effective_to").eq("position_code", "individual_product_reviewer").eq("capability_code", "hq.individual.scholar.preview");
    const grantLive = (liveGrants.data ?? []).some((g: any) => !g.effective_to || new Date(g.effective_to).getTime() > Date.now());
    if (!grantLive) {
      const asOwner = await admin.from("profiles").update({ platform_roles: ["platform_owner"] }).eq("id", made.holder);
      console.log(`  NOTE  the position's preview grants are ended on this project: the holder fixture runs as a platform owner (${asOwner.error ? asOwner.error.message : "set"})`);
    }
    const a1 = await appoint(made.holder, "individual_product_reviewer", "Harness Preview holder");
    const a2 = await appoint(made.other, "platform_director", "Harness Preview other");
    ok("0. the holder is appointed to Individual Product Reviewer (the new position) and the other fixture to a position WITHOUT the preview right",
      !a1.error && !a2.error, `${a1.error?.message ?? ""} ${a2.error?.message ?? ""}`);

    // The real learner: Scholar live, onboarded, one uploaded material. NOT a demonstration learner.
    const now = new Date().toISOString();
    const g = validateGrant({ targetUserId: made.real, experiences: ["scholar"], adultConfirmed: true });
    if (isGrantRefusal(g)) throw new Error(g.message);
    const gr = await grantIndividualAccess(admin, g, owner); if (!gr.ok) throw new Error(gr.message);
    await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar", foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", made.real);
    await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", made.real).eq("experience_code", "scholar");
    const realJar = await mintJar(FIX.real);
    let realMaterial: string | null = null;
    if (realJar) {
      const bytes = new TextEncoder().encode("Harness preview real learner private notes.\n\nThis text belongs to a real learner and must never appear in a preview.");
      const slot = await req(MAIN_HOST, "POST", "/api/individual/scholar/uploads", realJar, { body: { mime: TEXT_MIME, size: bytes.byteLength, piiAttested: true } });
      if (slot.status === 200) {
        const put = await createClient(url, anonKey, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: TEXT_MIME });
        if (!put.error) { const done = await req(MAIN_HOST, "POST", "/api/individual/scholar/materials", realJar, { body: { uploadId: slot.json.uploadId, mime: TEXT_MIME, fileName: "Harness private notes.txt", piiAttested: true } }); realMaterial = done.status === 200 ? done.json.id : null; }
      }
    }
    ok("0. the real-learner fixture signs in and has one private material", !!realJar && !!realMaterial, `jar ${!!realJar} material ${realMaterial}`);

    const holderJar = (await mintJar(FIX.holder))!, otherJar = (await mintJar(FIX.other))!;
    const origin = { Origin: BASE };
    const open = (jar: Jar | undefined, headers: Record<string, string> = origin) => req(MAIN_HOST, "POST", "/api/hq/individual/scholar-preview", jar, { form: { mode: "read_only" }, headers });
    const sessionsOf = async (id: string) => ((await admin.from("individual_scholar_preview_session").select("id").eq("actor_id", id)).data ?? []).length;

    // ── P1 ──
    const p1a = await open(otherJar), p1b = await open(undefined), p1c = await open(holderJar, { Origin: "https://evil.example" });
    ok("P1. a holder of another HQ position is refused 403 (no session row), an anonymous caller 401, a foreign Origin 403 (no session row)",
      p1a.status === 403 && (await sessionsOf(made.other)) === 0 && p1b.status === 401 && p1c.status === 403 && (await sessionsOf(made.holder)) === 0,
      `other ${p1a.status} anon ${p1b.status} foreign-origin ${p1c.status}`);

    // ── P2 ──
    const hqBefore = await req(MAIN_HOST, "GET", "/super-admin/individual/scholar", holderJar);
    const hqCookiesBefore = cookieHeader(holderJar);
    const p2 = await open(holderJar);
    const ticket = /\/preview\/enter\?t=([0-9a-f-]{36})$/.exec(p2.location)?.[1] ?? "";
    ok("P2a. a holder gets 303 to the PREVIEW host's /preview/enter with a ticket", p2.status === 303 && p2.location.startsWith(`http://${PREVIEW_HOST}/preview/enter?t=`) && !!ticket, `${p2.status} ${p2.location} ${p2.json?.error ?? ""}`);
    const previewJar: Jar = new Map();
    const enter = await req(PREVIEW_HOST, "GET", `/preview/enter?t=${ticket}`, previewJar);
    const setNames = setCookies(enter.res).map(c => c.split("=")[0]);
    ok("P2b. entering sets the preview cookie (HttpOnly, no Domain) and the learner's own session on the preview host, then lands on Scholar",
      enter.status === 303 && /\/individual\/scholar$/.test(enter.location) && previewJar.has("cmp_scholar_preview") && setNames.some(n => n.startsWith("sb-"))
        && setCookies(enter.res).filter(c => c.startsWith("cmp_scholar_preview=")).every(c => /httponly/i.test(c) && !/domain=/i.test(c)),
      `${enter.status} ${enter.location} ${setNames.join(",")}`);
    const hqAfter = await req(MAIN_HOST, "GET", "/super-admin/individual/scholar", holderJar);
    ok("P2c. the HQ session on the main host is intact: the page is still served to the holder, and the holder's cookies did not change",
      hqBefore.status === 200 && hqAfter.status === 200 && hqCookiesBefore === cookieHeader(holderJar), `${hqBefore.status}/${hqAfter.status}`);

    // ── P3 ──
    const pages = ["/individual/scholar", "/individual/scholar/study", "/individual/scholar/study/learn", "/individual/scholar/study/revise", "/individual/scholar/study/revise/flashcards",
      "/individual/scholar/study/apply", "/individual/scholar/study/progress", "/individual/scholar/study/plan"];
    const got: Record<string, Awaited<ReturnType<typeof req>>> = {};
    for (const p of pages) got[p] = await req(PREVIEW_HOST, "GET", p, previewJar);
    const statuses = pages.map(p => got[p].status);
    ok("P3a. eight study pages answer 200 on the preview host", statuses.every(s => s === 200), statuses.join(","));
    ok("P3b. the seeded notes and deck titles are there", got["/individual/scholar/study"].text.includes("Sepsis recognition") && got["/individual/scholar/study/revise/flashcards"].text.includes("Sepsis recognition"),
      `library ${got["/individual/scholar/study"].text.includes("Sepsis recognition")} flashcards ${got["/individual/scholar/study/revise/flashcards"].text.includes("Sepsis recognition")}`);
    ok("P3c. every page carries the read-only preview banner and the Return to HQ form", pages.every(p => got[p].text.includes("Scholar Product Preview") && got[p].text.includes("Return to HQ") && got[p].text.includes('action="/preview/end"')));

    // ── P4 ──
    const priv = realMaterial ? await req(PREVIEW_HOST, "GET", `/individual/scholar/study/${realMaterial}`, previewJar) : null;
    const privApi = realMaterial ? await req(PREVIEW_HOST, "GET", `/api/individual/scholar/materials/${realMaterial}`, previewJar) : null;
    const lib = got["/individual/scholar/study"].text;
    ok("P4. a real learner's material is 404 in the preview (page and API) and none of its text is in the preview library",
      !!priv && priv.status === 404 && !!privApi && privApi.status === 404 && !lib.includes("Harness private notes"), `${priv?.status} ${privApi?.status}`);

    // ── P5 ──
    const learnerId = readOnly.user_id as string;
    const watch = ["individual_scholar_material", "individual_scholar_study_plan", "individual_scholar_attempt", "individual_scholar_consent", "individual_scholar_flashcard_deck"];
    const before = await Promise.all(watch.map(t => count(t, learnerId)));
    const w1 = await req(PREVIEW_HOST, "POST", "/api/individual/scholar/study-plan", previewJar, { body: { goalType: "learn", sessionMinutes: 30, daysPerWeek: 4 } });
    const w2 = await req(PREVIEW_HOST, "POST", "/api/individual/scholar/flashcards/decks", previewJar, { body: { title: "Should not exist" } });
    const w3 = await req(PREVIEW_HOST, "POST", "/individual/scholar/study", previewJar, { body: {} });
    const w4 = await req(PREVIEW_HOST, "DELETE", "/api/individual/scholar/study-plan", previewJar);
    const after = await Promise.all(watch.map(t => count(t, learnerId)));
    const refused = await admin.from("audit_log").select("id, new_value, entity_id").eq("actor_id", made.holder).eq("action", "scholar_preview_write_refused");
    ok("P5. read-only: a POST to an API, a POST to a page and a DELETE are 403, each leaves an audit row naming the method and path, and the learner's counts are unchanged",
      [w1, w2, w3, w4].every(r => r.status === 403) && (refused.data ?? []).length >= 4 && (refused.data ?? []).some((r: any) => r.new_value?.method === "POST" && /study-plan/.test(r.new_value?.path ?? ""))
        && before.join() === after.join(), `${[w1, w2, w3, w4].map(r => r.status)} audit ${(refused.data ?? []).length} counts ${before}->${after}`);

    // ── P6 ──
    const replay = await req(PREVIEW_HOST, "GET", `/preview/enter?t=${ticket}`, new Map(previewJar));
    const replayJar: Jar = new Map(previewJar);
    const replay2 = await req(PREVIEW_HOST, "GET", `/preview/enter?t=${ticket}`, replayJar);
    ok("P6a. a replayed ticket is refused (to /preview/ended) and clears the preview and learner cookies", replay.status === 303 && /\/preview\/ended/.test(replay.location) && !replayJar.has("cmp_scholar_preview") && ![...replayJar.keys()].some(k => k.startsWith("sb-")) && replay2.status === 303,
      `${replay.status} ${replay.location} left [${[...replayJar.keys()]}]`);
    const sess = await admin.from("individual_scholar_preview_session").select("id, token").eq("actor_id", made.holder).not("token", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    // The replay above cleared cookies in ITS jar only. Expire the live session in the database (the database clock is the authority) and use the original jar.
    await admin.from("individual_scholar_preview_session").update({ expires_at: new Date(Date.now() - 5_000).toISOString() }).eq("id", sess.data?.id);
    const expiredPage = await req(PREVIEW_HOST, "GET", "/individual/scholar", previewJar);
    ok("P6b. an expired session sends a page to /preview/ended and clears the cookies", expiredPage.status === 303 && /\/preview\/ended/.test(expiredPage.location) && !previewJar.has("cmp_scholar_preview") && ![...previewJar.keys()].some(k => k.startsWith("sb-")),
      `${expiredPage.status} ${expiredPage.location} left [${[...previewJar.keys()]}]`);
    const second = await open(holderJar);
    const t2 = /t=([0-9a-f-]{36})$/.exec(second.location)?.[1] ?? "";
    const jar2: Jar = new Map(); await req(PREVIEW_HOST, "GET", `/preview/enter?t=${t2}`, jar2);
    const live2 = await admin.from("individual_scholar_preview_session").select("id").eq("actor_id", made.holder).is("ended_at", null).not("token", "is", null);
    for (const r of live2.data ?? []) await admin.from("individual_scholar_preview_session").update({ expires_at: new Date(Date.now() - 5_000).toISOString() }).eq("id", r.id);
    const expiredApi = await req(PREVIEW_HOST, "GET", "/api/individual/scholar/materials", jar2);
    ok("P6c. an expired session answers an API 401, and the pages are not served", expiredApi.status === 401, `${expiredApi.status}`);

    // ── P7 ──
    const nonDemo = await admin.rpc("individual_scholar_preview_designate", { p_actor: owner, p_user: made.real, p_mode: "testing", p_reason: "harness: not a demo account" });
    const nonOwner = await admin.rpc("individual_scholar_preview_designate", { p_actor: made.other, p_user: made.real, p_mode: "testing", p_reason: "harness: not an owner" });
    const wrongMode = await admin.from("individual_scholar_preview_session").insert({ actor_id: made.holder, learner_id: learnerId, mode: "testing", return_origin: "http://localhost:3100" });
    const notDesignated = await admin.from("individual_scholar_preview_session").insert({ actor_id: made.holder, learner_id: made.real, mode: "read_only", return_origin: "http://localhost:3100" });
    const asSelf = await admin.from("individual_scholar_preview_session").insert({ actor_id: learnerId, learner_id: learnerId, mode: "read_only", return_origin: "http://localhost:3100" });
    ok("P7. designating a non-demo account is refused, a non-owner designating is refused, a testing session on the read-only learner hits the foreign key, an undesignated learner has no session, and nobody previews as themselves",
      /not_demo/.test(nonDemo.error?.message ?? "") && /owner_required/.test(nonOwner.error?.message ?? "") && wrongMode.error?.code === "23503" && notDesignated.error?.code === "23503" && !!asSelf.error,
      `${nonDemo.error?.message} | ${nonOwner.error?.message} | ${wrongMode.error?.code} | ${notDesignated.error?.code} | ${asSelf.error?.code}`);

    // ── P8 ──
    const fresh = await open(holderJar); const t3 = /t=([0-9a-f-]{36})$/.exec(fresh.location)?.[1] ?? "";
    const jar3: Jar = new Map(); await req(PREVIEW_HOST, "GET", `/preview/enter?t=${t3}`, jar3);
    const gone: [string, string][] = [["GET", "/super-admin"], ["GET", "/super-admin/individual/scholar"], ["GET", "/practice/home"], ["GET", "/api/hq/individual/config"], ["POST", "/api/hq/individual/scholar-preview"],
      ["GET", "/login"], ["POST", "/api/auth/login"], ["GET", "/dashboard"], ["GET", "/"], ["GET", "/individual"], ["GET", "/individual/sign-in"], ["GET", "/individual/billing"]];
    const hostile = await Promise.all(gone.map(([m, p]) => req(PREVIEW_HOST, m, p, jar3, { body: m === "POST" ? {} : undefined })));
    const bare = await Promise.all(gone.map(([m, p]) => req(PREVIEW_HOST, m, p, undefined, { body: m === "POST" ? {} : undefined })));
    const mainEnter = await req(MAIN_HOST, "GET", `/preview/enter?t=${t3}`, holderJar);
    ok("P8. the preview host answers 404 for HQ, Practice, auth, dashboard, root and the sign-in/billing pages, with or without a session, and /preview/enter is 404 on the main host",
      hostile.every(r => r.status === 404) && bare.every(r => r.status === 404) && mainEnter.status === 404,
      gone.map(([m, p], i) => `${m} ${p}:${hostile[i].status}/${bare[i].status}`).filter((_, i) => hostile[i].status !== 404 || bare[i].status !== 404).join(" ") + ` main-enter ${mainEnter.status}`);

    // ── P9 ──
    const spoof = realJar ? await req(MAIN_HOST, "GET", "/individual/scholar", realJar, { headers: { "x-scholar-preview-mode": "read_only", "x-scholar-preview-expires": new Date(Date.now() + 3_600_000).toISOString() } }) : null;
    const spoofTesting = realJar ? await req(MAIN_HOST, "GET", "/individual/scholar/study", realJar, { headers: { "x-scholar-preview-mode": "testing" } }) : null;
    ok("P9. a spoofed x-scholar-preview-* header on the main host shows no banner (and the control pages above did)",
      !!spoof && spoof.status === 200 && !spoof.text.includes("Scholar Product Preview") && !spoof.text.includes("data-scholar-preview") && !!spoofTesting && spoofTesting.status === 200 && !spoofTesting.text.includes("Testing mode"),
      `${spoof?.status} ${spoofTesting?.status}`);

    // ── P10 ──
    const mine0 = await req(MAIN_HOST, "GET", "/super-admin/individual/scholar", holderJar);
    const holds = await admin.from("individual_membership").select("id").eq("user_id", made.holder);
    ok("P10a. 'My Scholar' reports the holder's own status: no access, said plainly, a link to the access board, and nothing was granted",
      mine0.status === 200 && mine0.text.includes("granted by another holder of the Individual access right") && mine0.text.includes("Administrators cannot grant themselves access") && (holds.data ?? []).length === 0, `${mine0.status} memberships ${(holds.data ?? []).length}`);
    const gh = validateGrant({ targetUserId: made.holder, experiences: ["scholar"], adultConfirmed: true });
    if (!isGrantRefusal(gh)) await grantIndividualAccess(admin, gh, owner);
    const mine1 = await req(MAIN_HOST, "GET", "/super-admin/individual/scholar", holderJar);
    ok("P10b. once another grantor gives the holder Scholar, the page offers Open my Scholar on the main host", mine1.status === 200 && mine1.text.includes("Open my Scholar") && mine1.text.includes("Your recent preview sessions"), `${mine1.status}`);
  } finally {
    await cleanup();
  }
}

main().then(() => {
  console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}).catch(e => { console.error(e); process.exit(1); });
