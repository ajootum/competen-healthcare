// COMPETEN-DIG-001 proof of concept. Staging only, read only: what Scholar's AI activities have actually used, in numbers, grouped by activity.
// No learner, material or text is read or printed. Refuses to run against anything but staging. Keys read here, never printed.
import { readFileSync } from "node:fs";
const STAGING = "ezhvpgtcqcdsgylrxgdb";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.includes(STAGING)) { console.error("not staging: refused"); process.exit(1); }
const rows = [];
for (let from = 0; from < 50000; from += 1000) {
  const r = await fetch(`${url}/rest/v1/plat_ai_requests?select=operation,model,input_tokens,output_tokens,cost_usd,status&operation=like.individual_scholar*&status=eq.ok&order=created_at.desc`, { headers: { apikey: key, authorization: `Bearer ${key}`, range: `${from}-${from + 999}` } });
  if (!r.ok) { console.error("read failed", r.status); process.exit(1); }
  const page = await r.json();
  rows.push(...page);
  if (page.length < 1000) break;
}
const by = new Map();
for (const x of rows) {
  const g = by.get(x.operation) ?? { n: 0, input: [], output: [], cost: 0 };
  g.n++; g.input.push(x.input_tokens ?? 0); g.output.push(x.output_tokens ?? 0); g.cost += Number(x.cost_usd ?? 0);
  by.set(x.operation, g);
}
const med = a => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
const out = [...by].map(([operation, g]) => ({ operation, requests: g.n, medianInput: med(g.input), medianOutput: med(g.output), meanCostUsd: +(g.cost / g.n).toFixed(5) })).sort((a, b) => b.requests - a.requests);
console.log(JSON.stringify({ total: rows.length, activities: out }, null, 1));
