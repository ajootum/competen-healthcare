/**
 * The dependency gate (COMP-SEC-001 "Automated vulnerability scanning", built for the CI pipeline).
 *
 * Runs `npm audit --json` and FAILS on any high or critical advisory that is not in
 * security/audit-allowlist.json. An allowlist entry is a recorded deviation with a reason and a
 * date, and every tolerated advisory is PRINTED on every run -- a silence that tolerated something
 * would be the swallowed-error class this repository keeps digging out.
 *
 * ⚠ IN-REPO ON PURPOSE. The first candidate was audit-ci, which crashed ("code undefined") against
 * this npm's report shape -- a gate that can crash is a gate that can be green by accident. Thirty
 * lines we own and break-test beat a dependency we can only trust.
 *
 *   npx --yes tsx scripts/audit-gate.ts
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Via = string | { source?: number; url?: string; title?: string; severity?: string };
type Vuln = { name: string; severity: string; isDirect: boolean; via: Via[] };

const GATE_SEVERITIES = new Set(["high", "critical"]);

const allowlist = JSON.parse(readFileSync("security/audit-allowlist.json", "utf8")) as {
  allow: { id: string; package: string; reason: string; dated: string }[];
};
const allowed = new Map(allowlist.allow.map(a => [a.id, a]));

// npm audit exits non-zero when it finds anything, which is not an error of the AUDIT -- the JSON is
// still the report. A genuinely broken run produces unparseable output and fails below instead.
let raw: string;
try {
  raw = execSync("npm audit --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  raw = (e as { stdout?: string }).stdout ?? "";
}
let report: { vulnerabilities?: Record<string, Vuln> };
try {
  report = JSON.parse(raw);
} catch {
  console.error("audit-gate: npm audit produced no readable report -- refusing to pass on silence.");
  process.exit(1);
}

const failures: string[] = [];
const tolerated: string[] = [];

for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!GATE_SEVERITIES.has(vuln.severity)) continue;
  // Advisories live on the package they are ABOUT: `via` entries that are objects. A via that is
  // only a string names another vulnerable package, whose own entry carries the advisory.
  const advisories = vuln.via.filter((v): v is Exclude<Via, string> => typeof v === "object");
  if (advisories.length === 0) continue;
  for (const adv of advisories) {
    const ghsa = adv.url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0] ?? `source-${adv.source}`;
    const entry = allowed.get(ghsa);
    if (entry) {
      tolerated.push(`${pkg} ${ghsa} (${entry.dated}): ${entry.reason.slice(0, 90)}...`);
    } else {
      failures.push(`${pkg} [${vuln.severity}] ${ghsa}: ${adv.title ?? "(untitled)"} ${adv.url ?? ""}`);
    }
  }
}

if (tolerated.length) {
  console.log("audit-gate: tolerated by recorded deviation (security/audit-allowlist.json):");
  for (const t of tolerated) console.log(`  - ${t}`);
}
if (failures.length) {
  console.error(`\naudit-gate: FAILED -- ${failures.length} high/critical advisories with no recorded deviation:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\naudit-gate: PASSED (${tolerated.length} tolerated, 0 unexplained high/critical).`);
