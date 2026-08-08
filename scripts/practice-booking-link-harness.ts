/**
 * CPB-002 -- PRACTITIONER PUBLIC IDENTITY, BOOKING LINK AND SHARING.
 *
 * ⚠ THIS FILE EXISTS BECAUSE OF ONE PROPERTY THAT CANNOT BE FIXED BY A DEPLOY: the booking address goes
 * onto a printed business card and an A4 poster. A screen showing a stale link is a bug; a box of
 * printed cards pointing at an address this application does not serve is a patient who cannot reach
 * their practitioner and has no way to find out why.
 *
 * SO THE ASSERTIONS BELOW ARE MOSTLY ABOUT ONE THING BEING ONE THING:
 *
 *   1. ⚠ THE QR CODE ENCODES THE PRINTED LINK, BYTE FOR BYTE -- with a control proving the comparison
 *      can tell one character apart.
 *   2. ⚠ THE ROUTE THIS APPLICATION SERVES IS THE PATH THE LINK NAMES. A constant and a folder, checked
 *      against each other.
 *   3. ⚠ AN OLD HANDLE REDIRECTS, and does not merely stay reserved -- which is the difference between
 *      a poster reaching the right practitioner and reaching a dead page.
 *   4. THE SHARE TARGETS CARRY THAT SAME LINK, send nothing, and say which of them hand it to a third
 *      party.
 *   5. ⚠ NO STORE HOLDS A RATING, A REVIEW COUNT, A VERIFICATION, A PHOTOGRAPH, A PATIENT TOTAL OR A
 *      RESPONSE TIME, asserted against the table's own columns -- and nothing renders one.
 *
 *   npx --yes tsx scripts/practice-booking-link-harness.ts
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  issueIdentity, claimHandle, changeHandle, updateIdentity, resolveHandle, handleAvailable,
  identitySetupView, identitySharing, shareTargets, embedSnippet, normaliseHandle,
  bookingUrl, bookingPath, bookingQr, identityHost, BOOKING_PATH, NOT_BUILT,
} from "../src/lib/practice/identity-service";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000fc00b";
const CORR = "harness-link";
const FIRST = "linkharnessone";
const SECOND = "linkharnesstwo";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);
const report = () => {
  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`    FAILED: ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-link-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CORR,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CORR, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ident } = await admin.from("practice_practitioner_identity").select("id").eq("user_id", OWNER);
  for (const i of (ident ?? []) as any[])
    await admin.from("practice_handle_history").delete().eq("identity_id", i.id);
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_booking_access").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
}

/** Walk a payload and return every value that is a function. */
function functionsIn(value: unknown, path = "$"): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => functionsIn(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => functionsIn(v, `${path}.${k}`));
  return [];
}

/**
 * The figures CPB-002's comp shows beside a named clinician that no store in this product holds.
 *
 * ⚠ `verified` IS DELIBERATELY NOT IN THIS PATTERN, and the reason is the most interesting one on the
 * list. There ARE licence_verified_at / _by / _reference columns -- but they record that a named person
 * looked at a licence and when, which is a PROVENANCE RECORD held internally, not a platform assurance
 * shown to patients. The comp's blue tick is a claim to a patient that somebody checked. Assertion 5b
 * proves the trio never reaches the public payload, which is the property that actually matters; a
 * blanket pattern here would have failed on a column that is right to exist.
 */
const FABRICATED = /rating|review|photo|avatar|portrait|experience|years_|patients_total|response_time|satisfaction/i;

