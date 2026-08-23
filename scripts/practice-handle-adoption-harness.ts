/**
 * HANDLE ADOPTION -- practice_booking_access.handle is populated when a handle is claimed.
 *
 * WHAT WENT WRONG. There are two columns called `handle`. practice_practitioner_identity.handle is the
 * claim; practice_booking_access.handle is the foreign key (migration 254) that carries it to patients.
 * 254 made the second ON UPDATE CASCADE, so CHANGING a handle moves the booking page automatically -- and
 * everybody, including this codebase's own comments, then assumed the column looked after itself. Nothing
 * ever performed the FIRST write. It was null on every booking page that had ever existed, which made the
 * HANDLE_CLAIMED publish blocker unsatisfiable by any amount of using the product, while Practice Setup's
 * header cheerfully displayed the claimed handle two clicks away.
 *
 * WHY THESE TESTS EXIST IN THIS SHAPE. The interesting behaviour is four branches of a write that must
 * never throw and must never refuse its caller, and a deliberate refusal to guess when two practitioners
 * both point at one page. None of that is visible to a grep. So the helpers are called for real against a
 * stub `admin`, and only the things that genuinely are source facts -- claimHandle calling the adoption at
 * all, and the UPDATE branch still never touching the column -- are pinned by reading the file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimedHandlesForWorkspace, handleForWorkspace, adoptHandleOntoBookingPage,
} from "../src/lib/practice/identity-service";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " -- " + detail : ""}`); }
};

/**
 * A PostgREST builder that records the call chain and answers from a script.
 *
 * Every method returns the same object so any chain order works, and `then` makes the object awaitable
 * wherever the real builder is awaited -- directly after .limit()/.select(), or after .maybeSingle().
 */
function stub(script: {
  identities?: { handle: string }[];
  updateRows?: { id: string }[] | null;
  updateError?: { message: string } | null;
  pageRow?: { id: string } | null;
}) {
  const calls: string[] = [];
  let table = "", didUpdate = false;
  const api: any = {
    calls,
    from(t: string) { table = t; didUpdate = false; return api; },
    select() { return api; },
    update(patch: any) { didUpdate = true; calls.push("update:" + JSON.stringify(patch)); return api; },
    eq() { return api; },
    not() { return api; },
    is(col: string, val: any) { calls.push(`is:${col}:${String(val)}`); return api; },
    limit() { return api; },
    maybeSingle() { calls.push("maybeSingle"); return api; },
    then(resolve: (v: any) => void) {
      if (table === "practice_practitioner_identity") return resolve({ data: script.identities ?? [], error: null });
      if (didUpdate) return resolve({ data: script.updateRows ?? null, error: script.updateError ?? null });
      return resolve({ data: script.pageRow ?? null, error: null });
    },
  };
  return api;
}

const WS = "b7c5dbc1-22e1-4c53-900c-c2c0f0e7135b";

