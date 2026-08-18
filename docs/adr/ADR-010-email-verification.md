# ADR-010: Production accounts require verified email addresses

**Status:** Accepted — owner decision, 2026-08-19. **Not yet switched on.** Staging validation first.

## Context

`mailer_autoconfirm` is currently **true**: nobody verifies an address. COMP-SECURITY-SURVEY-001 §8
item 1 listed this as a decision blocking COMP-IDENTITY-001's lifecycle, which *begins* with
"Email/phone verification", and warned that turning it on "blocks new signups until the mailer is
proven, on a live product."

## Decision

Production accounts require verified email addresses. **Do not flip today.** Validate the full flow in
staging first, then switch production.

**Staging acceptance flow** (all eight must pass):

signup → verification email → verification link → successful confirmation → login → expired link →
resend → duplicate account → password reset

## Two findings that change the plan

### 1. The migration policy costs nothing — checked, not assumed

Read-only against the live project, 2026-08-19:

```
total auth users:           47
WITHOUT email_confirmed_at:  0   <-- accounts a flip would lock out
```

**All 47 existing accounts already carry `email_confirmed_at`.** Auto-confirm stamped it at signup, and
`mailer_autoconfirm` governs *new* signups only — it does not retroactively unconfirm anyone. So the
concern behind "don't suddenly lock every existing account" is real in principle and **empty in fact
here**: the migration policy is *no action required*.

⚠ **But "confirmed" does not mean "verified".** Those 47 addresses are stamped because a setting said so,
not because a human proved control of the mailbox. That is a live question for account recovery — a
password reset goes to an address nobody has demonstrated reaching. Grandfathering them is the decision
implied by "don't lock them out"; **re-verifying them is a separate, later choice** and is recorded here
so it is not mistaken for having been handled.

### 2. ⚠ The mailer is a Supabase dashboard setting, invisible from this repo

There is **no mail provider package and no SMTP configuration in this repository.** The app has a Resend
adapter (`RESEND_API_KEY` + `NOTIFY_FROM_EMAIL`, `src/lib/notifications/dispatch.ts`) — but that is the
*application's* notification email. **It has nothing to do with the verification email**, which GoTrue
sends using the Supabase project's own SMTP settings.

Which means: if custom SMTP is not configured on the project, verification emails go through Supabase's
built-in mailer, which is severely rate-limited and explicitly not for production use. **A new user would
sign up and simply never receive the email**, and nothing in this repository would show why.

**Configure and prove a production SMTP provider on the project before the staging flow is even
meaningful** — five of the eight steps above are email-delivery steps. This is a prerequisite the plan
does not otherwise name, and it repeats a pattern this codebase has already been bitten by: the
signup-closed decision also lives in the Supabase dashboard, invisible from the repo, and bites first.

## Sequence

1. Configure production SMTP on the **staging** project; send a test message.
2. Enable signups on staging (they are closed in production by standing decision) and run all eight steps.
3. Configure SMTP on **production** and prove it before touching the flag.
4. Flip `mailer_autoconfirm` to false in production.
5. Existing 47: no action. Re-verification, if wanted, is a separate decision.

## Do not

- Do not flip `mailer_autoconfirm` before a production SMTP provider is configured and proven. A
  verification requirement with no working mailer is an outage for every new account.
- Do not assume the Resend key covers auth email. It does not.
- Do not report the 47 grandfathered accounts as verified addresses.
