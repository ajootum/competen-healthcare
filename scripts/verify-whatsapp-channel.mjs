// Verifies migration 350. "Success. No rows returned" is what the SQL editor prints for DDL whether or
// not every statement ran, and 350 is almost entirely CONSTRAINTS -- objects that can exist and not
// enforce. So this does not ask whether the constraints are present; it tries to VIOLATE each one and
// checks the database refuses. Every row it writes, it deletes.
// Run: node scripts/verify-whatsapp-channel.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = { ...process.env };
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let bad = 0;
const ok = (s) => console.log(`  OK    ${s}`);
const fail = (s, why) => { bad++; console.log(`  FAIL  ${s}\n        ${why}`); };

console.log("MIGRATION 350 - whatsapp as a third delivery kind\n");

const ws = await db.from("practice_workspace").select("id").limit(1).maybeSingle();
if (ws.error || !ws.data) { fail("a workspace to test against", ws.error?.message ?? "none exists"); process.exit(1); }
const WS = ws.data.id;
const made = [];
const write = (row) => db.from("practice_message").insert({
  workspace_id: WS, destination: "+256700000000", body: "probe", correlation_id: "probe-350", ...row,
}).select("id").maybeSingle();

// 1. The column exists at all.
const col = await db.from("practice_message").select("provider_template_name").limit(1);
col.error ? fail("provider_template_name exists", col.error.message) : ok("provider_template_name exists");

// 2. WIDENED: whatsapp is now an accepted kind (and names its template, per the new CHECK).
const a = await write({ kind: "whatsapp", purpose: "otp_booking", status: "queued", provider_template_name: "otp_booking" });
if (a.error) fail("whatsapp is an accepted kind", a.error.message);
else { ok("whatsapp is an accepted kind"); made.push(a.data.id); }

// 3. STILL CLOSED: widening by one value must not have opened the list.
const b = await write({ kind: "telegram", purpose: "otp_booking", status: "queued" });
if (b.error) ok("the kind list is still CLOSED - 'telegram' refused");
else { fail("kind list still closed", "an arbitrary kind was accepted"); made.push(b.data.id); }

// 4. THE NEW RULE: a handed-over whatsapp row that names no template must be refused.
const c = await write({ kind: "whatsapp", purpose: "otp_booking", status: "handed_over", provider_template_name: null });
if (c.error) ok("a handed-over whatsapp row with NO template is refused");
else { fail("whatsapp-names-template CHECK", "a whatsapp row was accepted with no template - body would assert wording nothing can prove"); made.push(c.data.id); }

// 5. AND ITS EXEMPTION: a refused or failed row never reached Meta, so it has no template to name.
const d = await write({ kind: "whatsapp", purpose: "otp_booking", status: "refused", refused_reason: "probe", provider_template_name: null });
if (d.error) fail("refused whatsapp rows are exempt", `the CHECK is too strict: ${d.error.message}`);
else { ok("a REFUSED whatsapp row may name no template - it never reached Meta"); made.push(d.data.id); }

// 6. sms and email are unaffected by the new CHECK.
const e = await write({ kind: "sms", purpose: "otp_booking", status: "handed_over", provider_template_name: null });
if (e.error) fail("sms unaffected", e.error.message);
else { ok("sms still needs no template - its body IS the message"); made.push(e.data.id); }

// 7. The channel table was widened too, or a practice could never switch it on.
const f = await db.from("practice_message_channel").insert({ workspace_id: WS, kind: "whatsapp", enabled: false }).select("id").maybeSingle();
if (f.error && /check/i.test(f.error.message)) fail("channel accepts whatsapp", f.error.message);
else { ok("practice_message_channel accepts kind whatsapp"); if (f.data) await db.from("practice_message_channel").delete().eq("id", f.data.id); }

for (const id of made) await db.from("practice_message").delete().eq("id", id);
const left = await db.from("practice_message").select("id").eq("correlation_id", "probe-350");
(left.data ?? []).length === 0 ? ok("probe rows cleaned up") : fail("cleanup", `${left.data.length} probe row(s) left behind`);

console.log(bad === 0 ? "\nALL CLEAR - 350 is applied and every constraint ENFORCES.\n" : `\n${bad} PROBLEM(S)\n`);
process.exit(bad === 0 ? 0 : 1);
