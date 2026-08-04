/**
 * Practice saved-search harness -- CPR-350's saved searches, history, filters and count strip.
 * Migration 212.
 *
 * WHAT IT PROVES:
 *   1. A SAVED SEARCH IS A QUERY, NOT A SNAPSHOT. Nothing stored holds a result, a count or an
 *      identifier of anything found -- asserted structurally over the row itself.
 *   2. RUNNING A SHARED SAVED SEARCH APPLIES THE CALLER'S GATE, NOT THE OWNER'S. The load-bearing
 *      assertion: a colleague without patient.list runs the same saved search and gets no patients,
 *      while the owner does. This is what makes sharing safe.
 *   3. THE COUNT STRIP IS COMPUTED FOR THE READER. Two people run the same saved search and get
 *      different counts, because they may see different things.
 *   4. SEARCH HISTORY IS PRIVATE. One person's history holds nothing of another's, and there is no
 *      parameter that would return somebody else's.
 *   5. HISTORY IS DE-DUPLICATED and its stored count is labelled as what was seen THEN, not now.
 *   6. A FILTER THIS BUILD DOES NOT UNDERSTAND IS DROPPED, NOT OBEYED -- a search that silently hides
 *      results is worse than one returning too many.
 *   7. THE DATE FILTER DISCRIMINATES, paired with a control that the same query unfiltered finds more.
 *   8. A SHARED SEARCH IS STILL SOMEBODY'S: readable, not editable, not deletable.
 *   9. The audit trail records the NAME, never the query -- a query is often a patient's name.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-saved-search-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  runSearch, saveSearch, listSavedSearches, runSavedSearch, updateSavedSearch, deleteSavedSearch,
  recentSearches, clearHistory, quickSearches, normaliseFilters,
} from "../src/lib/practice/saved-search";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000e27d1";
const OTHER = "00000000-0000-4000-8000-0000000e27d2";
const COLLEAGUE = "00000000-0000-4000-8000-0000000e27d3";

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
    idempotency_key: `harness-ss-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-ss",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-ss", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: OWNER, correlationId: "harness-ss" };

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A member with exactly the capabilities named -- so "without patient.list" is a real caller. */
async function addMember(workspaceId: string, userId: string, capabilities: string[]): Promise<WorkspaceContext> {
  const { data: m } = await admin.from("practice_membership").insert({
    workspace_id: workspaceId, user_id: userId, role_code: "practitioner", status: "active",
  }).select("id").single();
  await admin.from("practice_role_assignment").insert(
    capabilities.map(c => ({ membership_id: m!.id, capability_code: c, source: "role_default" })),
  );
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

async function main() {
  console.log("\nPractice saved-search harness (CPR-350, migration 212)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Search A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Search B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Mwangi John", sex: "male", birthDate: "1985-07-07",
    phone: "0772 555 900", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }

  // ── 6. Filters this build does not understand are dropped ────────────────
  const cleaned = normaliseFilters({ domains: ["patients", "nonsense"], fromDay: "not-a-date", mystery: true });
  ok("A FILTER THIS BUILD DOES NOT UNDERSTAND IS DROPPED, NOT OBEYED",
    JSON.stringify(cleaned.domains) === JSON.stringify(["patients"]) &&
    cleaned.fromDay === null && !("mystery" in cleaned),
    JSON.stringify(cleaned));

  // ── Running a search, and the count strip ────────────────────────────────
  const found = await runSearch(admin, a.ctx, "Mwangi");
  ok("a search finds the patient", found.total > 0 && found.groups.some(g => g.domain === "patients"),
    JSON.stringify(found.counts));
  ok("THE COUNT STRIP IS PER DOMAIN and matches the hits it describes",
    found.counts.every(c => c.total === (found.groups.find(g => g.domain === c.domain)?.hits.length ?? -1)),
    JSON.stringify(found.counts));

  // ── 7. The date filter ───────────────────────────────────────────────────
  const filtered = await runSearch(admin, a.ctx, "Mwangi", { fromDay: "1990-01-01", toDay: "1990-12-31" });
  ok("THE DATE FILTER DISCRIMINATES -- a window with nothing in it returns nothing",
    filtered.total === 0 && filtered.dateFiltered === true, JSON.stringify({ t: filtered.total }));
  ok("CONTROL: the same query unfiltered still finds it (the filter is not a blanket)", found.total > 0);

  // ── 1. A saved search stores no results ──────────────────────────────────
  const saved = await saveSearch(admin, a.ctx, {
    name: "Mwangi patients", query: "Mwangi", filters: { domains: ["patients"] },
    favourite: true, shared: true, correlationId: "harness-ss",
  });
  ok("a search is saved", saved.ok, saved.ok ? "" : saved.message);
  if (!saved.ok) return report();

  const dup = await saveSearch(admin, a.ctx, { name: "mwangi patients", query: "x", correlationId: "h" });
  ok("the same name twice is refused", !dup.ok && dup.code === "NAME_IN_USE", dup.ok ? "saved" : dup.code);

  const { data: row } = await admin.from("practice_saved_search").select("*").eq("id", saved.data.id).maybeSingle();
  const serialised = JSON.stringify(row);
  ok("A SAVED SEARCH STORES NO RESULT, NO COUNT AND NO IDENTIFIER OF ANYTHING FOUND",
    !serialised.includes(p1.data.id) && !/"(hit_count|result|count|total)"/.test(serialised),
    Object.keys(row ?? {}).join(","));

  const listed = await listSavedSearches(admin, a.ctx);
  ok("and none is carried on the way out either",
    listed.length === 1 && !("count" in listed[0]) && !("total" in listed[0]),
    Object.keys(listed[0] ?? {}).join(","));

  // ── 9. The audit trail records the name, not the query ───────────────────
  const { data: events } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", wsA).eq("event_type", "practice.search_saved");
  ok("THE AUDIT TRAIL RECORDS THE NAME, NEVER THE QUERY -- a query is often a patient's name",
    ((events ?? []) as any[]).every(e => e.payload?.name && !e.payload?.query),
    JSON.stringify(((events ?? []) as any[])[0]?.payload));

  // ── 2 and 3. The caller's gate, not the owner's ──────────────────────────
  // A colleague who may search but may NOT list patients.
  const blind = await addMember(wsA, COLLEAGUE, ["search.use", "task.view"]);
  ok("the colleague can search but cannot list patients",
    blind.capabilities.includes("search.use") && !blind.capabilities.includes("patient.list"),
    blind.capabilities.join(","));

  const asOwner = await runSavedSearch(admin, a.ctx, saved.data.id);
  const asColleague = await runSavedSearch(admin, blind, saved.data.id);
  ok("the shared saved search is readable by the colleague", asColleague !== null);
  ok("RUNNING IT APPLIES THE CALLER'S GATE, NOT THE OWNER'S -- the colleague sees no patients",
    (asOwner?.groups ?? []).some(g => g.domain === "patients") &&
    !(asColleague?.groups ?? []).some(g => g.domain === "patients"),
    JSON.stringify({ owner: asOwner?.counts.map(c => c.domain), colleague: asColleague?.counts.map(c => c.domain) }));
  ok("THE COUNT IS COMPUTED FOR THE READER: the same saved search gives them different totals",
    (asOwner?.total ?? 0) > (asColleague?.total ?? 0),
    JSON.stringify({ owner: asOwner?.total, colleague: asColleague?.total }));
  ok("and the colleague's results carry no patient identifier at all",
    !JSON.stringify(asColleague?.groups ?? []).includes(p1.data.id));

  // ── 8. A shared search is still somebody's ───────────────────────────────
  const notTheirs = await updateSavedSearch(admin, blind, { id: saved.data.id, favourite: false, correlationId: "h" });
  ok("A SHARED SEARCH IS READABLE, NOT EDITABLE",
    !notTheirs.ok && notTheirs.code === "NOT_YOURS", notTheirs.ok ? "changed" : notTheirs.code);
  const notTheirsDelete = await deleteSavedSearch(admin, blind, { id: saved.data.id, correlationId: "h" });
  ok("nor deletable", !notTheirsDelete.ok && notTheirsDelete.code === "NOT_YOURS");
  const mine = await updateSavedSearch(admin, a.ctx, { id: saved.data.id, favourite: false, correlationId: "h" });
  ok("CONTROL: the owner can change their own", mine.ok, mine.ok ? "" : mine.message);

  // ── 4 and 5. History is private and de-duplicated ────────────────────────
  await runSearch(admin, a.ctx, "Mwangi");
  await runSearch(admin, a.ctx, "Mwangi");
  await runSearch(admin, a.ctx, "cough");
  await runSearch(admin, blind, "their own private thing");

  const ownerHistory = await recentSearches(admin, a.ctx);
  const colleagueHistory = await recentSearches(admin, blind);
  ok("HISTORY IS DE-DUPLICATED -- three runs of the same query are one entry",
    ownerHistory.filter(h => h.query === "Mwangi").length === 1,
    ownerHistory.map(h => h.query).join(" | "));
  ok("SEARCH HISTORY IS PRIVATE -- the owner's holds nothing of the colleague's",
    !ownerHistory.some(h => h.query === "their own private thing"),
    ownerHistory.map(h => h.query).join(" | "));
  // "cough" is the precise test: only the owner ever ran it. "Mwangi" is NOT -- the colleague ran that
  // themselves by opening the shared saved search, and recording their own action in their own history
  // is correct. An earlier version of this assertion tested the wrong thing and failed against right code.
  ok("and the colleague's holds nothing the colleague did not run",
    !colleagueHistory.some(h => h.query === "cough"),
    colleagueHistory.map(h => h.query).join(" | "));
  ok("the stored count is labelled as what was seen THEN, not as a current one",
    ownerHistory.every(h => "foundThen" in h), Object.keys(ownerHistory[0] ?? {}).join(","));

  const cleared = await clearHistory(admin, a.ctx);
  ok("history can be cleared", cleared.ok && cleared.data.cleared > 0,
    cleared.ok ? String(cleared.data.cleared) : "");
  const colleagueAfterClear = await recentSearches(admin, blind);
  ok("and clearing the owner's leaves the colleague's alone",
    colleagueAfterClear.length > 0 && (await recentSearches(admin, a.ctx)).length === 0,
    `colleague `);

  // ── Quick searches ───────────────────────────────────────────────────────
  const quick = quickSearches(a.ctx);
  const quickBlind = quickSearches(blind);
  ok("quick searches are LINKS to the surfaces that already answer them, not text queries",
    quick.every(q => q.href.startsWith("/practice/")), quick.map(q => q.href).join(" "));
  ok("and they are capability-filtered, so a chip never leads somewhere the reader is redirected from",
    quick.length > quickBlind.length && !quickBlind.some(q => q.key === "followups_overdue"),
    `${quick.length} vs ${quickBlind.length}`);

  // ── 10. Isolation ────────────────────────────────────────────────────────
  const crossRun = await runSavedSearch(admin, b.ctx, saved.data.id);
  ok("another workspace's saved search is not found", crossRun === null);
  ok("B has no saved searches", (await listSavedSearches(admin, b.ctx)).length === 0);
  ok("A does (the isolation test is not vacuous)", (await listSavedSearches(admin, a.ctx)).length > 0);
  ok("and B's history holds none of A's", (await recentSearches(admin, b.ctx)).length === 0);

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
