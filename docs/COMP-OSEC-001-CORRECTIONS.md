# COMP-OSEC-001 — corrections to the offline security specification

**Status:** binding correction. Supersedes the quoted sentences in the source documents.
**Raised:** CP-OFFLINE-SURVEY-001 §3.8.2. **Decided:** 2026-08-08. **Written up:** 2026-08-10.
**Applies to:** COMP-SEC-001 (offline) §§2, 5, 10, 11 and COMP-OFF-001 §7.

---

## 0. The renumber, first, because everything below cites it

⚠ **`COMP-SEC-001` is two different documents.** One is the Platform Security Framework — migration 252
is titled after it and it is cited across the estate. The other is the offline security specification in
`~/Downloads/CP Offline/`. They share an identifier and they are not related.

**The offline one is renumbered `COMP-OSEC-001`.** Cheap now, expensive once cited. Every reference in
this file uses the new number and quotes the old section numbers unchanged, so the sentences remain
findable in the source `.docx`.

---

## 1. Why these five sentences cannot ship

All five describe a server reaching a device that has decided not to talk to it.

The mechanism they assume does not exist and cannot be built: `practice_session.revoked_at` is checked
**server-side**. A device holding a local cache and never reconnecting **never learns it was revoked**.
The stolen device is precisely the device that will not connect — and a thief who knows what they have
will make sure of it.

> **Revocation is a control that works exactly when it is not needed.**

This matters more than a wording quibble because **§11 is an acceptance criterion**. Somebody is expected
to sign it off. As written it cannot be signed off honestly by anybody who understands the mechanism, so
it would be signed off by somebody who does not — and the practice would hold a document telling them
their data is safe on a stolen phone.

⚠ This product has already had to withdraw two promises it could not keep — the AES-256 claim and the
percentile bands. **This is the third, and it is the first one caught before it shipped rather than
after.** Confirmed 2026-08-10: none of the five sentences has reached any screen, in the product or in
the marketing copy.

---

## 2. The corrections

### §11 — the acceptance criterion ⚠ MOST DANGEROUS

| | |
|---|---|
| **Was** | *"Unauthorized devices cannot access synchronized data."* |
| **Problem** | False for the only case that matters. A revoked device holding a cache **can** read everything it already holds, for as long as that cache lives. |
| **Now** | Revoking a device blocks all future synchronisation and all future access. **Data already on that device is not reachable by the practice and cannot be erased remotely.** It stops being readable when its own expiry passes: the clinic day at the end of that day, practice guidance after seven days. Until then, a revoked device that never reconnects still holds what it held. |
| **Testable as** | Revoke a device, keep it offline, confirm it still renders its cached day; advance past expiry, confirm it renders nothing and the record is deleted rather than hidden. Both halves must be demonstrated — the second alone would prove nothing. |

### §5 — remote deauthorization

| | |
|---|---|
| **Was** | *"Remote deauthorization for lost or stolen devices."* |
| **Problem** | "Remote" implies reach-out. There is none — only refusal of the **next** request. |
| **Now** | Revoking a lost or stolen device prevents it synchronising or signing in again. It does not reach the device, and nothing the practice does can make it forget what it is already holding. |

### §10 — cache cleanup on policy violation

| | |
|---|---|
| **Was** | *"Secure cache cleanup on policy violation."* |
| **Problem** | Requires code to run on the device. An offline device runs nothing on the server's behalf. |
| **Now** | When a device next reaches the practice and finds offline access has been withdrawn, it deletes everything held for that practice before rendering anything, and reports whether the deletion succeeded. A device that never reconnects is cleared by expiry alone. |
| **Note** | ✅ This half is BUILT. The gate returns `purge` as an instruction rather than a bare refusal, and a failed purge is reported and never swallowed — a practice believing data is gone when it is not is the worse outcome. |

### COMP-OFF-001 §7 — revoked devices

