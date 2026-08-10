/**
 * hq-appointment-harness — proves the screen that grants access to Competen HQ.
 *
 * ⚠ THIS ARC SHIPPED WITH NO ASSERTIONS AT ALL. Everything about it had been verified by READING, which is
 * not the standard the rest of this codebase is held to — and it is the screen that decides who may enter
 * the governance platform. This file is the difference between "it reads correctly" and "it does that".
 *
 * WHAT IT PROVES
 *   1. The appointment this route writes actually GRANTS — `role` is an hq_position code, not one of the
 *      eight tenant committee roles /office-governance coerces to. That coercion is why the older screen
 *      produces real rows that grant nothing.
 *   2. The write gate is OWNERSHIP, not the read capability. hq.platform.users.view is held by the Platform
 *      Director position, so a capability-gated write would let a Platform Director appoint themselves Chief
 *      Executive — the escalation the whole model exists to prevent, arriving through the screen built to
 *      administer it.
 *   3. Self-appointment is refused.
 *   4. PATCH is the END verb. If it accepted an access-granting status it would be a second appointment path
 *      that skips every check on POST.
 *   5. There is no DELETE. Ending an appointment sets status; the row is the record that it happened.
 *   6. An appointment made through the OLD screen is rendered as an ORPHAN — real, and granting nothing.
 *      Showing it as a holder would be a lie; hiding it would be a different one.
 *
 * ⚠ WHAT IT CANNOT PROVE, STATED RATHER THAN IMPLIED. The route needs an HTTP session and this harness has
 * none, so 2–5 are asserted against the route's SOURCE with comments stripped, plus controls proving the
 * scanner can see what it looks for. 1 and 6 are proven against the real database with a real appointment.
 * A source assertion is weaker than an executed one and is labelled [source] wherever it appears.
 *
 * ⚠ AND THE CLEANUP IS IN A `finally`. Writing this harness stranded a fixture row three times, because a
 * shape error threw between the insert and the delete. A harness that leaves rows behind on the one path it
 * did not expect quietly poisons the next run.
 *
 *   npx --yes tsx scripts/hq-appointment-harness.ts
 */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadHqAppointmentBoard, HQ_END_STATUSES, type HqAppointmentBoard } from "../src/lib/hq/appointments";
import { resolveHqPositions } from "../src/lib/hq/context";
import { appointmentGrantsAccess } from "../src/lib/ogs/lifecycle";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const ROUTE = "src/app/api/hq/appointments/route.ts";
const PAGE = "src/app/super-admin/users/appointments/page.tsx";
const SELF = "scripts/hq-appointment-harness.ts";

let pass = 0; const fails: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fails.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

/**
 * ⚠ COMMENTS STRIPPED BEFORE EVERY SOURCE SCAN. The commonest vacuous assertion in this codebase is one
 * that matched a phrase inside the very comment explaining it — this file's own header names `DELETE`,
 * `hq_position` and "cannot appoint yourself", all of which are scanned for below.
 */
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

/**
 * Every level of the board is `Read<T>` — spaces, positions, holders, capabilities — so no level can be
 * mistaken for empty. This walks the nesting and reports whether ANY level failed to read, rather than
 * flattening a failure into an absent holder, which is the confident zero this codebase keeps finding.
 */
function allHolders(board: HqAppointmentBoard): { readable: boolean; holders: { personId: string | null }[] } {
  if (!board.spaces.ok) return { readable: false, holders: [] };
  let readable = true;
  const holders: { personId: string | null }[] = [];
  for (const sp of board.spaces.value) {
    if (!sp.positions.ok) { readable = false; continue; }
    for (const pos of sp.positions.value) {
      if (!pos.holders.ok) { readable = false; continue; }
      holders.push(...pos.holders.value);
    }
  }
  return { readable, holders };
}

