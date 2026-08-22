/**
 * REGISTRATION FORM -- there is no built-in form, and creating one either works or leaves nothing behind.
 *
 * TWO DEFECTS, FOUND TOGETHER BECAUSE THEY EXPLAIN EACH OTHER.
 *
 * The editor screen carried the sentence "A practice with no published form uses the built-in one. That
 * is a working answer, not a gap." It was false in three independent places: resolveTemplate returns null
 * when nothing is published, registrationForm then hands the patient an empty field list, and register
 * skips validateSubmission entirely for want of a template. CORE_FIELDS is real, but the editor is the
 * only thing that reads it. Meanwhile REGISTRATION_FIELDS_VALID -- a publish blocker two screens away --
 * refuses to let the practice go live for exactly the reason the sentence said not to worry about.
 *
 * Zero registration templates exist across the entire estate. That is what a reassuring sentence placed
 * in front of a required step buys you, and it is why this harness pins the sentence as behaviour rather
 * than treating it as copy.
 *
 * The second defect is why the first was hard to notice from the code: createTemplate seeded the core
 * fields and never looked at whether the insert worked, so the one path that makes a form publishable
 * could fail into a template that reported success and could not publish.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTemplate, resolveTemplate, validateTemplate, CORE_FIELDS,
} from "../src/lib/practice/registration-config";
import { registrationForm } from "../src/lib/practice/registration";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " -- " + detail : ""}`); }
};

const WS = "b7c5dbc1-22e1-4c53-900c-c2c0f0e7135b";

// ⚠ SPELLED OUT ON PURPOSE, AND NOT IMPORTED. Importing the production set would make 7b and 7c pass
// for any seed at all, including the broken one -- the test would be checking that a set equals itself.
// These three keys are the answer a person checked against the floor, so a change to the production
// rule has to come back here and be re-argued.
const SEED_REQUIRED_FOR_TEST = new Set(["display_name", "birth_date", "phone"]);
const ctx: any = {
  workspaceId: WS, userId: "u1", workspaceTimezone: "Africa/Kampala",
  capabilities: ["practice.settings.manage"],
};

/** A PostgREST builder that answers per table and records what it was asked to do. */
function stub(script: {
  templates?: any[];
  fields?: any[];
  insertError?: { message: string } | null;
  deleteError?: { message: string } | null;
}) {
  const calls: string[] = [];
  let table = "", op = "";
  const api: any = {
    calls,
    from(t: string) { table = t; op = "select"; return api; },
    select() { return api; },
    insert(rows: any) {
      op = "insert";
      calls.push(`insert:${table}:${Array.isArray(rows) ? rows.length : 1}`);
      // KEPT, NOT COUNTED. The seed assertions below run the real validator over these exact rows,
      // so a reconstruction of what the seed "should" be would defeat the whole point.
      if (table === "practice_registration_field") api.inserted = Array.isArray(rows) ? rows : [rows];
      return api;
    },
    delete() { op = "delete"; calls.push(`delete:${table}`); return api; },
    update() { op = "update"; return api; },
    eq() { return api; }, in() { return api; }, not() { return api; },
    is() { return api; }, limit() { return api; }, order() { return api; },
    single() { return api; }, maybeSingle() { return api; },
    then(resolve: (v: any) => void) {
      if (op === "insert" && table === "practice_registration_template")
        return resolve({ data: { id: "t1" }, error: null });
      if (op === "insert" && table === "practice_registration_field")
        return resolve({ data: null, error: script.insertError ?? null });
      if (op === "delete") return resolve({ data: null, error: script.deleteError ?? null });
      if (table === "practice_registration_template") return resolve({ data: script.templates ?? [], error: null });
      if (table === "practice_registration_field") return resolve({ data: script.fields ?? [], error: null });
      return resolve({ data: null, error: null });
    },
  };
  return api;
}

