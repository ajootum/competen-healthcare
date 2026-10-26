/**
 * SCHOLAR HFE REDESIGN -- a disposable staging student for looking at the redesigned Scholar shell in a browser.
 *
 *   npx tsx scripts/scholar-hfe-fixture.ts up <base-url>    create harness-hfe-student@competen.test, Scholar granted,
 *                                                           onboarded, terms accepted, with one pasted-text material;
 *                                                           the generated password is written to the path in HFE_PW_FILE
 *   npx tsx scripts/scholar-hfe-fixture.ts down             delete it and everything it owns
 *
 * Reads shared configuration and never writes it. ⚠ STAGING ONLY (assertSafeTarget refuses production).
 */
import { writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME } from "../src/lib/individual/scholar/config";

loadEnvConfig(process.cwd(), true); // dev: .env.development.local carries the local review legal versions
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
assertSafeTarget(url, "scholar-hfe-fixture");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const FIX = { grantor: "harness-hfe-grantor@competen.test", student: "harness-hfe-student@competen.test" };
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};
const NOTES = "Clinical assessment study notes.\n\nReasoning with incomplete information. Begin by identifying what you know, what remains uncertain, and which missing information could change your decision.\n\nState your working explanation alongside alternatives. Explain which findings support or weaken each possibility.\n\nRevisit your explanation as new information becomes available, and recognise when to seek supervision.";

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: { email?: string }) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function down() {
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
    if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: { name: string }) => `${u.id}/${o.name}`));
    for (const t of ["individual_scholar_case_session", "individual_scholar_case", "individual_scholar_revision_session", "individual_scholar_revision_set", "individual_scholar_learning_session", "individual_scholar_learning_preference",
      "individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context",
      "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log"])
      await admin.from(t).delete().eq(t === "audit_log" || t === "plat_ai_requests" ? "actor_id" : "user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
  console.log("fixture removed");
}
async function up(base: string) {
  await down();
  const pw = `hfe-${Math.random().toString(36).slice(2)}-Aa1!`;
  const mk = async (email: string, name: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw error;
    await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
    return data.user.id as string;
  };
  const grantor = await mk(FIX.grantor, "HFE Grantor"), s = await mk(FIX.student, "Harness Scholar");
  const now = new Date().toISOString();
  const req = validateGrant({ targetUserId: s, experiences: ["scholar"], adultConfirmed: true });
  if (isGrantRefusal(req)) throw new Error(req.message);
  const g = await grantIndividualAccess(admin, req, grantor); if (!g.ok) throw new Error(g.message);
  await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar",
    foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", s);
  await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", s);

  // One pasted-text material, through the same routes the upload form uses.
  const jar = new Map<string, string>();
  const send = async (path: string, body: unknown) => {
    const res = await fetch(base + path, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify(body) });
    for (const c of (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie?.() ?? []) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const login = await send("/api/auth/login", { email: FIX.student, password: pw });
  const bytes = new TextEncoder().encode(NOTES);
  const slot = await send("/api/individual/scholar/uploads", { mime: TEXT_MIME, size: bytes.byteLength, piiAttested: true });
  let material = "not uploaded";
  if (slot.status === 200) {
    const put = await createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: TEXT_MIME });
    if (!put.error) {
      const done = await send("/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime: TEXT_MIME, fileName: "Clinical assessment.txt", piiAttested: true });
      material = done.status === 200 ? "uploaded" : `refused ${done.status} ${done.json.error ?? ""}`;
    }
  } else material = `slot refused ${slot.status} ${slot.json.error ?? ""}`;
  const out = process.env.HFE_PW_FILE;
  if (out) writeFileSync(out, pw);
  console.log(`fixture up: login ${login.status}, material ${material}${out ? `, password written to HFE_PW_FILE` : ""}`);
}

const [cmd, base] = process.argv.slice(2);
(cmd === "up" ? up(base ?? "http://localhost:3117") : cmd === "down" ? down() : Promise.reject(new Error("up <base> | down"))).catch(e => { console.error(e); process.exit(1); });
