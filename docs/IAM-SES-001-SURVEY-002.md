# IAM-SES-001 SURVEY — session timeout and automatic logout, against what is built

Survey run 2026-08-12 at the owner's request, over the three documents supplied that day:

- `IAM-SES-001_Platform_Session_Timeout_and_Automatic_Logout_Developer_Specification (1).docx`
- `COMP-AUTH-001_v1_Unified_Authentication_Session_Management_Security_Engine (2).docx`
- `COMP-SEC-001_v1.0_Developer_Specification.docx`

⚠ **This does not replace `docs/COMP-SECURITY-SURVEY-001.md`** (876 lines, 2026-08-07), which already
surveyed COMP-AUTH-001, COMP-IDENTITY-001 and COMP-SEC-001. Most of that document's Phase 0 and Phase 1
has since shipped. This one covers what is genuinely new — **IAM-SES-001** — and re-states only what has
changed since.

---

## 1. The headline: one spec governs, one defeats itself, one has an ID collision

**IAM-SES-001 should govern wherever it speaks.** It is the only one of the three with an owner, a date,
a version, a status line (**"Approved for development"**), numbered sections, exact durations, defined
error and audit codes, and twelve acceptance criteria with testable values. The other two are undated,
unowned, statusless `python-docx` outputs; COMP-AUTH-001 has no numbering of any kind.

