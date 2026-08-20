/**
 * Practice personalisation harness -- CPR-360, exercised against the live database through the same
 * engine the pages use, plus three static scans. Migration 205.
 *
 * WHAT IT PROVES:
 *   1. EVERY PREFERENCE HAS A CONSUMER. Asserted by wiring, not by assertion: the notification
 *      categories are switched off and the notifications disappear from the list; the specialty is set
 *      and the template library reorders; the widget layout is saved and read back. A switch that
 *      controlled nothing would pass none of these.
 *   2. A CATEGORY SWITCHED OFF HIDES ROWS, IT DOES NOT DESTROY THEM. Turned back on, the history is
 *      still there -- proven by counting the same notifications before, during and after.
 *   3. A CLINICAL ALERT CANNOT BE SILENCED. Refused loudly rather than coerced quietly, and paired with
 *      the control that an optional category switches off fine.
 *   4. A SAVED LAYOUT IS RECONCILED AGAINST THE WIDGETS THAT EXIST. A widget added since somebody saved
 *      their layout appears; one removed since drops out. Otherwise a new feature ships to nobody.
 *   5. AN EMPTY DASHBOARD IS REFUSED -- it cannot be undone from the dashboard.
 *   6. ORGANISATION POLICY TAKES PRECEDENCE (CPR-360 s5), and APPEARANCE IS NOT LOCKABLE: a practice
 *      cannot decide that somebody who needs larger text does not get it.
 *   7. AN EXPORTED FILE CARRIES NO IDENTIFIERS, round-trips through import, and a foreign or
 *      future-version file is refused.
 *   8. THE DARK THEME HAS A MAPPING FOR EVERY COLOUR UTILITY THE PRACTICE TREE USES. A static scan, so
 *      the brittleness of remapping utilities is a red harness rather than a white card in a dark
 *      workspace.
 *   9. THE WIDGET REGISTER AND THE HOME PAGE AGREE, both ways.
 *  10. Preferences are per person per workspace, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-personalisation-harness.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { createTemplate, setTemplateStatus, listTemplates } from "../src/lib/practice/documentation";
import { listNotifications } from "../src/lib/practice/tasks";
import {
  getPreferences, updatePreferences, resolvePreferences, resetPreferences,
  exportPreferences, importPreferences, lockedPreferences, configurationChecklist,
} from "../src/lib/practice/preferences";
import { DASHBOARD_WIDGETS, enabledEventTypes, NOTIFICATION_CATEGORIES } from "../src/lib/practice/preference-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e20d1";
const OTHER = "00000000-0000-4000-8000-0000000e20d2";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pers-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-pers",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-pers", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}


// ── The static scans ─────────────────────────────────────────────────────────────────────────────────

const PRACTICE_TREE = "src/app/practice/(shell)";
const GLOBALS = "src/app/globals.css";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Colour utilities that the dark theme must remap.
 *
 * DELIBERATELY NOT EVERY COLOUR CLASS, and every exclusion below is a stated reason rather than a
 * loosened pattern -- a scan that quietly widened until it passed would prove nothing.
 *
 * WHAT IS EXCLUDED, AND EACH BY A RULE RATHER THAN BY A NAME:
 *   layout.tsx        -- the sidebar is ALREADY dark and its palette is its own. Inverting something
 *                        that was never light is how a dark theme produces a white sidebar.
 *   any print/page    -- a printed document goes onto white paper. Theming it would produce a black
 *                        rectangle with a practitioner's name on it, and cost a great deal of
 *                        somebody's toner.
 *   text-white        -- sits on a filled primary button and is correct in both themes.
 *   translucent black -- a scrim or hairline darkens whatever is beneath it, on either ground.
 *     or white
 *   already-dark      -- bg/border at shade 400+, text at 300 and below. These are dark or mid BY
 *                        CHOICE, and remapping them would be the bug.
 */
