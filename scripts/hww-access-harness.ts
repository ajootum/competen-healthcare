// One-off harness for the HWW frontline read-scope filters (task: nurse read
// access on escalations / safety-alerts). The routes scope a non-staff caller
// with a PostgREST or-filter:
//   .or("raised_by.eq.U,assigned_responder.eq.U,patient_id.in.(p1,p2)")
// This proves, against REAL rows, that (a) the or-string parses, and (b) its
// result equals the union of the three legs computed independently — for both
// a user WITH patient assignments and one WITHOUT (no in.() leg).
//   npx --yes tsx scripts/hww-access-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // ── Ground truth: who has raised escalations / holds assignments? ──
  const [escAll, saAll, asgAll] = await Promise.all([
    admin.from("op_escalations").select("id, raised_by, assigned_responder, patient_id, status"),
    admin.from("op_safety_alerts").select("id, created_by, owner_id, patient_id, active"),
    admin.from("op_patient_assignments").select("staff_id, patient_id, status").eq("status", "active"),
  ]);
  const esc = escAll.data ?? [], sa = saAll.data ?? [], asg = asgAll.data ?? [];
  console.log(`── Ground truth ──\nescalations: ${esc.length} | safety alerts: ${sa.length} | active assignments: ${asg.length}`);

  const byStaff = new Map<string, string[]>();
  for (const a of asg) if (a.staff_id) byStaff.set(a.staff_id, [...(byStaff.get(a.staff_id) ?? []), a.patient_id].filter(Boolean));

  // Candidate A: a user who raised an escalation AND (ideally) holds assignments.
  const raisers = [...new Set(esc.map((e: any) => e.raised_by).filter(Boolean))] as string[];
  const withBoth = raisers.find(u => byStaff.has(u));
  const userA = withBoth ?? raisers[0] ?? [...byStaff.keys()][0];
  // Candidate B: a user with NO assignments (tests the no-in-leg branch): use a
  // raiser without assignments, else a random profile id.
  const userB = raisers.find(u => !byStaff.has(u))
    ?? (await admin.from("profiles").select("id").limit(1)).data?.[0]?.id;
  if (!userA || !userB) { console.log("Not enough real data to exercise the filters — need at least one escalation raiser or assignment."); process.exit(0); }
  console.log(`user A (with ${byStaff.get(userA)?.length ?? 0} assignments): ${userA}\nuser B (no assignments): ${userB}`);

  // ── The route's filter, verbatim construction ──
  const routeQuery = async (table: string, legsBase: string[], mine: string[], activeFilter: (q: any) => any) => {
    const legs = [...legsBase];
    if (mine.length) legs.push(`patient_id.in.(${mine.join(",")})`);
    const { data, error } = await activeFilter(admin.from(table).select("id")).or(legs.join(","));
    return { ids: new Set((data ?? []).map((r: any) => r.id)), error };
  };
  // Independent union of the legs, one query each.
  const unionQuery = async (table: string, eqCols: string[], user: string, mine: string[], activeFilter: (q: any) => any) => {
    const sets = await Promise.all([
      ...eqCols.map(col => activeFilter(admin.from(table).select("id")).eq(col, user)),
      mine.length ? activeFilter(admin.from(table).select("id")).in("patient_id", mine) : Promise.resolve({ data: [] }),
    ]);
    const u = new Set<string>();
    for (const s of sets) for (const r of (s as any).data ?? []) u.add(r.id);
    return u;
  };

  let pass = 0, fail = 0;
  const check = async (label: string, table: string, eqCols: string[], user: string, activeFilter: (q: any) => any) => {
    const mine = byStaff.get(user) ?? [];
    const legs = eqCols.map(colVal => `${colVal}.eq.${user}`);
    const r = await routeQuery(table, legs, mine, activeFilter);
    if (r.error) { console.log(`FAIL  ${label} — or-filter errored: ${r.error.message}`); fail++; return; }
    const u = await unionQuery(table, eqCols, user, mine, activeFilter);
    const same = r.ids.size === u.size && [...r.ids].every(id => u.has(id));
    console.log(`${same ? "PASS" : "FAIL"}  ${label}: or-filter ${r.ids.size} rows == union ${u.size} rows${same ? "" : " — MISMATCH"}`);
    same ? pass++ : fail++;
  };

  console.log("\n── Escalations (route: neq resolved/cancelled) ──");
  const escActive = (q: any) => q.neq("status", "resolved").neq("status", "cancelled");
  await check("user A", "op_escalations", ["raised_by", "assigned_responder"], userA, escActive);
  await check("user B (no in-leg)", "op_escalations", ["raised_by", "assigned_responder"], userB, escActive);

  console.log("\n── Safety alerts (route: active=true) ──");
  const saActive = (q: any) => q.eq("active", true);
  await check("user A", "op_safety_alerts", ["created_by", "owner_id"], userA, saActive);
  await check("user B (no in-leg)", "op_safety_alerts", ["created_by", "owner_id"], userB, saActive);

  // ── Negative: the or-scope must NOT return rows owned by nobody-in-the-legs ──
  const strangerRows = esc.filter((e: any) => e.raised_by && e.raised_by !== userB && e.assigned_responder !== userB && !["resolved", "cancelled"].includes(e.status));
  if (strangerRows.length && !byStaff.get(userB)?.length) {
    const r = await routeQuery("op_escalations", [`raised_by.eq.${userB}`, `assigned_responder.eq.${userB}`], [], escActive);
    const leaked = strangerRows.filter((e: any) => r.ids.has(e.id));
    console.log(`\n${leaked.length === 0 ? "PASS" : "FAIL"}  negative: user B's scope excludes ${strangerRows.length} other-owned open escalations (leaked: ${leaked.length})`);
    leaked.length === 0 ? pass++ : fail++;
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