(async () => {
  console.log("\nHQ APPOINTMENT SCREEN\n");
  const routeSrc = code(ROUTE), pageSrc = code(PAGE);
  let apptId: string | null = null;
  let subject: { id: string } | null = null;

  try {
    // ── 1. The guards, read from source ──────────────────────────────────────────────────────────
    console.log("  -- 1. the guards, read from source --");
    ok("S0-control", /resolveHqContext|requireHqContext/.test(routeSrc) && /requireHqContext/.test(pageSrc),
      "control: the stripper left the executable code intact -- both files still show their gate");
    // ⚠ THE NEEDLE IS BUILT FROM PIECES, AND THAT IS NOT FUSSINESS. The first version of this control
    // searched for a phrase spelled out in a regex literal ON THIS LINE — executable code, which the
    // stripper correctly leaves alone — so the control failed while the stripper was working perfectly.
    // The needle was in the haystack. Concatenating means the literal exists nowhere in the file, so the
    // only place the phrase can be found is the header comment this control is about.
    const headerOnly = "SHIPPED WITH NO " + "ASSERTIONS";
    ok("S0b-control", readFileSync(SELF, "utf8").includes(headerOnly) && !code(SELF).includes(headerOnly),
      "control: the phrase is in the raw file and GONE after stripping -- the stripper really removes comments");

    ok("S1", /ctx\.isOwner/.test(routeSrc) && /OWNER_ONLY/.test(routeSrc),
      "[source] the write gate is ctx.isOwner, not the read capability");
    const writeVerbs = routeSrc.split("export async function ").filter(s => /^(POST|PATCH)/.test(s));
    ok("S2", writeVerbs.length === 2 && writeVerbs.every(v => /if \(!ctx\.isOwner\)/.test(v)),
      `[source] every write verb checks ownership (${writeVerbs.length} found, each guarded)`);
    ok("S3", /cannot appoint yourself/i.test(routeSrc), "[source] self-appointment is refused");
    ok("S4", !/export async function DELETE/.test(routeSrc),
      "[source] there is no DELETE verb -- ending an appointment sets status");
    ok("S5", /HQ_END_STATUSES/.test(routeSrc) && !HQ_END_STATUSES.some(s => appointmentGrantsAccess(s)),
      `[source] PATCH accepts only end statuses (${HQ_END_STATUSES.join(", ")}), and NONE of them grants access`);

    // ── 2. The capability it names is real ───────────────────────────────────────────────────────
    console.log("\n  -- 2. the capability --");
    const named = routeSrc.match(/READ_CAPABILITY\s*=\s*"([^"]+)"/)?.[1]
      ?? pageSrc.match(/requireHqContext\("([^"]+)"\)/)?.[1] ?? null;
    ok("C0-control", !!named, `the gate names a capability (${named ?? "none found"})`);
    const cap = named ? await admin.from("hq_capability").select("code").eq("code", named).maybeSingle() : null;
    ok("C1", !!cap && !cap.error && !!cap.data,
      `${named} is in the live catalogue -- not invented (six invented capability codes have shipped in this product)`);

    // ── 3. Does an appointment made this way GRANT? ──────────────────────────────────────────────
    console.log("\n  -- 3. does an appointment made this way GRANT? --");
    const offices = await admin.from("ogs_offices").select("id, office_type").limit(50);
    const hqOffice = ((offices.data ?? []) as { id: string; office_type: string | null }[])
      .find(o => String(o.office_type ?? "").startsWith("hq_"));
    const positions = await admin.from("hq_position").select("code").eq("is_active", true).limit(50);
    const grants = await admin.from("hq_position_capability").select("position_code").limit(500);
    const granting = ((positions.data ?? []) as { code: string }[]).map(p => p.code)
      .find(c => ((grants.data ?? []) as { position_code: string }[]).some(g => g.position_code === c));
    const profs = await admin.from("profiles").select("id, role, roles, platform_role").limit(200);
    subject = ((profs.data ?? []) as { id: string; role: string | null; roles: string[] | null; platform_role: string | null }[])
      .find(p => !((p.roles?.length ? p.roles : [p.role]) as (string | null)[]).includes("super_admin") && !p.platform_role) ?? null;

    ok("W0-control", !!hqOffice && !!granting && !!subject,
      `fixture available: an HQ office, a granting position (${granting ?? "none"}), and a non-owner subject`);

    if (hqOffice && granting && subject) {
      const before = await resolveHqPositions(admin, subject.id);
      ok("W1-control", before.capabilities.length === 0,
        "control: the subject holds NOTHING beforehand, so W2 is a change rather than a coincidence");

      // The same row shape the route writes: role is the hq_position CODE.
      const ins = await admin.from("ogs_office_appointments")
        .insert({ office_id: hqOffice.id, person_id: subject.id, role: granting, scope: "enterprise", status: "active" })
        .select("id").single();
      // ⚠ NEVER DISCARD AN INSERT'S ERROR. A silently-failed fixture makes "it grants nothing" look like
      // the finding rather than the bug.
      ok("W2-control", !ins.error && !!ins.data,
        `the fixture appointment was written${ins.error ? " -- " + ins.error.message : ""}`);
      apptId = (ins.data as { id: string } | null)?.id ?? null;

      if (apptId) {
        const after = await resolveHqPositions(admin, subject.id);
        ok("W2", after.capabilities.length > 0,
          `⚠ AN APPOINTMENT CARRYING AN hq_position CODE GRANTS (${after.capabilities.length} capabilities) -- the whole difference from /office-governance, which coerces role to a tenant committee role and grants nothing`);

        // ── 4. The board, and ending an appointment ──────────────────────────────────────────────
        console.log("\n  -- 4. the board, and ending an appointment --");
        const walked = allHolders(await loadHqAppointmentBoard(admin));
        ok("B0-read", walked.readable,
          "every level of the board read cleanly -- spaces, positions and holders are each Read<T>, and none failed");
        ok("B0-control", walked.holders.length > 0,
          `control: the board rendered ${walked.holders.length} holder(s), so B1 is not asserted over an empty list`);
        ok("B1", walked.holders.some(h => h.personId === subject!.id),
          "the board shows the person as a holder of the position they were appointed to");

        for (const s of HQ_END_STATUSES) {
          await admin.from("ogs_office_appointments").update({ status: s }).eq("id", apptId);
          const r = await resolveHqPositions(admin, subject.id);
          ok(`E-${s}`, r.capabilities.length === 0, `status "${s}" grants nothing -- ending an appointment actually ends it`);
        }
        await admin.from("ogs_office_appointments").update({ status: "active" }).eq("id", apptId);
        ok("E-control", (await resolveHqPositions(admin, subject.id)).capabilities.length > 0,
          "control: back to active and the capabilities return -- the end statuses are the rule, not a broken fixture");

        // ── 5. An /office-governance row is an ORPHAN, never a holder ────────────────────────────
        console.log("\n  -- 5. the orphan case --");
        await admin.from("ogs_office_appointments").update({ role: "member" }).eq("id", apptId);
        const orphanBoard = await loadHqAppointmentBoard(admin);
        const walkedO = allHolders(orphanBoard);
        ok("O0-read", walkedO.readable && orphanBoard.orphans.ok,
          "the board still reads cleanly with an orphan row present");
        ok("O1", !walkedO.holders.some(h => h.personId === subject!.id),
          "a row whose role is a TENANT committee code is NOT rendered as a holder -- it grants nothing, and saying otherwise would be a lie");
        ok("O2", orphanBoard.orphans.ok && orphanBoard.orphans.value.some(o => o.personId === subject!.id),
          "...and it IS rendered as an orphan -- hiding a real row would be a different lie");
        ok("O3", (await resolveHqPositions(admin, subject.id)).capabilities.length === 0,
          "and it genuinely grants nothing, which is why /office-governance could never appoint to HQ");
      }
    }
  } finally {
    // ⚠ IN A finally, BECAUSE A SHAPE ERROR STRANDED THIS FIXTURE THREE TIMES WHILE THIS FILE WAS WRITTEN.
    console.log("\n  -- 6. fixtures --");
    if (apptId) await admin.from("ogs_office_appointments").delete().eq("id", apptId);
    const left = await admin.from("ogs_office_appointments").select("id").limit(10);
    ok("Z1", (left.data ?? []).length === 0,
      `no appointment row survives this run (${(left.data ?? []).length} found) -- nobody is appointed in this deployment, so any row here is ours`);
    if (subject) ok("Z2", (await resolveHqPositions(admin, subject.id)).capabilities.length === 0,
      "and the subject is back to holding nothing");

    console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fails.length} failed`);
    if (fails.length) { console.log("\nFAILURES:"); fails.forEach(f => console.log("  " + f)); }
    process.exit(fails.length === 0 ? 0 : 1);
  }
})();