// ⚠ THE TWO LITERALS ABOVE WERE INSTANCES OF RULES, AND KEEPING THEM AS LITERALS IS WHY THIS WENT RED
// WITH TWENTY-TWO ENTRIES, MOST OF THEM NOT DEFECTS.
//
//   "documents/[documentId]/print/page.tsx" exempted ONE print page. There are two -- the invoice print
//   page carries a `text-gray-200` watermark and was reported as unmapped. A print page is exempt
//   because paper has no dark theme, which is true of every print page and not of that one file.
//
//   "bg-black/40" exempted ONE scrim. The tree now uses border-black/5 through /60, text-black/50,
//   text-black/70 and bg-black/[0.02] -- every one a TRANSLUCENT OVERLAY, which is what made the scrim
//   exempt in the first place: it darkens whatever is beneath it and is correct on either ground. Nine
//   more literals would have been nine more entries waiting to be added one at a time.
//
// Both are now the rule they were an instance of. That is not a wider exemption; it is the same
// exemption stated once instead of enumerated.
const isPrintPage = (file: string) => /[\\/]print[\\/]page\.tsx$/.test(file);
const THEME_EXEMPT_FILES = [join(PRACTICE_TREE, "layout.tsx")];
const THEME_EXEMPT_UTILITIES = ["text-white"];
/** A translucent black or white overlay darkens or lightens what is under it, on either theme. */
const isTranslucentOverlay = (u: string) => /-(?:black|white)\/(?:\d+|\[[\d.]+\])$/.test(u);