async function main() {
  console.log("\nREGISTRATION FORM HARNESS\n");

  // -- 1-3. THERE IS NO BUILT-IN FORM ---------------------------------------
  ok("1. nothing published resolves to no template",
    (await resolveTemplate(stub({ templates: [] }), ctx, {})) === null);

  // The claim the screen used to make, tested as behaviour: if a built-in form existed, THIS is where it
  // would appear, because this is the only thing the patient-facing route calls.
  const form = await registrationForm(stub({ templates: [] }), ctx, {});
  ok("2. a patient booking with nothing published gets no fields at all",
    Array.isArray(form.fields) && form.fields.length === 0 && form.template === null,
    JSON.stringify({ n: form.fields?.length, t: form.template }));

  ok("3. CORE_FIELDS is a real set, so the gap is the wiring and not the data",
    CORE_FIELDS.length >= 8 && CORE_FIELDS.some(f => f.key === "display_name"));

  // -- 4-6. CREATING ONE EITHER WORKS OR LEAVES NOTHING ----------------------
  const good = stub({});
  const made = await createTemplate(good, ctx, { name: "Standard intake", correlationId: "c1" });
  ok("4. a new form is created with the standard fields already on it",
    made.ok === true && good.calls.includes(`insert:practice_registration_field:${CORE_FIELDS.length}`),
    good.calls.join(" | "));

  // The defect: this insert's error was never read, so the failure below used to return ok.
  const bad = stub({ insertError: { message: "seed exploded" } });
  const failed: any = await createTemplate(bad, ctx, { name: "Standard intake", correlationId: "c1" });
  ok("5. a failed seed refuses instead of reporting a form that is not there",
    failed.ok === false && String(failed.message).includes("seed exploded"),
    JSON.stringify(failed));

  ok("6. and the empty template it would have left behind is removed",
    bad.calls.includes("delete:practice_registration_template"), bad.calls.join(" | "));

  // If the cleanup fails too, the caller is told the row is still there rather than left to find it.
  const worse: any = await createTemplate(
    stub({ insertError: { message: "seed exploded" }, deleteError: { message: "delete exploded" } }),
    ctx, { name: "Standard intake", correlationId: "c1" });
  ok("7. a failed cleanup is reported, not swallowed",
    worse.ok === false && String(worse.message).includes("delete exploded"), JSON.stringify(worse));

  // -- 7b-7e. A NEW FORM IS PUBLISHABLE, WHICH IS WHAT BOTH THE COMMENT AND THE SCREEN PROMISE ------
  //
  // The seed used to mark display_name and nothing else, satisfying one protected group of three, so
  // every new form opened on "2 things to fix before this can go live" -- while createTemplate's own
  // comment and the editor screen both promised a form publishable the moment it exists.
  //
  // ⚠ THESE RUN THE REAL VALIDATOR OVER THE ROWS createTemplate REALLY INSERTED. An earlier draft of
  // this file rebuilt the expected seed from a constant and checked THAT against the floor, which is a
  // test of a constant against a rule -- it passes whatever production does, including the broken seed
  // it was written to catch.
  const seededRows = (good.inserted ?? []) as any[];
  ok("7b. the seeded rows are the ones the engine actually wrote",
    seededRows.length === CORE_FIELDS.length, `${seededRows.length} rows`);

  const verdict = await validateTemplate(stub({ fields: seededRows }), ctx, "t1");
  ok("7c. a form is publishable from the moment it is created",
    (verdict as any).problems?.length === 0,
    JSON.stringify((verdict as any).problems?.map((x: any) => x.problem)));

  // The either/or half, which the floor alone cannot catch: satisfying every group by requiring BOTH
  // members of a pair would also pass, and would force a patient to give a phone AND an email.
  const requiredKeys = new Set(seededRows.filter(r => r.required).map(r => r.field_key));
  const pairs = [...new Set(CORE_FIELDS.filter(f => f.protected).map(f => f.group))]
    .map(g => CORE_FIELDS.filter(c => c.protected && c.group === g).map(c => c.key))
    .filter(keys => keys.length > 1);
  ok("7d. and no either/or pair has both members forced on the patient",
    pairs.length > 0 && pairs.every(keys => keys.filter(k => requiredKeys.has(k)).length === 1),
    JSON.stringify({ required: [...requiredKeys], pairs }));

  // Independent of the rule: the answer a person checked, so a seed that changes has to be re-argued
  // here rather than silently agreeing with itself.
  ok("7e. the seed requires exactly the three keys that were checked by hand",
    requiredKeys.size === SEED_REQUIRED_FOR_TEST.size
    && [...SEED_REQUIRED_FOR_TEST].every(k => requiredKeys.has(k)),
    JSON.stringify([...requiredKeys]));

  // -- 8-11. THE SOURCE FACTS -----------------------------------------------
  const root = join(__dirname, "..");
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  const editorRaw = readFileSync(join(root, "src/app/practice/(shell)/settings/registration-form/FormEditor.tsx"), "utf8");
  const editor = strip(editorRaw);
  const regRaw = readFileSync(join(root, "src/lib/practice/registration.ts"), "utf8");
  const reg = strip(regRaw);

  ok("8. the comment stripper actually removes comments",
    editorRaw.includes("THERE IS NO BUILT-IN FORM") && !editor.includes("THERE IS NO BUILT-IN FORM"));

  // The sentence itself. Pinned because it is the thing that was wrong, and because a future edit that
  // reintroduces the reassurance would otherwise pass every other test here.
  ok("9. the editor no longer claims a built-in form exists",
    !editor.includes("uses the built-in one"));

  ok("10. and it says what is actually true when nothing is published",
    editor.includes("Nothing is published yet, so a patient booking has no form to complete"));

  // The reason the sentence was false. If a fallback is ever added, this flips and the sentence should
  // change back -- which is the point of pinning the mechanism and not only the words.
  ok("11. the patient-facing path still has no fallback to CORE_FIELDS",
    !reg.includes("CORE_FIELDS"));

  // -- CONTROL --------------------------------------------------------------
  ok("control. a claim the editor does not make is not found",
    !editor.includes("every practice starts with a published form"));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
