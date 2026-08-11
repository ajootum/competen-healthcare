/**
 * PHASE TWO, PRECONDITION 0 — LOCAL RE-AUTHENTICATION (COMP-SEC-001 s4/s10).
 *
 * WHAT IT PROVES:
 *   - ⚠ THE USER'S DECISION OF 2026-08-10: the PIN gates the CACHES and never the outbox. A lockout
 *     destroys copies the practice still holds and nothing else.
 *   - the key is DERIVED, not stored: a wrong PIN cannot open what a right PIN sealed, and the record
 *     persisted to the device contains no key.
 *   - a wrong PIN consumes an attempt; ⚠ a derivation FAULT does not, because a browser quirk must not
 *     lock somebody out of their own device.
 *   - cooling down and lockout refuse BEFORE deriving, so a refused attempt costs no battery.
 *   - the PIN floor is enforced, the strength hint is advice rather than a second refusal.
 *   - every sentence a person reads says what happens to captured work.
 *
 * ⚠ Web Crypto exists in node, so the derivation here is tested for real rather than asserted against
 * source. What is NOT tested is the IndexedDB persistence around it -- that needs a browser.
 *
 *   npx --yes tsx scripts/practice-offline-lock-harness.ts
 */
import { readFileSync } from "node:fs";
import {
  LOCK_COOLDOWN_AFTER, LOCK_FORGOTTEN_NOTE, LOCK_HONEST_NOTE, LOCK_ITERATIONS, LOCK_MAX_ATTEMPTS,
  LOCK_MIN_LENGTH, LOCK_SESSION_MS, LOCK_VERIFIER_PLAINTEXT, LOCKOUT_CLEARS, LOCKOUT_NEVER_CLEARS,
  checkPin, deriveLockKey, enrolLock, lockAfterFailure, lockAfterSuccess, lockAttemptsLeft,
  lockCooldownMs, lockMessage, lockSessionValid, lockStateOf, unlock, type LockRecord,
  deriveKek, newWrappedDataKey, unwrapDataKey, rewrapDataKey,
} from "../src/lib/practice/offline-lock";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const NOW = new Date("2026-08-10T09:00:00.000Z");
const GOOD_PIN = "8241 marula";
const WRONG_PIN = "8241 marulb";