function lightUtilitiesUsed(): string[] {
  const found = new Set<string>();
  const pattern = /\b(?:bg|text|border)-(?:white|black|gray-\d{2,3}|(?:amber|red|emerald|blue)-(?:50|100))(?:\/(?:\d+|\[[\d.]+\]))?(?![\w-])/g;
  for (const file of walk(PRACTICE_TREE)) {
    if (THEME_EXEMPT_FILES.includes(file) || isPrintPage(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(pattern)) {
      // The sidebar's own tints, which reach no light surface.
      if (/^(?:bg|border|text)-(?:white|blue-\d{2,3})\/\d+$/.test(m[0])) continue;
      if (THEME_EXEMPT_UTILITIES.includes(m[0]) || isTranslucentOverlay(m[0])) continue;
      // ⚠ A UTILITY THAT IS ALREADY DARK NEEDS NO DARK MAPPING, and the pattern above cannot tell --
      // it matches gray-\d{2,3}, which is the whole scale. bg-gray-900 on a button, bg-gray-400 on a
      // "cancelled" badge and border-gray-700 on a selected row are dark or mid BY CHOICE and are
      // correct on either ground; remapping them would be the bug.
      //
      // Tailwind's light end is 50-300, so: a BACKGROUND or BORDER is light at 300 and below, and TEXT
      // is dark -- and therefore needs remapping -- at 500 and above. Stated as the reading it is,
      // rather than as five more names in an exemption list.
      const shade = Number(m[0].match(/-(\d{2,3})(?:\/|$)/)?.[1] ?? NaN);
      if (Number.isFinite(shade)) {
        const isText = m[0].startsWith("text-");
        if (isText ? shade < 500 : shade > 300) continue;
      }
      found.add(m[0]);
    }
  }
  return [...found].sort();
}

async function main() {
  console.log("\nPractice personalisation harness (CPR-360, migration 205)\n");
  await cleanup();

  // ── 8. The dark theme covers what the tree actually uses ─────────────────
  const css = readFileSync(GLOBALS, "utf8");
  const used = lightUtilitiesUsed();
  ok("the scan finds real colour utilities (it is not vacuous)", used.length > 10, `${used.length} found`);

  const unmapped = used.filter(u => {
    // A CSS selector escapes the slash -- the stylesheet reads `.bg-gray-50\/60` -- so the pattern has
    // to expect that backslash. An earlier version of this line did not, and reported a mapping that
    // was there as missing.
    const selector = u.replace(/[.*+?^${}()|[\]]/g, "\\$&").replace("/", "\\\\/");
    return !new RegExp(`\\[data-practice-theme="dark"\\][^{]*\\.${selector}(?![\\w-])`).test(css);
  });
  ok("EVERY light colour utility used in the Practice tree has a dark mapping",
    unmapped.length === 0, unmapped.join(" "));

  const controlUnmapped = ["bg-lime-50", "text-fuchsia-900"].filter(u =>
    !new RegExp(`\\[data-practice-theme="dark"\\][^{]*\\.${u}(?![\\w-])`).test(css));
  ok("CONTROL: the mapping check can detect a missing mapping", controlUnmapped.length === 2);

  /* THE THEMED ELEMENT'S OWN CLASSES NEED THE SELF-MATCHING FORM, and this assertion exists because the
     scan above missed it. `[data-practice-theme="dark"] .bg-gray-50` is a DESCENDANT selector; the shell
     root carries the attribute and the background utility on the same element, so the page canvas stayed
     light behind dark cards. The mapping scan passed the whole time -- it asked whether a rule existed,
     not whether it applied. Caught by opening the page. */
  const layoutSrc = readFileSync(join(PRACTICE_TREE, "layout.tsx"), "utf8");
  const rootClasses = (layoutSrc.match(/className="([^"]*)"\s*\n?\s*\/\/ CPR-360|className="(cp-surface[^"]*)"/) ?? [])
    .filter(Boolean).join(" ").match(/\bbg-[\w-]+/g) ?? [];
  const selfUnmapped = rootClasses.filter(c =>
    !new RegExp(`\\[data-practice-theme="dark"\\]\\.${c}(?![\\w-])`).test(css));
  ok("the shell root's own background has a SELF-matching dark rule, not only a descendant one",
    rootClasses.length > 0 && selfUnmapped.length === 0,
    `root: ${rootClasses.join(" ") || "none found"} / unmapped: ${selfUnmapped.join(" ")}`);

  // ── 9. The widget register and the page agree, both ways ─────────────────
  const homeSrc = readFileSync(join(PRACTICE_TREE, "home", "page.tsx"), "utf8");
  const inPage = [...homeSrc.matchAll(/widget\("([a-z_]+)"\)/g)].map(m => m[1]);
  const inRegister = DASHBOARD_WIDGETS.map(([k]) => String(k));
  ok("every widget in the register is tagged on the home page",
    inRegister.every(k => inPage.includes(k)), inRegister.filter(k => !inPage.includes(k)).join(" "));
  ok("every widget tagged on the home page is in the register",
    inPage.every(k => inRegister.includes(k)), inPage.filter(k => !inRegister.includes(k)).join(" "));
  ok("the page scan found widgets at all (not vacuous)", inPage.length >= 8, String(inPage.length));

  // ── The live half ────────────────────────────────────────────────────────
  const wsA = await provision(OWNER, "HARNESS Personalisation A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Personalisation B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  const base = { workspaceId: wsA, userId: OWNER, correlationId: "harness-pers" };

  // ── 1. Defaults, created on first read ───────────────────────────────────
  const first = await getPreferences(admin, wsA, OWNER);
  ok("a person with no row reads defaults, and the row is created",
    first.theme === "light" && first.accent === "indigo" && first.id !== "",
    JSON.stringify({ theme: first.theme, id: !!first.id }));
  ok("the default layout shows every widget",
    first.dashboardWidgets.length === DASHBOARD_WIDGETS.length && first.dashboardWidgets.every(w => w.visible));

  // ── Appearance: validated ────────────────────────────────────────────────
  const badTheme = await updatePreferences(admin, { ...base, patch: { theme: "midnight" } });
  ok("an unknown theme is refused", !badTheme.ok && badTheme.code === "VALIDATION_ERROR");
  const goodTheme = await updatePreferences(admin, { ...base, patch: { theme: "dark", fontScale: "large" } });
  ok("CONTROL: a known theme and text size save", goodTheme.ok, goodTheme.ok ? "" : goodTheme.message);
  const afterTheme = await getPreferences(admin, wsA, OWNER);
  ok("and they are what comes back", afterTheme.theme === "dark" && afterTheme.fontScale === "large");

  // ── 4. A saved layout is reconciled against what exists ──────────────────
  const savedLayout = await updatePreferences(admin, {
    ...base,
    patch: {
      dashboardWidgets: [
        { key: "alerts", visible: true },
        { key: "schedule", visible: false },
        // A widget that no longer exists, as a stale row would carry.
        { key: "a_widget_that_was_removed", visible: true },
      ],
    },
  });
  ok("a layout naming a widget that does not exist is refused outright",
    !savedLayout.ok && savedLayout.code === "VALIDATION_ERROR", savedLayout.ok ? "saved" : savedLayout.code);

  const partial = await updatePreferences(admin, {
    ...base, patch: { dashboardWidgets: [{ key: "alerts", visible: true }, { key: "schedule", visible: false }] },
  });
  ok("CONTROL: a layout naming only some widgets saves", partial.ok, partial.ok ? "" : partial.message);
  const reconciled = await getPreferences(admin, wsA, OWNER);
  ok("A WIDGET THE SAVED LAYOUT NEVER MENTIONED APPEARS, VISIBLE -- a new feature must not ship to nobody",
    reconciled.dashboardWidgets.length === DASHBOARD_WIDGETS.length &&
    reconciled.dashboardWidgets.find(w => w.key === "messages")?.visible === true,
    JSON.stringify(reconciled.dashboardWidgets));
  ok("the saved order is kept in front of it",
    reconciled.dashboardWidgets[0].key === "alerts" && reconciled.dashboardWidgets[1].key === "schedule",
    reconciled.dashboardWidgets.map(w => w.key).join(","));
  ok("and the hidden one is still hidden",
    reconciled.dashboardWidgets.find(w => w.key === "schedule")?.visible === false);

  // ── 5. An empty dashboard is refused ─────────────────────────────────────
  const blank = await updatePreferences(admin, {
    ...base, patch: { dashboardWidgets: DASHBOARD_WIDGETS.map(([k]) => ({ key: String(k), visible: false })) },
  });
  ok("hiding EVERY widget is refused", !blank.ok && blank.code === "EMPTY_DASHBOARD", blank.ok ? "saved" : blank.code);
  const nearlyBlank = await updatePreferences(admin, {
    ...base,
    patch: { dashboardWidgets: DASHBOARD_WIDGETS.map(([k], i) => ({ key: String(k), visible: i === 0 })) },
  });
  ok("CONTROL: hiding all but one is allowed", nearlyBlank.ok, nearlyBlank.ok ? "" : nearlyBlank.message);

  // ── 3 and 2. Notification categories ─────────────────────────────────────
  const silence = await updatePreferences(admin, {
    ...base, patch: { notificationCategories: { clinical: false } },
  });
  ok("A CLINICAL ALERT CANNOT BE SWITCHED OFF",
    !silence.ok && silence.code === "CATEGORY_NOT_OPTIONAL", silence.ok ? "saved" : silence.code);

  // Two real notifications, of the two categories that anything actually raises.
  await admin.from("practice_notification").insert([
    { workspace_id: wsA, user_id: OWNER, event_type: "task_assigned", title: "A task for you", href: "/practice/tasks" },
    { workspace_id: wsA, user_id: OWNER, event_type: "document_amended", title: "A document changed", href: "/practice/documents" },
  ]);
  const bothOn = await listNotifications(admin, wsA, OWNER);
  ok("both notifications are listed while both categories are on", bothOn.length === 2, String(bothOn.length));

  const muted = await updatePreferences(admin, {
    ...base, patch: { notificationCategories: { tasks: false, documents: true } },
  });
  ok("CONTROL: an optional category switches off fine", muted.ok, muted.ok ? "" : muted.message);
  const filtered = await listNotifications(admin, wsA, OWNER);
  ok("THE SWITCH ACTUALLY FILTERS -- the task notification is gone",
    filtered.length === 1 && filtered[0].event_type === "document_amended",
    JSON.stringify(filtered.map(n => n.event_type)));

  const { count: stillStored } = await admin.from("practice_notification")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("user_id", OWNER);
  ok("BUT THE ROW IS NOT DESTROYED -- switching a category off hides, it does not delete",
    stillStored === 2, String(stillStored));

  await updatePreferences(admin, { ...base, patch: { notificationCategories: { tasks: true, documents: true } } });
  const restored = await listNotifications(admin, wsA, OWNER);
  ok("and switching it back on brings the history with it", restored.length === 2, String(restored.length));

  ok("a category nothing raises contributes no event types either way",
    !enabledEventTypes({ appointments: true }).length ||
    !NOTIFICATION_CATEGORIES.find(([k]) => k === "appointments")![3].length);

  // ── 6. Organisation policy, and what may not be locked ───────────────────
  const personalLength = await updatePreferences(admin, { ...base, patch: { defaultAppointmentMinutes: 45 } });
  ok("a personal consultation length saves while nothing is locked", personalLength.ok);
  const beforeLock = await resolvePreferences(admin, wsA, OWNER);
  ok("CONTROL: the personal value wins over the practice default",
    beforeLock.effective.defaultAppointmentMinutes === 45,
    String(beforeLock.effective.defaultAppointmentMinutes));

  const { data: cfg } = await admin.from("practice_configuration")
    .select("id").eq("workspace_id", wsA).eq("is_effective", true).maybeSingle();
  await admin.from("practice_configuration")
    .update({ locked_preferences: ["defaultAppointmentMinutes", "fontScale", "theme"] }).eq("id", cfg!.id);

  const locked = await lockedPreferences(admin, wsA);
  ok("APPEARANCE IS NOT LOCKABLE -- theme and text size are dropped from the lock list",
    locked.includes("defaultAppointmentMinutes") && !locked.includes("fontScale") && !locked.includes("theme"),
    JSON.stringify(locked));

  const afterLock = await resolvePreferences(admin, wsA, OWNER);
  ok("ORGANISATION POLICY TAKES PRECEDENCE: the practice value is what resolves",
    afterLock.effective.defaultAppointmentMinutes === afterLock.practice.defaultAppointmentMinutes &&
    afterLock.effective.defaultAppointmentMinutes !== 45,
    JSON.stringify(afterLock.effective.defaultAppointmentMinutes));
  ok("the personal value is not destroyed by the lock -- it returns if the lock lifts",
    afterLock.preferences.defaultAppointmentMinutes === 45);

  const blocked = await updatePreferences(admin, { ...base, patch: { defaultAppointmentMinutes: 15 } });
  ok("changing a locked preference alone is refused, and says who sets it",
    !blocked.ok && blocked.code === "PREFERENCE_LOCKED" && /your practice sets/.test(blocked.message),
    blocked.ok ? "saved" : blocked.message);

  const mixed = await updatePreferences(admin, {
    ...base, patch: { defaultAppointmentMinutes: 15, density: "compact" },
  });
  ok("A PARTIAL CHANGE IS NOT A FAILED SAVE: the unlocked half lands and the locked half is named",
    mixed.ok && mixed.data.changed.includes("density") && mixed.data.refused.includes("defaultAppointmentMinutes"),
    mixed.ok ? JSON.stringify(mixed.data) : mixed.message);

  const stillLocked = await updatePreferences(admin, { ...base, patch: { fontScale: "small" } });
  ok("CONTROL: an accessibility setting still saves under that same lock", stillLocked.ok);
  await admin.from("practice_configuration").update({ locked_preferences: [] }).eq("id", cfg!.id);

  // ── The specialty consumer ───────────────────────────────────────────────
  const mk = async (code: string, specialty: string | undefined) => {
    const t = await createTemplate(admin, {
      workspaceId: wsA, code, title: `Zzz ${code}`, kind: "referral_letter",
      bodyTemplate: "Dear {{referral.addressee}}", sections: [], specialty,
      actorId: OWNER, correlationId: "harness-pers",
    });
    if (t.ok) await setTemplateStatus(admin, { workspaceId: wsA, templateId: t.data.id, status: "published", actorId: OWNER, correlationId: "harness-pers" });
    return t.ok ? t.data.id : null;
  };
  await mk("aaa_general", undefined);
  const neuroId = await mk("zzz_neuro", "Neurosurgery");

  const unsorted = await listTemplates(admin, wsA);
  const mine = unsorted.filter(t => t.scope === "workspace");
  ok("CONTROL: without a specialty the library is alphabetical",
    mine[0]?.code === "aaa_general", mine.map(t => t.code).join(","));

  const sorted = await listTemplates(admin, wsA, { specialty: "neurosurgery" });
  const sortedMine = sorted.filter(t => t.scope === "workspace");
  ok("THE SPECIALTY REORDERS THE LIBRARY -- it changes something, or it is a form that stores words",
    sortedMine[0]?.id === neuroId, sortedMine.map(t => t.code).join(","));
  ok("and nothing is hidden by it", sortedMine.length === mine.length, `${sortedMine.length} vs ${mine.length}`);

  // ── 7. Export and import ─────────────────────────────────────────────────
  await updatePreferences(admin, { ...base, patch: { specialty: "Neurosurgery", accent: "emerald" } });
  const file = await exportPreferences(admin, wsA, OWNER);
  const serialised = JSON.stringify(file);
  ok("an exported file carries no workspace, user or row identifier",
    !serialised.includes(wsA) && !serialised.includes(OWNER) && !/"id"/.test(serialised), serialised.slice(0, 120));
  ok("it carries the choices", serialised.includes("emerald") && serialised.includes("Neurosurgery"));

  await resetPreferences(admin, { ...base });
  const afterReset = await getPreferences(admin, wsA, OWNER);
  ok("reset puts everything back to default",
    afterReset.accent === "indigo" && afterReset.theme === "light" && afterReset.specialty === null,
    JSON.stringify({ accent: afterReset.accent, theme: afterReset.theme }));

  const reimported = await importPreferences(admin, { ...base, file });
  ok("the exported file imports back", reimported.ok, reimported.ok ? "" : reimported.message);
  const afterImport = await getPreferences(admin, wsA, OWNER);
  ok("and restores what it carried", afterImport.accent === "emerald" && afterImport.specialty === "Neurosurgery",
    JSON.stringify({ accent: afterImport.accent, specialty: afterImport.specialty }));

  const foreign = await importPreferences(admin, { ...base, file: { kind: "something-else", version: 1, preferences: {} } });
  ok("a file from somewhere else is refused", !foreign.ok && foreign.code === "VALIDATION_ERROR");
  const future = await importPreferences(admin, { ...base, file: { kind: "competen-practice-preferences", version: 9, preferences: {} } });
  ok("a file from a future version is refused rather than half-read",
    !future.ok && future.code === "UNSUPPORTED_VERSION", future.ok ? "imported" : future.code);

  // ── The checklist counts rather than scoring ─────────────────────────────
  const checklist = await configurationChecklist(admin, wsA, OWNER);
  ok("the setup checklist is a COUNT AND ITS DENOMINATOR, with no percentage",
    checklist.total === 6 && checklist.done <= 6 && !/%/.test(JSON.stringify(checklist)),
    `${checklist.done} of ${checklist.total}`);
  ok("it discriminates: the specialty line is done and the letterhead line is not",
    checklist.items.find(i => i.key === "specialty")?.done === true &&
    checklist.items.find(i => i.key === "letterhead")?.done === false,
    JSON.stringify(checklist.items.map(i => [i.key, i.done])));

  // ── 10. Per person, per workspace ────────────────────────────────────────
  const bPrefs = await getPreferences(admin, wsB, OTHER);
  ok("another practice's owner has their own defaults, untouched by A's choices",
    bPrefs.accent === "indigo" && bPrefs.specialty === null, JSON.stringify({ accent: bPrefs.accent }));
  const aPrefs = await getPreferences(admin, wsA, OWNER);
  ok("A's are non-default (the isolation test is not vacuous)", aPrefs.accent === "emerald");

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
