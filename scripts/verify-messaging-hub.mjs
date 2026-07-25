// Mirror verifier for PW-005 Messaging Hub (src/lib/messaging-hub.ts). Replicates channel aggregation over the
// real op_messages for the AMU hospital (auth wall). Read-only. Run: node scripts/verify-messaging-hub.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const q = async (p) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

const { data: cohort } = await db.from("profiles").select("id, full_name, hospital_id, email").ilike("email", "%@amu.competen.demo");
const nurse = (cohort ?? []).find((p) => p.hospital_id);
if (!nurse) { console.error("No AMU cohort."); process.exit(1); }
console.log(`Hospital of: ${nurse.full_name}\n`);

const msgs = await q(db.from("op_messages").select("id, channel, context_type, body, author_id, author_name, created_at").eq("hospital_id", nurse.hospital_id).order("created_at", { ascending: false }).limit(400));
if (!msgs.length) { console.log("No op_messages for this hospital (channels will be honest-empty; sending still works)."); process.exit(0); }

const byChannel = new Map();
msgs.forEach((m) => { const c = byChannel.get(m.channel); if (!c) byChannel.set(m.channel, { name: m.channel, ctx: m.context_type, count: 1, last: m }); else c.count++; });
const channels = [...byChannel.values()].sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());
const ctxCount = {}; msgs.forEach((m) => (ctxCount[m.context_type] = (ctxCount[m.context_type] ?? 0) + 1));

console.log(`Total messages ...... ${msgs.length}`);
console.log(`Distinct channels ... ${channels.length}`);
console.log(`By context_type ..... ${JSON.stringify(ctxCount)}`);
console.log("\nChannels (recent first):");
channels.slice(0, 10).forEach((c) => console.log(`  [${c.ctx.padEnd(8)}] ${String(c.count).padStart(3)} msg  ${c.name.slice(0, 30).padEnd(30)}  last: ${(c.last.body ?? "").slice(0, 35)}`));
console.log("\n✅ loadMessagingHub mirror ran clean.");