async function main() {
  console.log("\n=== PHASE TWO: LOCAL RE-AUTHENTICATION (precondition 0) ===\n");

  // ── 1. ⚠ THE DECISION: THE PIN NEVER GATES CAPTURED WORK ─────────────────────────────────────────
  const source = readFileSync("src/lib/practice/offline-lock.ts", "utf8");
  const code = source.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  ok("1a. ⚠ the lock module does not import the outbox at all",
    !/from ["']@\/lib\/practice\/outbox/.test(code),
    "the PIN would be gating the only copy of captured work");
  ok("1b-control. stripping comments left real code behind", code.includes("deriveLockKey"));
  ok("1c. ⚠ what a lockout clears is copies only",
    LOCKOUT_CLEARS.every(x => /cached/i.test(x)) && LOCKOUT_CLEARS.length === 2,
    LOCKOUT_CLEARS.join(", "));
  ok("1d. ⚠ and the outbox is named as never cleared",
    LOCKOUT_NEVER_CLEARS.some(x => /outbox/i.test(x)));
  ok("1e. the lockout message tells the practitioner their recorded work is untouched",
    /untouched|still here/i.test(lockMessage("locked_out", null, NOW)));
  ok("1f. ⚠ and the enrolment warning says the same, before they commit to a PIN",
    /NOT protected by this PIN and is never lost/i.test(LOCK_FORGOTTEN_NOTE));

  // ── 2. THE KEY IS DERIVED, NOT STORED ────────────────────────────────────────────────────────────
  const enrolled = await enrolLock(GOOD_PIN, NOW);
  ok("2a. enrolment succeeds with an acceptable PIN", enrolled.ok, enrolled.ok ? "" : enrolled.reason);
  if (!enrolled.ok) { report(); return; }
  const record = enrolled.record;

  const serialised = JSON.stringify(record);
  ok("2b. ⚠ the PIN is not in what is stored", !serialised.includes("marula"));
  ok("2c. ⚠ and neither is the key -- there is no key field at all",
    !("key" in (record as object)) && !/\bkey\b/.test(Object.keys(record).join(",")));
  ok("2d. a salt and an iteration count ARE stored, because derivation needs them",
    record.salt.length === 16 && record.iterations === LOCK_ITERATIONS);
  ok("2e-control. the verifier is present and is not the plaintext",
    record.verifier.ciphertext.length > 0 && !serialised.includes(LOCK_VERIFIER_PLAINTEXT));

  // The real test: does the right PIN open what the right PIN sealed, and the wrong PIN not?
  const good = await unlock(record, GOOD_PIN, NOW);
  ok("2f. the right PIN unlocks", good.ok, good.ok ? "" : good.reason);
  const bad = await unlock(record, WRONG_PIN, NOW);
  ok("2g. ⚠ a PIN one character out does NOT unlock", !bad.ok);

  // ⚠ And the derived key is genuinely different, not merely rejected by a comparison.
  const k1 = await deriveLockKey(GOOD_PIN, Uint8Array.from(record.salt), 1000);
  const k2 = await deriveLockKey(WRONG_PIN, Uint8Array.from(record.salt), 1000);
  const iv = new Uint8Array(12);
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k1, new TextEncoder().encode("x"));
  const openedWrong = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k2, sealed).then(() => true).catch(() => false);
  ok("2h. ⚠ the wrong PIN derives a DIFFERENT key -- the ciphertext is unreadable, not just refused",
    openedWrong === false);
  const openedRight = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k1, sealed).then(() => true).catch(() => false);
  ok("2i-control. the right key does open it, so 2h is not a broken fixture", openedRight === true);

  // ── 3. ATTEMPTS, COOLDOWN AND LOCKOUT (COMP-SEC-001 s10) ─────────────────────────────────────────
  ok("3a. a wrong PIN consumes an attempt", !bad.ok && bad.record.failures === 1);
  ok("3b. a right PIN resets the counter", lockAfterSuccess(bad.record).failures === 0);

  let r: LockRecord = record;
  for (let i = 0; i < LOCK_COOLDOWN_AFTER - 1; i++) r = lockAfterFailure(r, NOW);
  ok("3c-control. below the cooldown threshold there is no wait", r.retryAt === null);
  r = lockAfterFailure(r, NOW);
  ok("3d. at the threshold a wait is imposed", r.retryAt !== null);
  ok("3e. and the state says cooling down", lockStateOf(r, NOW) === "cooling_down");
  ok("3f. the wait grows with further failures",
    lockCooldownMs(LOCK_COOLDOWN_AFTER) < lockCooldownMs(LOCK_COOLDOWN_AFTER + 3));
  ok("3g. and is capped", lockCooldownMs(99) === lockCooldownMs(50) && lockCooldownMs(99) > 0);

  // ⚠ Refuses BEFORE deriving: measured, because "it refuses" and "it refuses cheaply" differ.
  const t0 = Date.now();
  const whileCooling = await unlock(r, GOOD_PIN, NOW);
  const elapsed = Date.now() - t0;
  ok("3h. even the RIGHT PIN is refused while cooling down", !whileCooling.ok);
  ok("3i. ⚠ and it refuses without paying for a derivation", elapsed < 150, `${elapsed}ms`);

  let out: LockRecord = record;
  for (let i = 0; i < LOCK_MAX_ATTEMPTS; i++) out = lockAfterFailure(out, NOW);
  ok("3j. at the attempt limit the device is locked out",
    lockStateOf(out, NOW) === "locked_out" && out.lockedOutAt !== null);
  ok("3k. lockout is terminal -- even the right PIN is refused",
    !(await unlock(out, GOOD_PIN, NOW)).ok);
  ok("3l. attempts remaining never goes negative", lockAttemptsLeft(out) === 0);

  // ⚠ THE ONE THAT MATTERS MOST HERE: a fault is not a failure.
  const corrupt: LockRecord = { ...record, salt: [] , iterations: -1 };
  const faulted = await unlock(corrupt, GOOD_PIN, NOW);
  ok("3m. ⚠ a derivation FAULT does not consume an attempt",
    !faulted.ok && faulted.record.failures === record.failures, `failures=${faulted.record.failures}`);
  ok("3n. and it says the PIN could not be CHECKED, not that it was wrong",
    !faulted.ok && /could not be checked/i.test(faulted.reason));

  // ── 4. THE PIN FLOOR, AND STRENGTH AS ADVICE ─────────────────────────────────────────────────────
  ok("4a. shorter than the floor is refused", !checkPin("12345").ok);
  ok("4b. and the refusal explains the risk rather than quoting a rule",
    /guessed by someone who takes your device/i.test(checkPin("1").reason ?? ""));
  ok("4c. a repeated character is refused", !checkPin("888888").ok);
  ok("4d. the most common sequence is refused", !checkPin("123456").ok);
  ok("4e-control. an ordinary six-digit PIN IS accepted -- the floor is a floor, not a policy maze",
    checkPin("481920").ok);
  ok("4f. ⚠ strength is reported, not enforced: a weak-but-legal PIN passes and is labelled weak",
    checkPin("481920").ok && checkPin("481920").strength === "weak");
  ok("4g. a longer alphanumeric secret is labelled strong",
    checkPin("marula-8241-clinic").strength === "strong");
  ok("4h. the floor is the constant, not a second opinion", LOCK_MIN_LENGTH === 6);

  // ── 5. SESSION TIMEOUT (COMP-SEC-001 s4) ─────────────────────────────────────────────────────────
  const at = NOW.toISOString();
  ok("5a. a fresh unlock is valid", lockSessionValid(at, new Date(NOW.getTime() + 1000)));
  ok("5b. and expires", !lockSessionValid(at, new Date(NOW.getTime() + LOCK_SESSION_MS + 1)));
  ok("5c. never unlocked is not valid", !lockSessionValid(null, NOW));
  ok("5d. ⚠ a clock earlier than the unlock is not valid either",
    !lockSessionValid(at, new Date(NOW.getTime() - 60_000)));

  // ── 6. WHAT A PERSON READS ───────────────────────────────────────────────────────────────────────
  ok("6a. ⚠ not_enrolled is not dressed up as safe",
    /can be read by anyone/i.test(lockMessage("not_enrolled", null, NOW)));
  ok("6b. the honest note claims no more than it should",
    !/unbreakable|military|bank-grade|AES-256|secure/i.test(LOCK_HONEST_NOTE));
  ok("6c. ⚠ and it says the PIN is not kept anywhere",
    /not kept anywhere/i.test(LOCK_HONEST_NOTE));
  ok("6d. it admits what it is not proof against",
    /not proof against/i.test(LOCK_HONEST_NOTE));
  ok("6e. a cooling-down message gives a number of seconds, not 'try later'",
    /\d+ second/.test(lockMessage("cooling_down",
      { ...record, retryAt: new Date(NOW.getTime() + 30_000).toISOString() }, NOW)));
  ok("6f. once attempts have been used, the count is shown before it is too late",
    /attempts remain/i.test(lockMessage("locked", { ...record, failures: 4 }, NOW)));

  // ── 7. COST ──────────────────────────────────────────────────────────────────────────────────────
  // ⚠ A control on the honesty of the module header: it claims the derivation is deliberately slow. If
  // the iteration count were ever dropped to something fast, that claim would silently become false.
  const c0 = Date.now();
  await deriveLockKey(GOOD_PIN, Uint8Array.from(record.salt), LOCK_ITERATIONS);
  const cost = Date.now() - c0;
  ok("7a. ⚠ a derivation costs real time, which is the only thing protecting a short secret",
    cost > 50, `${cost}ms at ${LOCK_ITERATIONS} iterations`);

  // ── 8. ⚠ THE KEY-ENCRYPTION-KEY ─────────────────────────────────────────────────────────────────
  // The first attempt at precondition 0 sealed the caches with the PIN-derived key directly and had to
  // be reverted: the WRITER lives in the shell and the READER outside it, so only one of them ever held
  // the key, and `loadOfflineDay` DELETES what it cannot decrypt. A PIN would have destroyed every
  // cached day. The KEK exists so both halves can hold the same DATA key once a session is unlocked.
  const IT = 20_000;   // fast enough to run here; the product uses LOCK_ITERATIONS
  const salt8 = Uint8Array.from(record.salt);
  const kek = await deriveKek(GOOD_PIN, salt8, IT);
  const { key: dataKey, wrapped } = await newWrappedDataKey(kek);

  const iv8 = new Uint8Array(12);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(iv8);
  const sealed8 = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv8 }, dataKey,
    new TextEncoder().encode("a clinic day"));

  ok("8a. ⚠ what is stored is WRAPPED BYTES, not a key",
    Array.isArray(wrapped) && wrapped.every(n => typeof n === "number"), `${wrapped.length} bytes`);
  ok("8b-control. and the bytes are not the plaintext of anything recognisable",
    !JSON.stringify(wrapped).includes("clinic"));

  const reopened = await unwrapDataKey(await deriveKek(GOOD_PIN, salt8, IT), wrapped);
  const opened = reopened
    ? new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv8 }, reopened, sealed8))
    : null;
  ok("8c. ⚠ the right PIN re-derives the KEK, unwraps the SAME data key, and opens the record",
    opened === "a clinic day", String(opened));

  ok("8d. ⚠ the wrong PIN cannot unwrap at all",
    (await unwrapDataKey(await deriveKek(WRONG_PIN, salt8, IT), wrapped)) === null);
  ok("8e. ⚠ and it returns NULL rather than throwing -- a mistyped digit is a wrong PIN, not a fault",
    (await unwrapDataKey(await deriveKek(WRONG_PIN, salt8, IT), wrapped)) === null);

  // ⚠ THE ONE THAT MATTERS MOST FOR A LIVE DEVICE: changing the PIN must not orphan the caches.
  const newKek = await deriveKek("a-completely-different-pin", salt8, IT);
  const rewrapped = await rewrapDataKey(reopened!, newKek);
  const afterChange = await unwrapDataKey(newKek, rewrapped);
  const stillOpens = afterChange
    ? new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv8 }, afterChange, sealed8))
    : null;
  ok("8f. ⚠ changing the PIN RE-WRAPS without re-keying -- everything cached is still readable",
    stillOpens === "a clinic day", String(stillOpens));
  ok("8g. and the old PIN stops working the moment it is changed",
    (await unwrapDataKey(await deriveKek(GOOD_PIN, salt8, IT), rewrapped)) === null);

  // ⚠ THE KEK CANNOT BE SERIALISED, TESTED RATHER THAN GREPPED. The first version of this line searched
  // the source for "kek," and went red -- passing a KEK as an ARGUMENT is normal and correct, which is
  // most of what the file does with it. The property that actually matters is that it is
  // non-extractable, so no amount of later carelessness can write it to IndexedDB beside the ciphertext.
  const kekExportable = await crypto.subtle.exportKey("raw", kek).then(() => true).catch(() => false);
  ok("8h. ⚠ the KEK is NON-EXTRACTABLE -- it cannot be written anywhere, even by mistake",
    kekExportable === false);
  ok("8i-control. the DATA key IS extractable, because it has to be wrapped at all",
    await crypto.subtle.exportKey("raw", dataKey).then(() => true).catch(() => false));

  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