**COMP-AUTH-001 is self-defeating and must not be built as written.** It says *"Reset inactivity timer
on … API calls"* and *"Refresh access/refresh tokens every 20 minutes"*. The refresh **is** an API call,
so it resets the timer it lives under: **the 30-minute idle logout can never fire**, and the 5-minute
lock is reset by any background poll. Its own acceptance criteria ("automatic lock/logout function
correctly") cannot catch this. IAM-SES-001 §20 says the opposite in a normative sentence —
*"Background system requests shall not reset the inactivity timer"* — and tests it in AC#3.

**`COMP-SEC-001` names two different documents.** In the same folder: the supplied
`COMP-SEC-001_v1.0_Developer_Specification.docx` ("Offline Security, Encryption & Device Management")
and `COMP-SEC-001_v1_Competen_Platform_Security_Framework.docx` ("Platform Security Framework"). Same
ID, same major version, different scopes. ⚠ **This matters practically:** the *unsupplied* one is the
only document in the set that contains break-glass, failed-login thresholds and account lockout, MFA
channels, SSO and key rotation. **Resolve the ID before citing either.**

### Where the numbers disagree

| Control | IAM-SES-001 | COMP-AUTH-001 | Verdict |
|---|---|---|---|
| Idle → lock | **5 min** (sensitive) | 5 min | agree |
| Idle → logout | *no such stage* | **30 min** | ⚠ unresolved — see §2 |
| Absolute lifetime | **8 h** (4 h Super Admin) | **12 h** | IAM-SES governs |
| Warning | 60 s before **expiry** (i.e. at 4 min) | 60 s before **logout** (i.e. at 29 min) | IAM-SES governs; COMP-AUTH leaves the lock unwarned |
| Trusted device | cannot relax policy (`MIN()`) | **30 days** | incompatible by construction |
| Re-auth factors | password / passkey / MFA | PIN / biometrics / **Windows Hello** | IAM-SES governs |

**The two-stage question is genuinely unresolved.** COMP-AUTH has lock-at-5 then terminate-at-30;
IAM-SES has one idle expiry at 5 minutes and then nothing until the 8-hour absolute. Neither document
describes "locked but not yet terminated". **An architect must decide this; it cannot be inferred.**

---

## 2. ⚠ What would lock people out — the rule that outranks feature completeness

### 2.1 Live in the product today, and the sharpest item in this survey
**`mfa_required = true` is a one-way lockout right now.** The gate is correctly fail-closed
(`shell.ts` → `mfaGate()`), **there is no MFA enrolment page anywhere in the product**, and
`SecurityConsole.tsx` renders a live checkbox that sets the flag. Ticking it locks that practice out
irrecoverably. This is independent of any spec and should be addressed on its own merits — either
build enrolment first, or disable the control until it exists.

### 2.2 In the specs
- **Fail-closed with no break-glass.** IAM-SES §16 requires session enforcement to *"fail closed for
  protected requests"* and contains **no** break-glass, emergency access or degraded mode. A session
  service outage would lock every clinician out of every record at once — a patient-safety event in a
  system whose own scope names "Hospital/shared workstation". Break-glass exists only in the *colliding*
  COMP-SEC-001. (The product already has break-glass in Practice — `security.ts` — which is more than
  the spec provides.)
- **MFA with no recovery path.** MFA is required and *"cannot be disabled"*; §11 assumes an "MFA reset"
  flow that no spec defines. **No recovery codes, no backup factor, no admin-assisted reset.** Lose the
  phone, lose the account.
- **The 5-minute idle lock is unreachable by a reading user.** §7 says the server updates activity
  *"only when a valid authenticated request or explicit keep-alive confirmation is received"*. A
  clinician reading a record issues none. §15 concedes the case and still lets the session die. §4
  applies this to **"Assessment in progress"** — candidates locked out mid-exam for reading.
- **Offline re-auth requires being online** (COMP-SEC-001 §4 + §10), with no offline unlock path, and
  §10's *"secure cache cleanup on policy violation"* can destroy rather than merely lock the data.
- **Internal incoherence in the config ranges.** §13 permits a 2-minute idle timeout and a 120-second
  warning — a warning longer than the session. §13's 2–30 minute range also permits values §20's
  normative sentence forbids.

---

## 3. What is already built — the gap is planar, not featural

**The Practice plane has a genuinely complete, honestly documented session stack.** It is more complete
than most production systems and largely satisfies IAM-SES already:

| IAM-SES-001 asks for | In the product |
|---|---|
| Idle detection, warning, countdown | `session-engine.ts` — `idleDecision()`, warning at 60 s, three modes ENFORCE/OBSERVE/**UNKNOWN** ("a limit that was not read is not a limit") |
| Server-side enforcement | `touchSession()` in `security.ts`, called from every Practice page render |
| Lock screen + re-auth | `PracticeSessionGuard.tsx` — focus trap, password re-auth, and an unconditional "Sign out and start again" escape |
| Session/device register | `practice_session` (migration 213), cookie planted in `proxy.ts` |
| Revocation, trusted devices | `revokeSession()`, `setDeviceTrusted()`, security console |
| Audit events | `auth-audit.ts` — **13 event types, all emitted**, deduped per sign-in |
| Absolute lifetime | **measured, not enforced** — `ABSOLUTE_LIFETIME_OBSERVED` already accumulating |
| Clinical Pause Mode | built, and available regardless of policy |

⚠ **And it is dormant.** The one live `practice_security_policy` row has `session_idle_minutes: null`, so
every practice sits in OBSERVE. Nothing locks today. `practice_security_policy` **is** enforced on three
paths (MFA gate, idle limit, break-glass) — it is not a dead table; its values are simply unset.

⚠ **Everything outside `/practice` has GoTrue's cookie and nothing else** — no idle timeout, no lock
screen, no auth audit, no MFA gate. That is **855 of 939 pages and 311 of 440 API routes**, across
super-admin (205 pages), unit-manager (185), educator (128) and the rest.

**So IAM-SES-001 is not an extension of what exists. Platform-wide, it is a new build**: a provider in
`src/app/layout.tsx` (which currently mounts none), a per-request idle check inside `getCaller()` (219
routes), a platform session store, and the same treatment in 24 layouts.

---

## 4. What the specs do NOT contain

Across all three named documents there is **no password policy** (length, complexity, history, breach
check), **no lockout threshold or duration**, **no rate limits**, **no TOTP mechanics**, **no CAPTCHA**
and **no break-glass**. Any backlog item for those has **no source requirement** in this set — they live
in the colliding Platform Security Framework document, which was not supplied.

---

## 5. Recommendation

**Do not schedule "implement the three specs".** Two of the three should not be built as written, and
the third is a platform-wide new build whose riskiest requirements have no recovery paths.

Proposed order, smallest safe increments first:

1. **Close the live MFA lockout trap** (§2.1). Either build enrolment, or disable the checkbox until it
   exists. No spec needed; the hazard is real today.
2. **Resolve the `COMP-SEC-001` ID collision** and obtain the Platform Security Framework, since it is
   the only source for lockout, password policy and break-glass.
3. **Get the two-stage decision** (lock-then-logout, or single expiry) and the clinical-workspace idle
   value. IAM-SES's 5 minutes was written for shared-ward terminals; whether it applies to a clinician
   mid-consultation is a decision the documents cannot make.
4. **Absolute session lifetime, Practice-only** — one nullable column
   (`practice_security_policy.session_absolute_minutes`), bounds copied from the idle limit, and the
   measurement is already running. ~5 files, low risk, satisfies a real IAM-SES clause.
5. **Turn the Practice idle limit on for ONE practice** at a generous value, having watched
   `IDLE_OBSERVED` for a fortnight. The observation machinery exists precisely so this is evidence-led.
6. **Only then** consider the platform-wide engine — and if it is built, IAM-SES §7's activity rule is
   the part to take literally and COMP-AUTH's "reset on API calls" is the part to strike.

**COMP-AUTH-001 should be demoted to a superseded concept note.** Every numeric value it supplies is
either contradicted by IAM-SES-001 or self-defeating.