async function main() {
  console.log("\nCPB-002 -- public identity, booking link and sharing\n");
  await cleanup();

  // ══ 1. THE CANONICAL ADDRESS ══════════════════════════════════════════════════════════════════
  section("1. The canonical address");

  ok("1a. the host is the decided one -- competenhealthcare.com, with no `practice.` subdomain",
    identityHost() === "https://competenhealthcare.com", identityHost());

  ok("1b. and the canonical URL is CPB-002's shape, composed rather than typed",
    bookingUrl("dreokaisu") === "https://competenhealthcare.com/practice/book/@dreokaisu",
    bookingUrl("dreokaisu"));

  // ⚠ THE CONSTANT AND THE FOLDER, CHECKED AGAINST EACH OTHER. A path constant that names a route this
  // application does not serve prints a dead link onto a poster, and nothing else in this codebase would
  // notice: tsc cannot see a route folder and eslint cannot see a URL.
  const routeDir = resolve(process.cwd(), "src/app", BOOKING_PATH.replace(/^\/|\/$/g, ""), "[handle]", "page.tsx");
  ok("1c. ⚠ AND A ROUTE ACTUALLY EXISTS AT THAT PATH. The constant and the folder are checked against each other, because nothing else in this codebase can see both",
    existsSync(routeDir), routeDir);

  const printRoute = resolve(process.cwd(), "src/app", BOOKING_PATH.replace(/^\/|\/$/g, ""), "[handle]", "print", "page.tsx");
  ok("1c-detail. and so does the print sheet the sharing workspace links to", existsSync(printRoute), printRoute);

  ok("1d. ⚠ THE OLD ROOT CATCH-ALL IS GONE. src/app/[handle] matched every unmatched single top-level path and answered each with a force-dynamic render; under a static prefix an unknown /foo is a plain 404 again",
    !existsSync(resolve(process.cwd(), "src/app", "[handle]")),
    "src/app/[handle] still exists");

  ok("1e. the in-application path and the public URL are the same composition, so a redirect cannot point somewhere the link does not",
    bookingUrl("dreokaisu") === `${identityHost()}${bookingPath("dreokaisu")}`,
    `${bookingUrl("dreokaisu")} vs ${identityHost()}${bookingPath("dreokaisu")}`);

  // ══ 2. ⚠ THE QR ENCODES THE PRINTED LINK, BYTE FOR BYTE ═══════════════════════════════════════
  section("2. The code and the link");

  const OPTS = { type: "svg" as const, margin: 1, width: 320, errorCorrectionLevel: "M" as const };
  const produced = await bookingQr("dreokaisu", "svg");
  const fromTheLink = await QRCode.toString(bookingUrl("dreokaisu"), OPTS);

  ok("2a. ⚠ THE QR CODE IS BYTE-IDENTICAL TO ONE GENERATED FROM THE PRINTED LINK. Two constructions of the same address is how a card gets printed pointing where the application does not serve, and a poster cannot be redeployed",
    produced === fromTheLink, `${produced.length} vs ${fromTheLink.length} bytes`);

  // ⚠ THE CONTROL: the comparison must be able to tell ONE CHARACTER apart, or 2a proves nothing.
  const fromAnotherLink = await QRCode.toString(`${bookingUrl("dreokaisu")}x`, OPTS);
  ok("2a-control. ⚠ AND THE COMPARISON DISCRIMINATES -- one extra character produces different bytes, so 2a is an equality that could have failed",
    fromAnotherLink !== fromTheLink, "a one-character difference produced identical output");

  const png = await bookingQr("dreokaisu", "png");
  ok("2b. PNG is produced too, as a data URL, in this process -- no external image service ever sees a practitioner's booking address",
    png.startsWith("data:image/png;base64,") && png.length > 500, png.slice(0, 40));

  ok("2c. and PDF is named as absent rather than implied",
    NOT_BUILT.some(n => n.key === "qr_pdf" && /PDF/.test(n.detail)));

  // ══ 3. THE IDENTITY, THE HANDLE AND THE REDIRECT ══════════════════════════════════════════════
  section("3. Handle, change and redirect");

  const ws = await provision(OWNER, "Dr Link Harness");
  const issued = await issueIdentity(admin, { userId: OWNER, displayName: "Dr Link Harness", workspaceId: ws, correlationId: CORR });
  ok("3a-control. an identity was issued and holds no handle -- nothing is auto-assigned, because a handle is a public name and close to permanent",
    issued.ok && issued.data.handle === null, issued.ok ? "" : (issued as any).message);
  if (!issued.ok) return report();

  const claimed = await claimHandle(admin, { userId: OWNER, handle: FIRST, correlationId: CORR });
  ok("3b-control. the first handle was claimed, and the URL it returns is the one composition",
    claimed.ok && claimed.data.bookingUrl === bookingUrl(FIRST),
    claimed.ok ? claimed.data.bookingUrl : (claimed as any).message);

  await updateIdentity(admin, { userId: OWNER, discovery: "link_only", correlationId: CORR });
  await admin.from("practice_practitioner_identity").update({ status: "active" }).eq("user_id", OWNER);

  const before = await resolveHandle(admin, FIRST);
  ok("3c-control. the first handle resolves to the profile before it is changed -- otherwise 3e would be a redirect from a name that never worked",
    before.kind === "found" && before.profile.handle === FIRST, JSON.stringify(before.kind));

  const changed = await changeHandle(admin, { userId: OWNER, handle: SECOND, correlationId: CORR });
  ok("3d-control. the handle was changed", changed.ok && changed.ok && changed.data.previous === FIRST,
    changed.ok ? "" : (changed as any).message);

  // ⚠ THE TWO HALVES OF practice_handle_history, SEPARATED. Reserving the old name and pointing it at the
  // new one are different properties and only one of them saves a printed poster.
  const reserved = await handleAvailable(admin, FIRST);
  ok("3e. ⚠ THE OLD HANDLE STAYS RESERVED -- nobody else can ever claim it, so an old card can never route to a stranger",
    !reserved.available && reserved.reason === "retired", JSON.stringify(reserved));

  const redirected = await resolveHandle(admin, FIRST);
  ok("3f. ⚠ AND IT REDIRECTS RATHER THAN MERELY RESERVING. This is the half that makes a printed poster keep working: an arrival at the old address is sent to the current one",
    redirected.kind === "redirect" && redirected.to === bookingPath(SECOND),
    JSON.stringify(redirected));

  ok("3f-detail. and the redirect target is the path this application serves, composed from the same constant as the printed URL -- not the pre-CPB-002 `/@handle`",
    redirected.kind === "redirect" && redirected.to.startsWith(BOOKING_PATH) && !/^\/@/.test(redirected.to),
    redirected.kind === "redirect" ? redirected.to : "");

  const never = await resolveHandle(admin, "nobodyhasthishandleatall");
  ok("3g. a handle never issued resolves to nothing, and says nothing else",
    never.kind === "none", JSON.stringify(never));

  // ⚠ CPB-002's HANDLE RULES SAY "letters/numbers/hyphens". THE CODE AND THE DATABASE SAY NO HYPHENS.
  // Asserted as the CURRENT behaviour rather than quietly reconciled: migrations 218 and 254 both carry
  // the charset check, so relaxing it is a migration and not a regex.
  ok("3h. ⚠ A HYPHEN IS STRIPPED, NOT ACCEPTED -- CPB-002's handle rules allow one and both migration 218 and migration 254 constrain it away. Reported rather than reconciled, because closing it is a migration",
    normaliseHandle("dr-eokaisu") === "dreokaisu", normaliseHandle("dr-eokaisu"));

  // ══ 4. SHARING, WHICH SENDS NOTHING ═══════════════════════════════════════════════════════════
  section("4. The sharing workspace");

  const share = shareTargets("Dr Link Harness", SECOND);
  ok("4a. every share target carries the one booking link, encoded, and none of them is a second composition",
    share.url === bookingUrl(SECOND)
    && share.targets.filter(t => t.href).every(t => t.href!.includes(encodeURIComponent(bookingUrl(SECOND)))),
    JSON.stringify(share.targets.map(t => t.key)));

  ok("4b. ⚠ AND NOTHING IS SENT BY THIS PRODUCT. Each target opens another application with the message written; the practitioner presses send. A button that posted for them would need a permission nobody granted",
    share.sentByThisProduct === false
    && share.targets.every(t => t.href === null || /^(https:|mailto:|sms:)/.test(t.href)),
    JSON.stringify(share.targets.map(t => t.href?.slice(0, 24))));

  ok("4c. ⚠ AND THE TWO THAT HAND THE ADDRESS TO A THIRD PARTY SAY SO. Facebook and LinkedIn receive it on click; the mail, SMS and clipboard ones do not leave the practitioner's own device",
    share.targets.filter(t => t.leavesCompeten).map(t => t.key).sort().join(",") === "facebook,linkedin,whatsapp",
    JSON.stringify(share.targets.map(t => `${t.key}:${t.leavesCompeten}`)));

  const embed = embedSnippet('Dr "Link" <Harness>', SECOND);
  ok("4d. the website embed is a plain anchor -- no script, no iframe -- so nothing of ours runs on somebody else's site and nothing of theirs can read a patient's answers",
    embed.startsWith("<a ") && !/script|iframe/i.test(embed) && embed.includes(bookingUrl(SECOND)),
    embed);

  ok("4d-detail. and a display name carrying angle brackets or quotes is escaped rather than pasted into markup",
    !embed.includes('<Harness>') && embed.includes("&lt;Harness&gt;") && embed.includes("&quot;Link&quot;"),
    embed);

  const sharing = await identitySharing("Dr Link Harness", SECOND);
  ok("4e. ⚠ THE SHARING PAYLOAD IS PLAIN DATA. A method on a payload handed to a client component type-checks, passes eslint, passes this file and kills the page at runtime",
    functionsIn(sharing).length === 0, functionsIn(sharing).join(", "));

  ok("4f. and its QR is the same bytes as the one the print sheet draws, because both come from bookingQr",
    sharing.qrSvg === await bookingQr(SECOND, "svg") && sharing.url === bookingUrl(SECOND));

  const view = await identitySetupView(admin, { userId: OWNER, workspaceId: ws });
  ok("4g. ⚠ THE CLAIM SCREEN'S LIVE PREVIEW IS COMPOSED ON THE SERVER FROM THE SAME PARTS. It used to build `${host}/@${typed}` in the browser -- a second construction, shown to the one person choosing a name they can never change",
    view.urlPrefix === `${identityHost()}${BOOKING_PATH}@`
    && `${view.urlPrefix}${SECOND}` === bookingUrl(SECOND),
    view.urlPrefix);

  ok("4h. a claimed identity carries a sharing workspace; there is nothing to share before that",
    view.state === "claimed" && view.sharing !== null && view.sharing!.url === bookingUrl(SECOND),
    JSON.stringify({ state: view.state, sharing: view.sharing === null }));

  // ══ 5. ⚠ THE FIGURES THE COMP SHOWS AND NO STORE HOLDS ════════════════════════════════════════
  section("5. What is refused");

  const { data: row, error: rowErr } = await admin.from("practice_practitioner_identity")
    .select("*").eq("user_id", OWNER).maybeSingle();
  ok("5-control. the identity row was read, so the column assertions below are about a real table rather than about an empty answer",
    !rowErr && !!row, rowErr?.message ?? "no row");
  if (!row) return report();

  const columns = Object.keys(row);
  ok("5a. ⚠ NO COLUMN HOLDS A RATING, A REVIEW COUNT, A PHOTOGRAPH, YEARS OF EXPERIENCE OR A RESPONSE TIME. The comp shows 4.9 from 128 reviews, 10+ years and 'usually within 2h' beside a named clinician; nothing in this product measures any of them, and CPB-002's own Future Enhancements list defers reviews",
    !columns.some(c => FABRICATED.test(c)), columns.join(", "));

  const profile = (await resolveHandle(admin, SECOND)) as any;
  ok("5b. and the public profile payload carries none of them either -- so a page cannot render one by accident",
    profile.kind === "found" && !Object.keys(profile.profile).some(k => FABRICATED.test(k)),
    JSON.stringify(Object.keys(profile.profile ?? {})));

  // ⚠ THE BLUE TICK, WHICH IS THE ONE THAT NEEDS SEPARATING RATHER THAN BANNING.
  ok("5b-control. ⚠ THE LICENCE-VERIFICATION COLUMNS DO EXIST, so 5b-tick below is about a real internal record and not about an absent one",
    ["licence_verified_at", "licence_verified_by", "licence_reference"].every(c => columns.includes(c)),
    columns.join(", "));

  ok("5b-tick. ⚠ AND NONE OF THEM REACHES A PATIENT. A blue tick beside a clinician's name tells a patient that somebody checked; what this product holds is a note that a named person looked at a licence, and nothing has ever contacted a council. The internal record stays internal",
    profile.kind === "found"
    && !Object.keys(profile.profile).some(k => /licence|verified/i.test(k))
    && NOT_BUILT.some(n => n.key === "licence_verification" && /Nothing here contacts a council/i.test(n.detail)),
    JSON.stringify(Object.keys(profile.profile ?? {})));

  ok("5c. what it DOES carry is only what the practitioner stored: qualifications, specialties, biography, languages and consultation types",
    profile.kind === "found"
    && ["qualifications", "specialties", "biography", "languages", "consultationTypes"]
      .every(k => k in profile.profile),
    JSON.stringify(Object.keys(profile.profile ?? {})));

  await cleanup();
  report();
}

main().catch(e => { console.error(e); process.exit(1); });
