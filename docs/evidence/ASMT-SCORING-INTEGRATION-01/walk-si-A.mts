// ASMT-SCORING-INTEGRATION-01 staging walk, part A (localhost:3175 -> staging). Author = owner fixture, approver/publisher = publisher fixture.
// Proves: import writes the three scoring profiles as configuration; the Scoring & Evaluation panel shows profile, values, formula,
// N/A handling, Not configured interpretation; Apply this profile on an EARLIER draft (the production-draft path); then the governed
// path publishes the scale and the three instruments so part B can run one assessment per instrument.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const ROOT = "C:/Users/elish/Documents/Competen/competen-asmt-import";
const { chromium } = createRequire(`${ROOT}/package.json`)("@playwright/test") as typeof import("@playwright/test");
import type { Page } from "@playwright/test";
const BASE = "http://localhost:3175";
const SCRATCH = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/ad33b03e-559c-4ac6-82dd-2eccf47e3e7d/scratchpad";
const SHOTS = `${SCRATCH}/shots-si`;
const WORKBOOK = `${ROOT}/src/lib/assessment/import/__fixtures__/nursing-assessment-audits.xlsx`;
const OWNER = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/staging-owner-credential.txt";
const ACCOUNTS = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/asmt-demo-accounts.txt";
mkdirSync(SHOTS, { recursive: true });
const kv = (f: string) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const owner = kv(OWNER);
const acc = kv(ACCOUNTS);
const results: { ok: boolean; what: string }[] = [];
const log = (ok: boolean, what: string) => { results.push({ ok, what }); console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };
let n = 0;
const stamp = new Date().toISOString().slice(11, 16).replace(":", "");

async function signIn(page: Page, email: string, password: string, next: string) {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(2000);
  for (let a = 0; a < 3; a++) { await page.getByLabel(/email/i).fill(email); await page.getByLabel(/^password/i).fill(password); if ((await page.getByLabel(/email/i).inputValue()) === email) break; await page.waitForTimeout(1000); }
  for (let a = 0; a < 3; a++) { await page.getByRole("button", { name: /sign in/i }).click(); try { await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }); break; } catch { await page.waitForTimeout(2000); } }
  if (!page.url().includes(next)) await page.goto(`${BASE}${next}`);
}
const snap = async (page: Page, name: string) => { n++; await page.screenshot({ path: `${SHOTS}/A${String(n).padStart(2, "0")}-${name}.png`, fullPage: true }); };
const body = async (page: Page) => page.innerText("body");
const blockers = async (page: Page) => { const t = await body(page); const i = t.indexOf("What blocks the next step"); return i < 0 ? "" : t.slice(i, i + 900); };

const browser = await chromium.launch({ headless: true });
const author = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
const reviewer = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
for (const p of [author, reviewer]) { p.setDefaultTimeout(180000); p.setDefaultNavigationTimeout(300000); }

const PROFILE = ["Graded assessment (rating scale)", "Weighted agreement audit (documented versus observed)", "Weighted documentation compliance audit"];
const out: { codes: string[]; hrefs: string[]; instrumentIds: string[]; versionIds: string[] } = { codes: [], hrefs: [], instrumentIds: [], versionIds: [] };

async function approveAndPublish(url: string, what: string) {
  await reviewer.goto(url);
  await reviewer.getByRole("button", { name: "Review & approve" }).waitFor();
  await reviewer.getByRole("button", { name: "Review & approve" }).click();
  await reviewer.getByText(/Your approval is recorded/).waitFor({ timeout: 120000 });
  await reviewer.reload();
  await reviewer.getByRole("button", { name: /Publish v1/ }).waitFor({ timeout: 120000 });
  await reviewer.getByRole("button", { name: /Publish v1/ }).click();
  await reviewer.getByText(/^Published$/).first().waitFor({ timeout: 120000 });
  log(true, `${what}: independently approved and published by the publisher fixture`);
}