| | |
|---|---|
| **Was** | *"Secure handling of revoked devices."* |
| **Problem** | Ambiguous enough to be read as remote wipe, and it will be. |
| **Now** | A revoked device is refused at the next request it makes. Handling is server-side refusal plus the device's own expiry; there is no remote wipe. |

### §2 — authorised access

| | |
|---|---|
| **Was** | *"Ensure only authorized users can access offline information."* |
| **Problem** | True at cache time; not enforceable afterwards. Authorisation is checked when the copy is written, and nothing re-checks it on a device with no connection. |
| **Now** | Only an authorised user can cause data to be cached, and their capabilities are re-checked on every reconnect. Once written, the copy is protected by the device's own controls and by expiry — ⚠ **not** by a permission check, which cannot run offline. |

---

## 3. The canonical formulation

Anywhere this needs saying — spec, acceptance criteria, UI copy, sales answer — say it this way:

> Revoking a device stops it synchronising again and blocks all future access. **Data already cached on
> that device expires on its own and cannot be erased remotely** — revocation stops the next read, it does
> not reach back.

⚠ **What must never be said:** "remote wipe", "remotely erase", "revoked devices cannot access data",
"unauthorized devices cannot access synchronized data", or any phrasing where revocation is the subject
of a verb acting on the device.

---

## 4. What is actually true today (2026-08-10)

So this document can be checked against the build rather than believed.

| Claim | State |
|---|---|
| Cached data expires on its own, evaluated on every read, **deleted not hidden** | ✅ built |
| Expiry: clinic day ends at end of day in the practice timezone | ✅ built |
| Expiry: practice guidance after 7 days | ✅ built |
| A practice switching offline access off **purges** on next contact | ✅ built |
| A failed purge is reported, never swallowed | ✅ built |
| Device clock earlier than capture ⇒ render nothing | ✅ built |
| Local records are sealed (AES-GCM, non-extractable key) | ✅ built — see `OFFLINE_ENCRYPTION_NOTE` for what that does and does not defend against |
| Remote wipe of an offline device | ❌ **impossible, by design of the medium** |
| A permission re-check on an offline device | ❌ impossible |
| Local re-authentication (PIN / biometric) before reading a cache | ❌ **not built** — ⚠ and it is the control that would actually matter |
| Any offline write, queue or sync | ❌ not built, deliberately |

⚠ **The honest caveat that follows from row 10**, and it belongs in the risk register rather than being
argued away: a device holding a clinic day and a week of protocols is protected by a timer and by sealing
whose key sits on the same device. **A timer cannot tell the practitioner from a thief.** Local
re-authentication is what closes that, it does not exist, and until it does the exposure is a lost
unlocked device disclosing that these named people had appointments at this practice on that day.

---

## 5. What is deliberately not corrected

- **The 12-hour figure in §3.8.2 of the survey.** Superseded before it was implemented by the user's
  decision of 2026-08-08 (end of clinic day). Left in the survey as a record of the reasoning.
- **"Server Wins + Always Require Review".** Not corrected here because ⚠ **it is not in any of the
  nineteen documents** — "server wins" and "medication" appear zero times. It was attributed to a spec
  that does not contain it. Adopt it as our own decision if wanted; do not credit it.
- **The sentences about sync, conflict and queueing.** They describe work that does not exist, so they
  cannot yet be wrong on a screen. They are gated by the six preconditions in CP-OFFLINE-SURVEY-001 §5
  and must be re-read against this file before any of that is built.

---

## 6. Where this binds

1. Any acceptance criterion derived from COMP-OSEC-001 §§2, 5, 10, 11 or COMP-OFF-001 §7 uses the
   **Now** wording, not the source wording.
2. Any UI copy about device revocation uses §3's formulation verbatim.
3. ⚠ Phase two must re-read §4 before writing a sync protocol: three of the rows there are `impossible`
   rather than `not built`, and a sync design that assumes otherwise fails at the same point this
   specification did.

See `CP-OFFLINE-SURVEY-001.md` for the measurement this rests on.
