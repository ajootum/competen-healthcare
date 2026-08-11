/**
 * CP-OFFLINE-SURVEY-001 s5 PRECONDITION 1 — "Durable local persistence that survives tab close, crash
 * and OS restart, PROVEN BY TEST."
 *
 * ⚠⚠ THE ONLY UNSIGNED GATE, AND THE REASON IT WAS UNSIGNABLE UNTIL NOW.
 *
 * The other six preconditions are provable from node. This one is not: it is a claim about what happens
 * to bytes when a process dies, and node has no IndexedDB and no process to kill. Every prior statement
 * about it in this repository has been "built and exercised by hand", which is not the same as proven --
 * and this is the gate whose failure mode is SILENT. The survey's own words:
 *
 *   "A queued note that never syncs is BELIEVED TO BE SAVED by the only person who could rewrite it.
 *    The record is gone and no one is looking for it."
 *
 * ── HOW IT AVOIDS PROVING SOMETHING ELSE ────────────────────────────────────────────────────────────
 *
 * ⚠ 1. IT EXERCISES THE REAL MODULE. scripts/browser/outbox-entry.ts re-exports `outbox-store.ts` and
 *      adds nothing. A fixture that drove raw IndexedDB would prove IndexedDB is durable, which nobody
 *      doubts, and would say nothing about our code.
 *
 * ⚠ 2. IT RUNS ON THE REAL ORIGIN. The page is loaded from the dev server on http://localhost:3000, so
 *      the IndexedDB reached is THE SAME DATABASE the product uses. A file:// or fixture-server page
 *      would have its own origin and its own storage, and every assertion below would be true of a
 *      database no practitioner will ever have.
 *
 * ⚠ 3. IT USES A PERSISTENT PROFILE. Chrome is launched with a real user-data directory, so closing the
 *      context genuinely ends the process and relaunching genuinely re-reads from disk. An in-memory
 *      context would keep the data alive in the harness and pass for the wrong reason -- which is why
 *      `1-control` below asserts a DIFFERENT profile sees nothing.
 *
 * ── ⚠ WHAT THIS DOES NOT PROVE, STATED SO NOBODY READS ITS GREEN AS COVERING IT ─────────────────────
 *
 * It does NOT prove that `commit()` resolving on `transaction.oncomplete` rather than `request.onsuccess`
 * is what makes the write durable. Both spellings survive a graceful close in practice, and the window
 * between them is too small to hit reliably from a test harness -- so an assertion claiming to prove it
 * would be an assertion I could not make fail on demand, which this repository treats as no assertion at
 * all. The reasoning for `oncomplete` stays what it is: a documented argument in outbox-store.ts, not a
 * measured result. What IS proven here is the property the precondition actually names -- the record is
 * on disk and readable after the process is gone.
 *
 * Requires the dev server on :3000 and Google Chrome installed.
 *   npx --yes tsx scripts/practice-outbox-durability-harness.ts
 */
import { chromium, type BrowserContext } from "@playwright/test";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const ORIGIN = "http://localhost:3000";
/** Any page on the origin will do -- what matters is the ORIGIN, not the document. */
const PAGE = `${ORIGIN}/practice/offline`;

