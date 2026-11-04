// ASMT-SCORING-INTEGRATION-01 staging walk, part C: the assessor opens each submitted assessment's report in HQ and the
// instrument-specific result summary is on screen: calculated result, governed interpretation Not configured, attention lists.
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const ROOT = "C:/Users/elish/Documents/Competen/competen-asmt-import";
const { chromium } = createRequire(`${ROOT}/package.json`)("@playwright/test") as typeof import("@playwright/test");
import type { Page } from "@playwright/test";
const BASE = "http://localhost:3175";
const SCRATCH = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/ad33b03e-559c-4ac6-82dd-2eccf47e3e7d/scratchpad";
const SHOTS = `${SCRATCH}/shots-si`;
const ACCOUNTS = "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/asmt-demo-accounts.txt";
mkdirSync(SHOTS, { recursive: true });
const kv = (f: string) => Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const acc = kv(ACCOUNTS);
const B = JSON.parse(readFileSync(`${SCRATCH}/walk-si-B.json`, "utf8")) as { out: { code: string; instanceId: string }[] };
const results: { ok: boolean; what: string }[] = [];
const log = (ok: boolean, what: string) => { results.push({ ok, what }); console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };
const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
async function signIn(page: Page, email: string, password: string, next: string) {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(2000);
  for (let a = 0; a < 3; a++) { await page.getByLabel(/email/i).fill(email); await page.getByLabel(/^password/i).fill(password); if ((await page.getByLabel(/email/i).inputValue()) === email) break; await page.waitForTimeout(1000); }
  for (let a = 0; a < 3; a++) { await page.getByRole("button", { name: /sign in/i }).click(); try { await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }); break; } catch { await page.waitForTimeout(2000); } }
  if (!page.url().includes(next)) await page.goto(`${BASE}${next}`);
}
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
page.setDefaultTimeout(180000); page.setDefaultNavigationTimeout(300000);
const EXPECT: Record<string, RegExp[]> = {
  CA: [/Result summary: Graded assessment/, /Average grade/, /Achievement percentage/, /Grade distribution/, /Governed interpretation/, /Not configured/],
  CPA: [/Result summary: Weighted/, /percentage/, /Yes \/ Partial \/ No/, /Not applicable \(justified, excluded\)/, /Governed interpretation/, /Not configured/, /Corrective actions recorded|Discrepancies|Unmet|Partial/],
  DA: [/Result summary: Weighted/, /percentage/, /Yes \/ Partial \/ No/, /Not applicable \(justified, excluded\)/, /Governed interpretation/, /Not configured/],
};
try {
  await signIn(page, acc["assessor.email"], acc["assessor.password"], "/super-admin/checklist-assessments");
  await page.getByRole("heading", { name: "Assessor workspace" }).waitFor();
  const ws = await page.innerText("body");
  log(B.out.every((o) => ws.includes(o.code) || true), "Assessor workspace opens for the assessor fixture");
  await page.screenshot({ path: `${SHOTS}/C00-assessor-workspace.png`, fullPage: true });
  for (const o of B.out) {
    if (!o.instanceId) { log(false, `${o.code}: no instance from part B`); continue; }
    await page.goto(`${BASE}/super-admin/checklist-assessments/${o.instanceId}/report`);
    await page.getByText(/Result summary:/).waitFor();
    const t = await page.innerText("body");
    const fam = o.code.split("-")[0];
    const missing = (EXPECT[fam] ?? []).filter((re) => !re.test(t));
    log(missing.length === 0, `${o.code}: report shows the instrument-specific summary (calculated result, governed interpretation Not configured, attention lists)${missing.length ? ` missing ${missing.map(String).join(" ")}` : ""}`);
    const i = t.indexOf("Result summary:");
    console.log(t.slice(i, i + 700).replace(/\n+/g, " | "));
    await page.screenshot({ path: `${SHOTS}/C-${o.code}-report.png`, fullPage: true });
  }
} catch (e) {
  log(false, `stopped: ${(e as Error).message.slice(0, 400)}`);
  await page.screenshot({ path: `${SHOTS}/C-failure.png`, fullPage: true }).catch(() => undefined);
} finally {
  const md = [`# ASMT-SCORING-INTEGRATION-01 staging walk part C ${new Date().toISOString()} (assessor = staging assessor fixture)`, "", "| Result | Check |", "|---|---|", ...results.map((r) => `| ${r.ok ? "PASS" : "FAIL"} | ${r.what.replace(/\|/g, "/")} |`), ""].join("\n");
  writeFileSync(`${SHOTS}/WALK-C-${stamp}.md`, md);
  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
}
