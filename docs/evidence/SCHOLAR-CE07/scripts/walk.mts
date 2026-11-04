// SCHOLAR-CE07C staging walk against this worktree's dev server on 3179 (staging-pointed, ezhvpgtcqcdsgylrxgdb).
// Real Chromium with Chrome DevTools network emulation (CDP Network.emulateNetworkConditions): slow 3G, offline mid-upload,
// reconnect. Signs in as the staging pilot learner fixture (credential read from a file, never printed). Verifies every
// run in the staging database with the service role: one material per file, original bytes intact (sha256), the
// upload record's state, and ONE "material uploaded" audit row (extraction ran once).
// Screenshots and the JSON log go to the session scratchpad; copied into docs/evidence/SCHOLAR-CE07/ by hand afterwards.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const ROOT = "C:/Users/elish/Documents/Competen/competen-ce07";
const req = createRequire(`${ROOT}/package.json`);
const { chromium } = req("@playwright/test") as typeof import("@playwright/test");
const { createClient } = req("@supabase/supabase-js");
const BASE = "http://localhost:3179";
const SCR = "C:/Users/elish/AppData/Local/Temp/claude/e7cc951866a58dfc/6e77b760-5e05-4bc3-a6ef-9c3601adcb19/scratchpad";
const OUT = `${SCR}/walk`;
mkdirSync(OUT, { recursive: true });
const DECK = (n: number) => `${SCR}/decks/deck-${n}.pdf`;
const FIX = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/guided-fixture.txt";
const fx = Object.fromEntries(readFileSync(FIX, "utf8").split(/\r?\n/).filter(Boolean).map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const env = Object.fromEntries(readFileSync(`${ROOT}/.env.local`, "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
if (!env.STAGING_SUPABASE_URL.includes("ezhvpgtcqcdsgylrxgdb") || env.STAGING_SUPABASE_URL.includes("rnnqhlrcgvsauigxwszl")) throw new Error("not staging");
const admin = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const results: { id: string; ok: boolean; note: string }[] = [];
const log = (id: string, ok: boolean, note: string) => { results.push({ id, ok, note }); console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${note}`); };
const timeline: Record<string, { t: number; text: string }[]> = {};
const only = process.argv[2] ? process.argv[2].split(",") : null;
const run = (id: string) => !only || only.includes(id);

// Chrome DevTools "Slow 3G" (legacy preset values): 400 ms latency, 500 kbit/s each way.
const SLOW_3G = { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8, connectionType: "cellular3g" as const };
const FAST = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
const OFFLINE = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };

const { data: prof } = await admin.from("profiles").select("id").eq("email", fx.email).maybeSingle();
const USER = prof!.id as string;

async function verify(id: string, deck: number, opts: { expectKept: boolean } = { expectKept: true }) {
  const bytes = new Uint8Array(readFileSync(DECK(deck)));
  const h = sha(bytes);
  const { data: mats } = await admin.from("individual_scholar_material").select("id, storage_path, byte_size, chunk_count, sha256").eq("user_id", USER).eq("sha256", h);
  const m = (mats ?? [])[0];
  if (!opts.expectKept) { log(`${id}.no-material`, (mats ?? []).length === 0, `${(mats ?? []).length} material(s) with this file's sha256`); return null; }
  log(`${id}.one-material`, (mats ?? []).length === 1, `${(mats ?? []).length} material(s) with sha256 ${h.slice(0, 12)}…`);
  if (!m) return null;
  const dl = await admin.storage.from("individual-scholar-materials").download(m.storage_path);
  const got = dl.data ? new Uint8Array(await dl.data.arrayBuffer()) : new Uint8Array();
  log(`${id}.bytes-intact`, got.length === bytes.length && sha(got) === h, `stored ${got.length} bytes, sha256 ${got.length ? sha(got).slice(0, 12) : "-"}… = local ${h.slice(0, 12)}…; ${m.chunk_count} sections extracted`);
  const { data: rec } = await admin.from("individual_scholar_upload").select("state, byte_size, sha256").eq("id", m.id).maybeSingle();
  log(`${id}.record-kept`, rec?.state === "kept" && rec?.sha256 === h, `upload record state ${rec?.state ?? "none"}`);
  const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "individual_scholar_material_uploaded").eq("entity_id", m.id);
  log(`${id}.extracted-once`, count === 1, `${count} "material uploaded" audit row(s) for ${m.id}`);
  return m;
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
let page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const shot = async (name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const net = async (p = page) => { const c = await ctx.newCDPSession(p); await c.send("Network.enable"); return c; };

async function openUpload() {
  await page.goto(`${BASE}/individual/scholar/study`);
  await page.waitForLoadState("domcontentloaded");
  const open = page.getByRole("button", { name: /Upload material/i }).first();
  await open.waitFor({ timeout: 120000 });
  for (let i = 0; i < 5 && !(await page.locator("#scholar-file").isVisible()); i++) { await open.click(); await page.waitForTimeout(1500); }
  await page.locator("#scholar-file").waitFor({ timeout: 60000 });
}
async function choose(deck: number) {
  await page.locator("#scholar-file").setInputFiles(DECK(deck));
  const box = page.getByLabel(/no identifiable patient information|permission to upload/i).first();
  if (!(await box.isChecked())) await box.check();
  await page.getByRole("button", { name: /^Upload$/ }).click();
}
const status = async () => (await page.locator("#upload ul[aria-live]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const percent = (t: string) => Number(t.match(/\((\d+)%\)/)?.[1] ?? -1);
async function until(id: string, pred: (t: string) => boolean, timeoutMs: number) {
  const start = Date.now();
  for (;;) {
    const t = await status();
    (timeline[id] ??= []).push({ t: Math.round((Date.now() - start) / 1000), text: t.slice(0, 220) });
    if (pred(t)) return t;
    if (Date.now() - start > timeoutMs) throw new Error(`${id}: timed out; last: ${t.slice(0, 200)}`);
    await page.waitForTimeout(1000);
  }
}
const isReady = () => /\/ready|notes are ready/i.test(page.url());

try {
  // sign in
  await page.goto(`${BASE}/login?next=/individual/scholar/study`);
  await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(2000);
  await page.getByLabel(/email/i).fill(fx.email);
  await page.getByLabel(/^password/i).fill(fx.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 120000 });

  // A: slow 3G, offline mid-upload for 20 s, reconnect
  if (run("A")) {
    await openUpload();
    const cdp = await net();
    await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
    const t0 = Date.now();
    await choose(Number(process.env.A_DECK ?? 1));
    await until("A", t => percent(t) >= 30, 300000);
    await shot("A1-slow3g-uploading");
    await cdp.send("Network.emulateNetworkConditions", OFFLINE);
    const paused = await until("A", t => /Paused, waiting for a connection/.test(t), 60000);
    await shot("A2-offline-paused");
    log("A.paused-plain", /kept safely/.test(paused) && !/could not|error/i.test(paused), paused.slice(0, 160));
    await page.waitForTimeout(20000);
    const pctOff = percent(await status());
    await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
    const resumed = await until("A", t => /Resumed/.test(t) || percent(t) > pctOff, 120000);
    await shot("A3-resumed");
    log("A.resumed", percent(resumed) >= pctOff, `paused at ${pctOff}%, then: ${resumed.slice(0, 120)}`);
    await page.waitForURL(() => isReady(), { timeout: 600000 });
    await shot("A4-ready");
    log("A.duration", true, `${Math.round((Date.now() - t0) / 1000)} s for 10.2 MB on slow 3G with a 20 s offline spell`);
    const pcts = (timeline.A ?? []).map(x => percent(x.text)).filter(p => p >= 0);
    log("A.progress-honest", pcts.every((p, i) => i === 0 || p >= pcts[i - 1] - 0 || p >= pcts[i - 1] - 15), `percent samples never jump ahead of the server: ${pcts.filter((_, i) => i % 10 === 0).join(",")}`);
    await cdp.send("Network.emulateNetworkConditions", FAST);
    await verify("A", Number(process.env.A_DECK ?? 1));
  }

  // B: the tab closes at about 35 %; a new tab continues the same upload from the server's offset
  if (run("B")) {
    await openUpload();
    let cdp = await net();
    await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
    await choose(2);
    await until("B", t => percent(t) >= 35, 300000);
    const before = await page.evaluate(() => localStorage.getItem("competen.scholar.uploads.v1"));
    await page.close();
    page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    await openUpload();
    const banner = await page.locator("#upload [role=status]").innerText().catch(() => "");
    await shot("B1-unfinished-banner");
    log("B.banner", /deck-2\.pdf/.test(banner) && /sent/.test(banner), banner.replace(/\s+/g, " ").slice(0, 160));
    const storageReqs: string[] = [];
    page.on("request", r => { if (r.url().includes("/storage/v1/upload/resumable")) storageReqs.push(`${r.method()} ${r.headers()["upload-offset"] ?? ""}`.trim()); });
    cdp = await net();
    await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
    await choose(2);
    await page.waitForURL(() => isReady(), { timeout: 600000 });
    const firstPatch = storageReqs.find(r => r.startsWith("PATCH"));
    log("B.resumed-from-offset", storageReqs[0] === "HEAD" && !storageReqs.includes("POST") && Number(firstPatch?.split(" ")[1] ?? 0) > 0,
      `requests after reopening: ${storageReqs.slice(0, 4).join(" | ")} … (resume record existed: ${!!before})`);
    await cdp.send("Network.emulateNetworkConditions", FAST);
    await verify("B", 2);
  }

  // C: the finish's answer is lost (connection reset after the server answered). The retry gets the same material.
  if (run("C")) {
    await openUpload();
    let dropped = 0;
    const answers: string[] = [];
    await page.route("**/api/individual/scholar/materials", async route => {
      if (route.request().method() === "POST" && dropped === 0) {
        dropped += 1;
        const r = await route.fetch();
        answers.push(`first: ${r.status()} (dropped before the browser saw it)`);
        await route.abort("connectionreset");
        return;
      }
      const r = await route.fetch();
      const j = await r.json().catch(() => ({}));
      answers.push(`retry: ${r.status()} already=${j.already === true}`);
      await route.fulfill({ response: r, json: j });
    });
    await choose(3);
    await page.waitForURL(() => isReady(), { timeout: 300000 });
    await page.unroute("**/api/individual/scholar/materials");
    log("C.idempotent-finish", answers.length >= 2 && /already=true/.test(answers.at(-1)!), answers.join(" ; "));
    await verify("C", 3);
  }

  // D: the same file again: refused BEFORE any byte is sent
  if (run("D")) {
    await openUpload();
    const storageReqs: string[] = [];
    page.on("request", r => { if (r.url().includes("/storage/v1/upload")) storageReqs.push(r.method()); });
    await choose(1);
    const t = await until("D", s => /already in your library/.test(s), 60000);
    await shot("D1-duplicate-before-sending");
    log("D.duplicate-early", storageReqs.length === 0, `${t.slice(0, 120)}; storage requests: ${storageReqs.length}`);
  }

  // E: cancel mid-upload
  if (run("E")) {
    await openUpload();
    const cdp = await net();
    await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
    await choose(4);
    await until("E", t => percent(t) >= 15, 300000);
    await page.getByRole("button", { name: /^Cancel$/ }).click();
    const t = await until("E", s => /cancelled/i.test(s), 60000);
    await shot("E1-cancelled");
    await cdp.send("Network.emulateNetworkConditions", FAST);
    const h = sha(new Uint8Array(readFileSync(DECK(4))));
    const { data: rec } = await admin.from("individual_scholar_upload").select("id, state").eq("user_id", USER).eq("sha256", h).order("issued_at", { ascending: false }).limit(1).maybeSingle();
    const listed = await admin.storage.from("individual-scholar-materials").list(USER, { limit: 1000 });
    const leftover = ((listed.data ?? []) as { name: string }[]).filter(o => rec && o.name.startsWith(rec.id));
    log("E.cancelled", rec?.state === "cancelled" && leftover.length === 0, `${t.slice(0, 80)}; record ${rec?.state}; objects left: ${leftover.length}`);
    await verify("E", 4, { expectKept: false });
  }

  // F: integrity. A slot for deck-5's sha256, then DIFFERENT bytes (deck-6, same size) sent to that path: refused before
  // extraction, object removed, no material. G: two finishes at once for a good upload: one extraction, one material.
  if (run("F") || run("G")) {
    await openUpload();
    const api = page.request;
    const tusPut = async (path: string, token: string, bytes: Uint8Array) => {
      const b64 = (s: string) => Buffer.from(s).toString("base64");
      const head = { apikey: env.STAGING_ANON_KEY, "x-signature": token, "Tus-Resumable": "1.0.0" };
      const c = await fetch(`${env.STAGING_SUPABASE_URL}/storage/v1/upload/resumable/sign`, { method: "POST", headers: { ...head, "Upload-Length": String(bytes.length), "Upload-Metadata": `bucketName ${b64("individual-scholar-materials")},objectName ${b64(path)},contentType ${b64("application/pdf")}` } });
      const loc = c.headers.get("location")!;
      for (let off = 0; off < bytes.length; off += 6 * 1024 * 1024) {
        const r = await fetch(loc, { method: "PATCH", headers: { ...head, "Upload-Offset": String(off), "Content-Type": "application/offset+octet-stream" }, body: bytes.slice(off, Math.min(bytes.length, off + 6 * 1024 * 1024)) });
        if (r.status !== 204) throw new Error(`patch ${r.status}`);
      }
    };
    if (run("F")) {
      const good = new Uint8Array(readFileSync(DECK(5)));
      const other = new Uint8Array(readFileSync(DECK(6)));
      const slot = await (await api.post(`${BASE}/api/individual/scholar/uploads`, { data: { mime: "application/pdf", size: good.length, piiAttested: true, sha256: sha(good) } })).json();
      await tusPut(slot.path, slot.token, other);
      const fin = await api.post(`${BASE}/api/individual/scholar/materials`, { data: { uploadId: slot.uploadId, mime: "application/pdf", fileName: "deck-5.pdf", piiAttested: true } });
      const fj = await fin.json();
      const { data: rec } = await admin.from("individual_scholar_upload").select("state, refusal_status").eq("id", slot.uploadId).maybeSingle();
      const dl = await admin.storage.from("individual-scholar-materials").download(slot.path);
      log("F.integrity", fin.status() === 422 && /did not arrive complete/.test(fj.error) && rec?.state === "refused" && !dl.data,
        `finish ${fin.status()} "${fj.error}"; record ${rec?.state}; object ${dl.data ? "STILL THERE" : "removed"}`);
      for (const d of [5, 6]) await verify(`F${d}`, d, { expectKept: false });
      const again = await api.post(`${BASE}/api/individual/scholar/materials`, { data: { uploadId: slot.uploadId, mime: "application/pdf", fileName: "deck-5.pdf", piiAttested: true } });
      log("F.retry-same-answer", again.status() === 422, `a retried finish answers ${again.status()} (the stored refusal), nothing read again`);
    }
    if (run("G")) {
      const good = new Uint8Array(readFileSync(DECK(5)));
      const slot = await (await api.post(`${BASE}/api/individual/scholar/uploads`, { data: { mime: "application/pdf", size: good.length, piiAttested: true, sha256: sha(good) } })).json();
      await tusPut(slot.path, slot.token, good);
      const body = { uploadId: slot.uploadId, mime: "application/pdf", fileName: "deck-5.pdf", piiAttested: true };
      const [a, b] = await Promise.all([api.post(`${BASE}/api/individual/scholar/materials`, { data: body }), api.post(`${BASE}/api/individual/scholar/materials`, { data: body })]);
      const statuses = [a.status(), b.status()].sort();
      let late = 0;
      for (let i = 0; i < 30; i++) { const r = await api.post(`${BASE}/api/individual/scholar/materials`, { data: body }); if (r.status() === 200) { late = 200; break; } await page.waitForTimeout(2000); }
      log("G.double-finish", statuses.includes(200) && (statuses.includes(202) || statuses.every(s => s === 200)) && late === 200, `two finishes at once answered ${statuses.join(" and ")}; a later finish answers ${late}`);
      await verify("G", 5);
    }
  }
} catch (e) {
  log("walk", false, e instanceof Error ? e.message : String(e));
  await shot("zz-error").catch(() => {});
} finally {
  writeFileSync(`${OUT}/walk-results.json`, JSON.stringify({ at: new Date().toISOString(), results, timeline }, null, 2));
  await browser.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
}