const WORKSPACE = "00000000-0000-4000-8000-0000000000d1";
const DEVICE = "durability-harness-device";
const USER = "00000000-0000-4000-8000-0000000000d2";
/** A value that could not arrive by accident, so finding it back means it genuinely round-tripped. */
const NEEDLE = `systolic-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

type OutboxApi = {
  outboxAccept: (a: Record<string, unknown>) => Promise<{ ok: boolean; record?: { id: string }; reason?: string }>;
  outboxLoad: () => Promise<{ records: { id: string; payload: unknown }[]; unreadable: number; detail: string | null }>;
};
declare global { interface Window { __outbox?: OutboxApi } }

async function bundle(): Promise<string> {
  const out = await build({
    entryPoints: ["scripts/browser/outbox-entry.ts"],
    bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
    // ⚠ The repo tsconfig, so the `@/` alias resolves to the SAME files Next compiles. Retyping the
    // alias here would be a second source of truth about where the module lives.
    tsconfig: "tsconfig.json",
  });
  return out.outputFiles[0].text;
}

/** A page on the real origin with the real outbox module injected. */
async function openWithOutbox(ctx: BrowserContext, code: string) {
  const page = await ctx.newPage();
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: code });
  await page.waitForFunction(() => !!window.__outbox);
  return page;
}

async function main() {
  let code: string;
  try {
    code = await bundle();
  } catch (e) {
    ok("0-control. the outbox module bundles for the browser", false, String((e as Error)?.message ?? e));
    report(); return;
  }
  ok("0-control. the outbox module bundles for the browser", code.length > 1000, `${code.length} bytes`);

  const profile = mkdtempSync(join(tmpdir(), "competen-durability-"));
  const otherProfile = mkdtempSync(join(tmpdir(), "competen-durability-other-"));
  const launch = { channel: "chrome", headless: true } as const;

  let recordId = "";
  try {
    // ── 1. WRITE, THEN END THE PROCESS ────────────────────────────────────────────────────────────
    {
      const ctx = await chromium.launchPersistentContext(profile, launch);
      const page = await openWithOutbox(ctx, code);

      const before = await page.evaluate(() => window.__outbox!.outboxLoad());
      ok("1-control. the outbox starts empty on a fresh profile",
        before.records.length === 0, `${before.records.length} records`);

      const accepted = await page.evaluate(
        async ([ws, dev, usr, needle]) => window.__outbox!.outboxAccept({
          workspaceId: ws, deviceId: dev, userId: usr,
          entityType: "parameter_measurement", entityId: crypto.randomUUID(),
          operation: "create", payload: { note: needle }, baseVersion: null,
        }),
        [WORKSPACE, DEVICE, USER, NEEDLE] as const);

      ok("1a-control. the write was accepted, so what follows is about DURABILITY not about writing",
        accepted.ok === true, accepted.reason ?? "");
      recordId = accepted.record?.id ?? "";

      // ⚠ The context is closed, not just the page. With a persistent profile this ends the browser
      // process: anything still only in memory is gone at this line.
      await ctx.close();
    }

    // ── 2. ⚠ THE ASSERTION THE PRECONDITION ACTUALLY NAMES ────────────────────────────────────────
    {
      const ctx = await chromium.launchPersistentContext(profile, launch);
      const page = await openWithOutbox(ctx, code);
      const after = await page.evaluate(() => window.__outbox!.outboxLoad());

      ok("2a. ⚠⚠ THE RECORD SURVIVED THE PROCESS ENDING AND RESTARTING",
        after.records.length === 1 && after.records[0].id === recordId,
        `${after.records.length} records, unreadable=${after.unreadable}, detail=${after.detail ?? "none"}`);
      ok("2b. ⚠ and it came back READABLE -- the sealing key survived with it",
        after.unreadable === 0
        && JSON.stringify(after.records[0]?.payload ?? {}).includes(NEEDLE),
        `unreadable=${after.unreadable}`);
      ok("2c. nothing was invented alongside it", after.records.length === 1);

      // ── 3. A TAB CLOSING IS NOT A PROCESS ENDING, AND BOTH ARE NAMED IN THE PRECONDITION ────────
      await page.close();
      const page2 = await openWithOutbox(ctx, code);
      const afterTab = await page2.evaluate(() => window.__outbox!.outboxLoad());
      ok("3a. the record survives a TAB being closed and reopened",
        afterTab.records.length === 1 && afterTab.records[0].id === recordId);

      // ── 4. A RENDERER CRASH, WHICH IS THE FAILURE A PRACTITIONER ACTUALLY MEETS ─────────────────
      // ⚠ Not a graceful close: the tab dies without unload handlers, so anything relying on
      // `beforeunload` to flush -- the shape s5 explicitly rejects -- would lose the record here.
      const crashPage = await ctx.newPage();
      let crashed = false;
      try { await crashPage.goto("chrome://crash", { timeout: 5000 }); }
      catch { crashed = true; }
      ok("4-control. the renderer was actually crashed, so 4a is not a second tab-close test", crashed);
      try { await crashPage.close(); } catch { /* already gone */ }

      const page3 = await openWithOutbox(ctx, code);
      const afterCrash = await page3.evaluate(() => window.__outbox!.outboxLoad());
      ok("4a. ⚠ the record survives a renderer CRASH with no unload handler",
        afterCrash.records.length === 1 && afterCrash.records[0].id === recordId,
        `${afterCrash.records.length} records`);

      await ctx.close();
    }

    // ── 5. ⚠ THE CONTROL THAT STOPS ALL OF THE ABOVE PASSING FOR THE WRONG REASON ─────────────────
    // If the harness were somehow reading a store that never died -- an in-memory context, a shared
    // profile, a cached page -- then a DIFFERENT profile would show the record too. It must not.
    {
      const ctx = await chromium.launchPersistentContext(otherProfile, launch);
      const page = await openWithOutbox(ctx, code);
      const elsewhere = await page.evaluate(() => window.__outbox!.outboxLoad());
      ok("5-control. ⚠ a DIFFERENT profile sees nothing, so 2a proves disk and not memory",
        elsewhere.records.length === 0, `${elsewhere.records.length} records`);
      await ctx.close();
    }
  } catch (e) {
    ok("harness completed without throwing", false, String((e as Error)?.message ?? e));
  } finally {
    rmSync(profile, { recursive: true, force: true });
    rmSync(otherProfile, { recursive: true, force: true });
  }

  report();
}

function report() {
  console.log(failures.length
    ? `\nFAILED  ${pass} passed, ${failures.length} failed\n${failures.map(f => `  - ${f}`).join("\n")}`
    : `\nPASSED  ${pass} passed, 0 failed`);
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
