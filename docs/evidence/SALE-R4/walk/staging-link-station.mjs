// SALE-2026-11 R4 walk SETUP, STAGING ONLY (refuses any other project). The fixture learner has no programme, so the OSCE builder offers
// no competency to build a station from. After the walk makes a practice-template station through the app, this links that ONE station
// to the competency the learner self-rated (its id, read from the self-assessment view), the way a competency-built station is linked (720 individual_scholar_osce_station.competency_id).
//   node staging-link-station.mjs <stationId> <competencyId> <fixtureFile>      |      node staging-link-station.mjs --remove <stationId> <fixtureFile>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../../../../package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const envFile = new URL("../../../../.env.local", import.meta.url);
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
const url = env.STAGING_SUPABASE_URL;
if (!url || !url.includes("ezhvpgtcqcdsgylrxgdb")) { console.error("refusing: not staging"); process.exit(1); }
const db = createClient(url, env.STAGING_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const remove = process.argv[2] === "--remove";
const [stationId, code, fixture] = remove ? [process.argv[3], null, process.argv[4]] : process.argv.slice(2);
const email = readFileSync(fixture, "utf8").split(/\r?\n/).find(l => l.startsWith("email="))?.slice(6).trim();
const { data: prof } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
if (!prof?.id) { console.error("fixture not found"); process.exit(1); }
if (remove) {
  const a = await db.from("individual_scholar_osce_attempt").delete().eq("user_id", prof.id).eq("station_id", stationId);
  const s = await db.from("individual_scholar_osce_station").delete().eq("user_id", prof.id).eq("id", stationId);
  console.log(a.error || s.error ? `ERROR ${(a.error ?? s.error).message}` : "station and its runs removed");
  process.exit(0);
}
const { data: comp } = await db.from("framework_competencies").select("id, code").eq("id", code).maybeSingle();
if (!comp) { console.error("competency not found"); process.exit(1); }
const r = await db.from("individual_scholar_osce_station").update({ competency_id: comp.id }).eq("user_id", prof.id).eq("id", stationId).select("id");
console.log(r.error ? `ERROR ${r.error.message}` : r.data?.length === 1 ? `linked ${comp.code ?? comp.id}` : "station not found");
