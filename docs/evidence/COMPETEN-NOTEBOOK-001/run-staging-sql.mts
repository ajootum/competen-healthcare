// Runs one SQL file on STAGING only, whole, in one transaction. The database address is read inside this script from the staging
// env file and never printed; the production guard refuses anything else. Prints the file's sha256, notices and the last result.
//   npx tsx docs/evidence/COMPETEN-NOTEBOOK-001/run-staging-sql.mts <file.sql> [--rollback]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const req = createRequire(join(process.cwd(), "package.json"));
req("@next/env").loadEnvConfig("C:/Users/elish/Documents/Competen/competen-sale-r1");
const { judgeDbTarget } = await import(`file:///${join(process.cwd(), "scripts/production-guard.ts").replace(/\\/g, "/")}`);
const { Client } = req("pg");

const [file, flag] = process.argv.slice(2);
const db = process.env.STAGING_DB_URL ?? "";
if (!db.includes("ezhvpgtcqcdsgylrxgdb") || !judgeDbTarget(db).ok) { console.error("refused: not staging"); process.exit(2); }
const text = readFileSync(file, "utf8");
console.log(`file ${file}\nsha256 ${createHash("sha256").update(text).digest("hex")}`);
const client = new Client({ connectionString: db, ssl: { rejectUnauthorized: false } });
client.on("notice", (n: { message: string }) => console.log(`notice: ${n.message}`));
await client.connect();
try {
  await client.query("begin");
  const r = await client.query(text);
  const last = Array.isArray(r) ? r[r.length - 1] : r;
  if (last?.rows?.length) console.log(JSON.stringify(last.rows, null, 1));
  await client.query(flag === "--rollback" ? "rollback" : "commit");
  console.log(`${flag === "--rollback" ? "Rolled back" : "Committed"} ${new Date().toISOString()}`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error(`FAILED, rolled back: ${(e as Error).message}`);
  process.exitCode = 1;
} finally { await client.end(); }
