/* eslint-disable @typescript-eslint/no-explicit-any */
// SCHOLAR-PLAN-UNITS-01 staging regression helper (temporary, not committed). STAGING ONLY (assertSafeTarget).
//   node_modules/.bin/tsx scripts/tmp-plan-units/stage-upload.ts <pptx path> <cookie-out.json> [--base http://localhost:3172]
// Mints a session for the sandbox demo learner exactly as provision-scholar-demo-learner.ts does (magic link + verifyOtp, no
// password), uploads the deck through the real HTTP API, runs topic finding, prints the material id and the proposal the
// server now gives, and writes the cookie jar to <cookie-out.json> (scratchpad only, never printed).
import { loadEnvConfig } from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { assertSafeTarget } from "../production-guard";
import { PPTX_MIME } from "../../src/lib/individual/scholar/config";
import { request as httpRequest } from "node:http";

loadEnvConfig(process.cwd(), true);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "stage-upload");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const args = process.argv.slice(2);
const file = args[0], out = args[1];
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3172";
const EMAIL = process.env.PLAN_UNITS_LEARNER ?? "scholar-demo-sandbox@competen.demo";
type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
// The dev server compiles each route on first use (minutes under webpack): plain node:http with no timeout for LOCAL requests.
function localRequest(method: string, path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; setCookie: string[]; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, setCookie: ([] as string[]).concat(res.headers["set-cookie"] ?? []), text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await localRequest(method, path, { "Content-Type": "application/json", Cookie: cookieHeader(jar) }, body === undefined ? undefined : JSON.stringify(body));
  for (const c of res.setCookie) {
    const [pair] = c.split(";"); const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
  let json: any = {};
  try { json = JSON.parse(res.text); } catch { json = {}; }
  return { status: res.status, json };
}
async function mintJar(email: string): Promise<Jar | null> {
  const jar: Jar = new Map();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) { console.error("generateLink failed", link.error?.message); return null; }
  const sb = createServerClient(url!, anonKey!, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cs => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  const r = await sb.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  return r.error || !r.data?.user ? null : jar;
}
/** Slow network to Supabase today (3-12 s TCP connects): try up to six times, 8 s apart, until the check passes. */
async function retry<T>(what: string, fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let i = 1; i <= 6; i++) {
    try { last = await fn(); if (ok(last)) return last; console.log(`${what}: attempt ${i} not ok`, JSON.stringify(last).slice(0, 160)); }
    catch (e) { console.log(`${what}: attempt ${i} threw`, (e as any)?.cause?.code ?? (e as Error).message); }
    await new Promise(r => setTimeout(r, 8000));
  }
  return last as T;
}
async function main() {
  console.log(`target ${ref}, server ${BASE}, learner ${EMAIL}`);
  const jar = await retry("mint", () => mintJar(EMAIL), j => !!j);
  if (!jar) { console.error("could not mint a session"); process.exit(1); }
  const bytes = new Uint8Array(readFileSync(file));
  const slot = await retry("slot", () => send("POST", "/api/individual/scholar/uploads", { mime: PPTX_MIME, size: bytes.byteLength, piiAttested: true }, jar), r => r.status === 200 || r.status === 400 || r.status === 403);
  if (slot.status !== 200) { console.error("upload slot refused", slot.status, slot.json); process.exit(1); }
  const put = await retry("put", () => createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: PPTX_MIME }), r => !r.error);
  if (put.error) { console.error("storage put failed", put.error.message); process.exit(1); }
  const done = await retry("material", () => send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime: PPTX_MIME, fileName: "Essential Nursing Care of the Critically Ill.pptx", piiAttested: true }, jar), r => r.status === 200 || r.status === 409 || r.status === 400);
  if (done.status !== 200) { console.error("material refused", done.status, done.json); process.exit(1); }
  const id = done.json.id as string;
  console.log("material", id, JSON.stringify({ pageCount: done.json.pageCount, chunkCount: done.json.chunkCount, quality: done.json.quality ?? done.json.extractionQuality ?? null }));
  let left = 99;
  for (let rounds = 0; left > 0 && rounds < 10; rounds++) {
    const r = await retry("analyse", () => send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, jar), x => x.status === 200);
    console.log("analyse round", rounds + 1, r.status, JSON.stringify(r.json).slice(0, 160));
    if (r.status !== 200) break;
    left = r.json.remaining ?? 0;
  }
  const prop = await retry("proposal", () => send("GET", `/api/individual/scholar/plan/proposal?materialId=${id}`, undefined, jar), x => x.status === 200);
  const p = prop.json?.proposal;
  if (p) {
    console.log("BEFORE (old path, distinct labels x 12):", `${p.newSections} sections to plan, about ${p.newSections * 12} minutes in all`);
    console.log("AFTER:", p.summary);
    console.log("units:", (p.units ?? []).map((u: any) => `${u.id} ${u.cite} (${u.parts.length}) ${u.title} | ${u.estimate.total} min`).join("\n       "));
  } else console.log("proposal", prop.status, JSON.stringify(prop.json).slice(0, 300));
  writeFileSync(out, JSON.stringify([...jar]), "utf8");
  console.log("cookie jar written");
}
main();
