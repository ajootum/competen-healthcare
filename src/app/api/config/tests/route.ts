import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { validateDefinition } from "@/lib/config/schema";
import { dependencyGate } from "@/lib/config/dependency-graph";
import { evalMetric, evalRule, evalPermission } from "@/lib/config/simulate";

// Configuration Testing & Simulation Centre (NCP-012) — no-code test suites that ASSERT expected outcomes against
// live config and gate promotion. GET lists suites (or one + recent runs); POST creates a suite; PATCH saves its
// cases; POST {action:run} executes every case server-side via a real executor and records the run + updates the
// suite's promotion gate. Super-admin. The sandbox provisioning / synthetic-data / load-test facets are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TEST_TYPES = ["schema", "dependency", "metric_rag", "rule_decision", "permission_policy", "object_status"];
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const notProvisioned = () => NextResponse.json({ error: "Test store not provisioned — run migration 097" }, { status: 409 });
const eq = (a: any, b: any) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// Execute one case against the live object; returns pass + actual + human detail.
async function runCase(admin: any, tc: any): Promise<{ pass: boolean; actual: any; detail: string }> {
  const { data: obj } = await admin.from("configuration_registry_objects").select("object_type, status, definition").eq("object_key", tc.object_key).maybeSingle();
  if (!obj) return { pass: false, actual: null, detail: `Object "${tc.object_key}" not found` };
  const def = obj.definition ?? {}; const exp = tc.expected ?? {}; const inp = tc.inputs ?? {};
  switch (tc.test_type) {
    case "schema": {
      const errs = validateDefinition(obj.object_type, def).filter((i: any) => i.severity === "error");
      return { pass: errs.length === 0, actual: { errors: errs.length }, detail: errs.length ? errs.map((e: any) => `${e.path}: ${e.message}`).join("; ") : "conforms to schema" };
    }
    case "dependency": {
      const g = await dependencyGate(admin, [tc.object_key]);
      return { pass: g.ok, actual: { cycles: g.cycles.length, broken: g.broken.length }, detail: g.ok ? "no cycles or broken references" : (g.reason ?? "dependency issue") };
    }
    case "object_status":
      return { pass: eq(obj.status, exp.status), actual: { status: obj.status }, detail: `status=${obj.status}, expected=${exp.status ?? "?"}` };
    case "metric_rag": {
      const r = evalMetric(def, Number(inp.value));
      return { pass: r.rag != null && eq(r.rag, exp.rag), actual: { rag: r.rag }, detail: r.rag == null ? "thresholds not set / value invalid" : `value ${inp.value} → ${r.rag}, expected ${exp.rag ?? "?"}` };
    }
    case "rule_decision": {
      const r = evalRule(def, inp);
      if (exp.matched === false) return { pass: !r.matched, actual: { matched: r.matched }, detail: r.matched ? `matched row ${r.rowIndex + 1}` : "no row matched (as expected)" };
      const wanted = exp.outputs ?? {};
      const ok = r.matched && Object.keys(wanted).every(k => eq(r.outputs[k], wanted[k]));
      return { pass: ok, actual: { matched: r.matched, outputs: r.outputs }, detail: r.matched ? `row ${r.rowIndex + 1} → ${JSON.stringify(r.outputs)}` : "no row matched" };
    }
    case "permission_policy": {
      const r = evalPermission(def, inp);
      let pass = true; const parts: string[] = [];
      if (exp.applies !== undefined) { pass = pass && r.applies === !!exp.applies; parts.push(`applies=${r.applies}`); }
      if (exp.resource && exp.action) { const g = r.effective.find((x: any) => eq(x.resource, exp.resource) && eq(x.action, exp.action)); const effect = g?.effect ?? "none"; if (exp.effect) pass = pass && eq(effect, exp.effect); parts.push(`${exp.resource}.${exp.action}=${effect}`); }
      if (exp.applies === undefined && !exp.resource) { pass = r.applies; parts.push(`applies=${r.applies}`); }
      return { pass, actual: { applies: r.applies, grants: r.effective.length }, detail: parts.join(", ") + (r.failing.length ? ` (failing: ${r.failing.join(",")})` : "") };
    }
    default:
      return { pass: false, actual: null, detail: `Unknown test type "${tc.test_type}"` };
  }
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Testing is platform super-admin only");
  const admin = (c as any).admin;
  const suite_key = new URL(req.url).searchParams.get("suite_key");
  if (suite_key) {
    const { data: suite, error } = await admin.from("configuration_test_suites").select("*").eq("suite_key", suite_key).maybeSingle();
    if (error && missing(error)) return notProvisioned();
    const { data: runs } = await admin.from("configuration_test_runs").select("passed, failed, total, gate, created_at, run_by_name").eq("suite_key", suite_key).order("created_at", { ascending: false }).limit(10);
    return NextResponse.json({ suite, runs: runs ?? [] });
  }
  const { data, error } = await admin.from("configuration_test_suites").select("suite_key, name, description, cases, last_run, status").order("updated_at", { ascending: false }).limit(500);
  if (error && missing(error)) return notProvisioned();
  return NextResponse.json({ suites: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Testing is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));

  if (b.action === "run") {
    const suite_key = String(b.suite_key ?? "").trim();
    const { data: suite, error } = await admin.from("configuration_test_suites").select("suite_key, cases").eq("suite_key", suite_key).maybeSingle();
    if (error && missing(error)) return notProvisioned();
    if (!suite) return badRequest("Suite not found");
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    const results = [];
    for (const tc of cases) { const r = await runCase(admin, tc); results.push({ key: tc.key, name: tc.name, test_type: tc.test_type, object_key: tc.object_key, pass: r.pass, actual: r.actual, expected: tc.expected, detail: r.detail }); }
    const passed = results.filter(r => r.pass).length, failed = results.length - passed;
    const gate = results.length > 0 && failed === 0 ? "pass" : "blocked";
    const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).single();
    await admin.from("configuration_test_runs").insert({ suite_key, passed, failed, total: results.length, gate, results, run_by: userId, run_by_name: me?.full_name ?? null });
    await admin.from("configuration_test_suites").update({ last_run: { passed, failed, total: results.length, gate, at: new Date().toISOString() }, status: results.length === 0 ? "draft" : failed === 0 ? "passing" : "failing", updated_at: new Date().toISOString() }).eq("suite_key", suite_key);
    return NextResponse.json({ ok: true, passed, failed, total: results.length, gate, results });
  }

  // create suite
  const suite_key = String(b.suite_key ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(suite_key)) return badRequest("suite_key must be lowercase, dot-separated (e.g. suite.ward_smoke)");
  if (!name) return badRequest("Suite name required");
  const { data: existing, error: exErr } = await admin.from("configuration_test_suites").select("suite_key").eq("suite_key", suite_key).maybeSingle();
  if (exErr && missing(exErr)) return notProvisioned();
  if (existing) return badRequest(`Suite "${suite_key}" already exists`);
  const now = new Date().toISOString();
  const { data, error } = await admin.from("configuration_test_suites").insert({ suite_key, name, description: String(b.description ?? "").trim() || null, cases: [], status: "draft", created_at: now, created_by: userId, updated_at: now, updated_by: userId }).select("suite_key, name, status").single();
  if (error) return missing(error) ? notProvisioned() : badRequest(error.message);
  return NextResponse.json({ ok: true, suite: data });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden("Testing is platform super-admin only");
  const admin = (c as any).admin, userId = (c as any).userId;
  const b = await req.json().catch(() => ({}));
  const suite_key = String(b.suite_key ?? "").trim().toLowerCase();
  if (!suite_key) return badRequest("suite_key required");
  const cases = Array.isArray(b.cases) ? b.cases : [];
  const seen = new Set<string>();
  for (const tc of cases) {
    if (!tc?.key || !/^[a-z][a-z0-9_]*$/.test(tc.key)) return badRequest(`Invalid case key "${tc?.key ?? ""}"`);
    if (seen.has(tc.key)) return badRequest(`Duplicate case key "${tc.key}"`);
    seen.add(tc.key);
    if (!TEST_TYPES.includes(tc.test_type)) return badRequest(`Case "${tc.key}": invalid test type`);
    if (!String(tc.object_key ?? "").trim()) return badRequest(`Case "${tc.key}" needs a target object`);
  }
  const { error } = await admin.from("configuration_test_suites").update({ cases, updated_at: new Date().toISOString(), updated_by: userId }).eq("suite_key", suite_key);
  if (error) return missing(error) ? notProvisioned() : badRequest(error.message);
  return NextResponse.json({ ok: true, cases: cases.length });
}