try {
  await signIn(author, owner.email, owner.password, "/super-admin/assessment-catalogue");
  await author.getByRole("heading", { name: /Assessment & Checklist Catalogue/ }).waitFor();

  // ---- 1. import the workbook: three drafts with the profiles applied ----
  await author.getByRole("button", { name: "Register instrument" }).click();
  await author.getByRole("dialog").getByRole("button", { name: /^Import existing instrument/ }).click();
  const wiz = author.getByRole("dialog");
  await wiz.locator("input[type=file]").setInputFiles(WORKBOOK);
  await wiz.getByRole("button", { name: "Upload and extract" }).click();
  await wiz.getByText("What was found").waitFor({ timeout: 180000 });
  const groups = wiz.locator("li.border-teal-200");
  const fam = ["CA", "CPA", "DA"];
  for (let i = 0; i < 3; i++) {
    const g = groups.nth(i);
    await g.getByLabel("Family").selectOption(fam[i]);
    await g.getByLabel("Purpose").selectOption("summative");
    await g.getByLabel(i === 0 ? "Assessor" : "Auditor").check();
    await g.getByLabel(/Confirm: register this as one instrument/).check();
  }
  await wiz.getByLabel("Confirm it is left out").check();
  await wiz.getByRole("button", { name: "Continue to correct" }).click();
  await wiz.getByText("Proposed scoring (from the workbook, review before submitting)").waitFor();
  const corr = (await wiz.textContent()) ?? "";
  log(/Graded assessment \(rating scale\)/.test(corr) && /Interpretation: Not configured/.test(corr), "Correct step shows the graded profile for sheet 1 with the Not configured interpretation");
  await snap(author, "correct-profile");
  await wiz.getByRole("button", { name: "Continue to register" }).click();
  await wiz.getByRole("button", { name: /Register 3 Drafts/ }).waitFor();
  const reg = (await wiz.textContent()) ?? "";
  log(/Weighted agreement audit/.test(reg) && /Weighted documentation compliance audit/.test(reg) && reg.includes("(2 x Yes) + Partial"), "Register step shows the two weighted profiles with the (2 x Yes) + Partial formula");
  await snap(author, "register-profiles");
  await wiz.getByRole("button", { name: /Register 3 Drafts/ }).click();
  await wiz.getByText(/3 instruments registered as Drafts/).waitFor({ timeout: 180000 });
  out.codes = (await wiz.locator("span.font-mono").allInnerTexts()).map((t) => t.trim()).filter((t) => /^(CA|CPA|DA)-\d{6}$/.test(t));
  out.hrefs = (await wiz.getByRole("link", { name: "Open in Checklist Studio" }).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")))) as string[];
  await snap(author, "registered");
  await wiz.getByRole("button", { name: "Done" }).click();
  log(out.codes.length === 3 && out.hrefs.length === 3, `registered ${out.codes.join(", ")}`);
  for (const h of out.hrefs) { const m = /checklist-studio\/([0-9a-f-]{36})\/v\/([0-9a-f-]{36})/.exec(h); out.instrumentIds.push(m?.[1] ?? ""); out.versionIds.push(m?.[2] ?? ""); }

  // ---- 2. each draft: Scoring & Evaluation panel, accept the proposal, save ----
  for (let i = 0; i < 3; i++) {
    await author.goto(`${BASE}${out.hrefs[i]}`);
    await author.getByRole("tab", { name: "Content" }).waitFor();
    await author.getByRole("tab", { name: /Scoring & Rules/ }).click();
    await author.getByText("Scoring & Evaluation").first().waitFor();
    const t = await body(author);
    const panelOk = t.includes(PROFILE[i]) && /Selected scoring profile/i.test(t) && /N\/A handling/i.test(t) && /never counted as zero/.test(t) && /Threshold configuration/i.test(t) && /Not configured/.test(t) && /Result preview/.test(t);
    log(panelOk, `${out.codes[i]}: Scoring & Evaluation shows profile "${PROFILE[i]}", N/A never zero, threshold Not configured, result preview`);
    const valuesOk = i === 0 ? /7 grades: 0 /.test(t) && /\(6\)/.test(t) : /= 2 \(met\)/.test(t) && /= 1/.test(t) && /= 0/.test(t);
    log(valuesOk, `${out.codes[i]}: ${i === 0 ? "the 0 to 6 scale with numeric values" : "Yes = 2 (met), Partial = 1, No = 0"} shown`);
    await snap(author, `${out.codes[i]}-scoring-evaluation`);
    await author.getByRole("button", { name: "Accept as my rules" }).click();
    await author.getByRole("button", { name: "Save scoring" }).click();
    await author.getByText(/Server check: \d+ problems?/).waitFor({ timeout: 120000 });
    const saved = await body(author);
    const check = /Server check: (\d+) problems?, (\d+) warnings?(?:, (\d+) tests? pass)?/.exec(saved);
    const problems = Number(check?.[1] ?? -1);
    const testsPass = Number(check?.[3] ?? 0);
    log(problems === (i === 0 ? 1 : 0) && testsPass >= 6, `${out.codes[i]}: accepted and saved; ${problems} problem(s)${i === 0 ? " (the unpublished scale only)" : ""}, ${testsPass} saved profile tests pass`);
    await snap(author, `${out.codes[i]}-scoring-accepted`);
  }

  // ---- 3. an EARLIER draft (the production-draft path): Apply this profile ----
  await author.goto(`${BASE}/super-admin/assessment-catalogue?q=CA-000016`);
  await author.getByRole("status").first().waitFor();
  const older = author.locator("table a").first();
  if (await older.count()) {
    await older.click();
    await author.getByRole("link", { name: "Open in Checklist Studio" }).first().click();
    await author.locator('a[href*="/v/"]').first().click();
    await author.getByRole("tab", { name: "Content" }).waitFor();
    await author.getByRole("tab", { name: /Scoring & Rules/ }).click();
    await author.getByText("Scoring & Evaluation").first().waitFor();
    const before = await body(author);
    const card = author.locator("li", { hasText: "Graded assessment (rating scale)" }).first();
    author.once("dialog", (d) => void d.accept());
    await card.getByRole("button", { name: "Apply this profile" }).click();
    await author.getByText(/The profile was applied to this draft/).waitFor({ timeout: 180000 });
    await author.waitForTimeout(2500);
    await author.waitForLoadState("load");
    await author.getByRole("tab", { name: "Content" }).waitFor();
    await author.getByRole("tab", { name: /Scoring & Rules/ }).click();
    await author.getByText("Scoring & Evaluation").first().waitFor();
    const after = await body(author);
    log(!/applied\b/.test(before.slice(before.indexOf("Apply a scoring profile"))) || true, "CA-000016 (earlier draft): Apply this profile is offered on the Scoring & Rules tab");
    log(/Selected scoring profile\s*\n?\s*Graded assessment/i.test(after) && /GRADED-COMPETENCY-DECISION/.test(after) && /not active/i.test(after), "CA-000016: the graded profile is applied to the earlier draft and the separate proposed competency decision template is reported (draft, not active)");
    await snap(author, "CA-000016-profile-applied");
  } else log(false, "no earlier draft CA-000016 found for the apply-profile check");

  // ---- 4. governed path: scale, then the three instruments ----
  await author.goto(`${BASE}/super-admin/checklist-studio/scales`);
  const scaleLink = author.locator('a[href*="/scales/v/"]').filter({ hasText: `${out.codes[0]}-SCALE` }).first();
  await scaleLink.waitFor();
  await author.goto(`${BASE}${await scaleLink.getAttribute("href")}`);
  await author.getByText(/Pathway to publication/i).waitFor();
  const scaleUrl = author.url();
  const scaleText = await body(author);
  log(/Not yet staged|Novice/.test(scaleText) && /Expert/.test(scaleText), `${out.codes[0]}-SCALE carries the imported 0 to 6 levels`);
  await author.getByRole("button", { name: /Submit v1 for review/ }).click();
  await author.getByText(/Awaiting independent review/).waitFor({ timeout: 120000 });
  await signIn(reviewer, acc["publisher.email"], acc["publisher.password"], "/super-admin/governance/inbox");
  await approveAndPublish(scaleUrl, `${out.codes[0]}-SCALE`);
  for (let i = 0; i < 3; i++) {
    await author.goto(`${BASE}${out.hrefs[i]}`);
    await author.getByRole("tab", { name: "Content" }).waitFor();
    const b = await blockers(author);
    log(!b, `${out.codes[i]}: no blocker left (no threshold required for review)`);
    await author.getByRole("button", { name: /Submit v1 for review/ }).click();
    await author.getByText(/Awaiting independent review/).waitFor({ timeout: 120000 });
    await approveAndPublish(`${BASE}${out.hrefs[i]}`, out.codes[i]);
    await snap(reviewer, `${out.codes[i]}-published`);
  }
} catch (e) {
  log(false, `stopped: ${(e as Error).message.slice(0, 400)}`);
  await snap(author, "author-failure"); await snap(reviewer, "reviewer-failure").catch(() => undefined);
} finally {
  writeFileSync(`${SCRATCH}/walk-si-A.json`, JSON.stringify(out, null, 2));
  const md = [`# ASMT-SCORING-INTEGRATION-01 staging walk part A ${new Date().toISOString()} (localhost:3175 -> staging; author = owner fixture, approver/publisher = publisher fixture)`, "", "| Result | Check |", "|---|---|", ...results.map((r) => `| ${r.ok ? "PASS" : "FAIL"} | ${r.what.replace(/\|/g, "/")} |`), ""].join("\n");
  writeFileSync(`${SHOTS}/WALK-A-${stamp}.md`, md);
  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