async function main() {
  console.log("\nHANDLE ADOPTION HARNESS\n");

  // -- 1-3. WHICH HANDLE A PAGE SHOULD CARRY --------------------------------
  ok("1. one claimed identity resolves to that handle",
    (await handleForWorkspace(stub({ identities: [{ handle: "elisham1" }] }), WS)) === "elisham1");

  ok("2. no claimed identity resolves to null",
    (await handleForWorkspace(stub({ identities: [] }), WS)) === null);

  // The one that would be a silent wrong answer rather than a missing one: picking either handle puts one
  // clinician's personal address on a practice they share. Refusing is the whole point.
  ok("3. two claimed identities refuse to resolve rather than pick one",
    (await handleForWorkspace(stub({ identities: [{ handle: "elisham1" }, { handle: "amina2" }] }), WS)) === null);

  ok("3b. and the ambiguous case is still REPORTABLE, not merely absent",
    ((r) => r.ok && r.handles.length === 2)(await claimedHandlesForWorkspace(stub({ identities: [{ handle: "elisham1" }, { handle: "amina2" }] }), WS)));

  // -- 4-8. THE WRITE, AND ITS FOUR HONEST OUTCOMES -------------------------
  ok("4. an identity with no primary workspace has no page to write to",
    (await adoptHandleOntoBookingPage(stub({}), null, "elisham1")) === "no_workspace");

  ok("5. a page with a null handle adopts it",
    (await adoptHandleOntoBookingPage(stub({ updateRows: [{ id: "p1" }] }), WS, "elisham1")) === "adopted");

  ok("6. no rows matched and no page exists is reported as no_page",
    (await adoptHandleOntoBookingPage(stub({ updateRows: [], pageRow: null }), WS, "elisham1")) === "no_page");

  // 6 AND 7 ARE THE SAME ZERO ROWS FROM THE DATABASE. Collapsing them would report "no page" for a
  // practice whose page already carries a colleague's handle -- a state a person has to resolve, hidden
  // behind a state that resolves itself.
  ok("7. no rows matched but a page exists is reported as page_has_handle",
    (await adoptHandleOntoBookingPage(stub({ updateRows: [], pageRow: { id: "p1" } }), WS, "elisham1")) === "page_has_handle");

  let threw = false;
  let refused = "";
  try {
    refused = await adoptHandleOntoBookingPage(
      stub({ updateRows: null, updateError: { message: "boom" } }), WS, "elisham1");
  } catch { threw = true; }
  ok("8. a database error is refused, not thrown", !threw && refused === "refused",
    threw ? "it threw" : `got ${refused}`);

  // -- 9. THE GUARD THAT KEEPS IT FROM STEALING A PAGE ----------------------
  const s = stub({ updateRows: [{ id: "p1" }] });
  await adoptHandleOntoBookingPage(s, WS, "elisham1");
  ok("9. the write is guarded on the handle being null",
    s.calls.some((c: string) => c === "is:handle:null"), s.calls.join(" | "));

  // -- 10-15. THE SOURCE FACTS ----------------------------------------------
  const root = join(__dirname, "..");
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//")).join("\n");

  const identityRaw = readFileSync(join(root, "src/lib/practice/identity-service.ts"), "utf8");
  const accessRaw = readFileSync(join(root, "src/lib/practice/patient-access.ts"), "utf8");
  const identity = strip(identityRaw);
  const access = strip(accessRaw);

  // The stripper has to be shown to work, or every assertion below can pass on prose.
  ok("10. the comment stripper actually removes comments",
    identityRaw.includes("ON UPDATE") && !identity.includes("ON UPDATE"));

  ok("11. claimHandle performs the adoption",
    identity.includes("adoptHandleOntoBookingPage(admin, identity.primary_workspace_id, h)"));

  // THE FIX MUST NOT BE ABLE TO BREAK THE CLAIM. The identity write has already committed by this point,
  // so any `return` between the adoption and the audit would report a failure for a handle that IS
  // claimed -- and the practitioner could not retry, because the retry hits HANDLE_ALREADY_CLAIMED.
  const afterAdopt = identity.slice(identity.indexOf("const adoption = await adoptHandleOntoBookingPage"));
  const toAudit = afterAdopt.slice(0, afterAdopt.indexOf("await audit("));
  ok("12. nothing between the adoption and the audit can refuse the claim",
    toAudit.length > 0 && !toAudit.includes("return"), toAudit.trim());

  // The rule stated at saveBookingAccess: a settings SAVE never moves a handle. Creation seeds it; the
  // update branch must stay clear of the column.
  const upd = access.slice(access.indexOf("if (existing.value) {"));
  ok("13. the update branch still never writes handle",
    !upd.slice(0, upd.indexOf("const seeded")).includes("handle"));

  ok("14. the insert branch seeds it from the identity",
    access.includes("const adopted = await handleForWorkspace(admin, ctx.workspaceId)")
    && access.includes("...(adopted ? { handle: adopted } : {})"));

  ok("15. HANDLE_CLAIMED no longer states an unclaimed handle unconditionally",
    access.includes("claimedHandlesForWorkspace(admin, ctx.workspaceId)")
    && access.includes("is claimed, but this booking page does not carry it yet"));

  // -- 16-17. THE READINESS SCREEN'S SCOPE AND ITS ARITHMETIC ---------------
  //
  // Both of these rendered on a real screen. The publish blocker walked EVERY active session and
  // judged each against PUBLIC readiness, so six internal clinics -- internal on purpose, and which
  // s10 says must stay usable and non-public -- each reported "is set to internal, so it is not
  // offered to patients" as a fault the practice had to fix before it could publish. And `found`
  // counted the failures while every sibling row counts the passes, so the line read "11 of 1".
  // ⚠ BOTH ARMS, BECAUSE FIXING ONE LEFT THE BUG ON SCREEN. The verdict is built from `uncovered`
  // and `unresolved`, scoped in two different places. Scoping only the loop dropped the count from
  // 11 to 0 and left three internal clinics still named in the sentence underneath it as reasons
  // the practice could not publish -- a fix that improves the number and not the meaning.
  ok("16. the constraints check judges patient-bookable sessions only -- both arms of it",
    access.includes("rw.sessions.filter(s => bookableSet.has(s.id))")
    && !access.includes("for (const sess of rw.sessions) {")
    && access.includes("rw.uncovered.value.filter(u => bookableIds.includes(u.id))"));

  ok("17. and `found` counts what passed, not what failed",
    access.includes("found: Math.max(0, bookableIds.length - broken)")
    && !access.includes("found: uncovered.length + unresolved.length"));

  // -- CONTROL --------------------------------------------------------------
  // If this passes, the source assertions above are reading a file that says anything at all.
  ok("control. a claim the source does not make is not found",
    !identity.includes("adoptHandleOntoBookingPage(admin, args.workspaceId"));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
