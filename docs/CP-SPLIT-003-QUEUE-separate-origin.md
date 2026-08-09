# QUEUED — CP-SPLIT-003, the separate origin

**Status:** decided, not scoped. To be scoped once CP-SPLIT-002's membership work (migrations 279/280) has
landed. **Not to run concurrently with a change to who may enter the platform.**

**Why this file exists.** A queued arc has been stranded in this project before — CPR-V5-007's phases 4–6 sat
unbuilt because they were queued in conversation and the conversation moved on. The decisions below are
settled; only the scoping is outstanding.

---

## 1. The decision

**Competen Practice moves to `practice.competenhealthcare.com`. All of it. The apex keeps a permanent
redirect.**

| Stays on `competenhealthcare.com` | Moves to `practice.competenhealthcare.com` |
|---|---|
| `/practice` — the marketing landing page | the product shell, sign-in, onboarding |
| a permanent **301** from `/practice/book/@handle` | `@handle` booking, the wizard, the Practice API |

Marketing is website, not product: it carries no session and belongs with the site.

## 2. Why, including where I was wrong

This satisfies COMP-ARCH-PSA-001 §13 — *"a token issued for CompetenPractice MUST NOT be accepted
automatically by Competen Platform APIs"* — which nothing else does. Supabase issues one session cookie per
origin with no product audience, so two origins is the only mechanism that makes a Practice session
structurally incapable of authorising a Platform request. It is also the only option that lets one person
hold **both gates at once**, which the owner asked for.

⚠ **I first recommended keeping the booking address on the apex, and that was wrong.** The reason I gave —
printed cards should not depend on a subdomain — is answered completely by a 301: every card and QR code
already issued keeps working, forever, without a reprint. `PIS-000` §8 chose the path form deliberately and
its own comment anticipates this: *"If a single handle had been claimed this would have been a permanent
redirect instead, and it should be if that ever stops being true before launch."* `@elisham1` is claimed.

What I underweighted:

- ⚠ Leaving booking on the apex means **the apex keeps serving Practice code**, so Practice and Platform
  still share a cookie jar for part of the surface — the half of the isolation nobody would remember was
  missing.
- The booking flow issues a **patient** session (`practice_patient_session`). On the apex that sits in the
  same jar as staff Platform sessions.
- "Practice lives at practice.competenhealthcare.com" is one sentence a harness can enforce. "…except
  booking" is a footnote every future route has to remember, and will not.

## 3. ⚠ The detail most likely to sink it

**The session cookie must be set on `practice.competenhealthcare.com` and NEVER on
`.competenhealthcare.com`.** If it lands on the parent domain, both origins share it again, the isolation is
cosmetic, and the work will have been done while the bug remains. This must be asserted by a harness, not
by a code review.

## 4. Sequencing — do not block on DNS

Build **origin-agnostic first**: read the Practice origin from configuration, emit booking URLs and QR codes
from it, and have the redirect ready. The flip is then a DNS record plus one environment variable, not a code
change.

⚠ DNS is already the blocker for the OTP (no mail provider, no SMS gateway — so no patient can verify and
therefore none can book). When DNS is next touched, do both in one pass: the mail records and the subdomain.

## 5. Known consequences to handle in the scope

- Every absolute URL the product emits: booking address, QR payload, invitations, password reset, email
  links. `identity-service.ts` records all three candidate address forms and which was chosen — start there.
- `resolveHandle`'s redirect path already exists for a changed handle; a changed **origin** is a different
  case and needs its own permanent redirect.
- CORS and any fetch that assumes a same-origin API.
- Supabase Auth redirect allow-list must include the new origin before the flip, or sign-in breaks.
- The `robots`/`noindex` posture: the booking page is deliberately unindexed unless a practitioner chose
  `public`, and that must survive the move.
