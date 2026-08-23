# COMPETEN-RISK-001 — The case against Competen

**Written:** 2026-08-08 (as a conversation), **re-measured and corrected:** 2026-08-22
**Status:** Adversarial by request. Ten counts, ranked at the end by which are actually fatal.

> Written at the owner's request: *"prove how and why it won't succeed… look at it as a completely doomed
> project."* It argues one side deliberately. §12 says which parts I actually believe.
>
> ⚠ **This document was wrong the first time, and the corrections are kept in §11 rather than quietly
> edited out.** Every figure below carries the command that produced it, so the next reader can re-run
> them instead of trusting a number whose measurement date they cannot see. That is the whole reason this
> is now a file: a chat message cannot be corrected, and a stale critique is worse than none because it is
> quoted with confidence.

---

## 0. What changed between the two measurements

The original was taken against a **stale snapshot** — 812 commits, last dated 2026-08-07. The real state
on 2026-08-22 is **1,453 commits**, and the repo had grown roughly 43% in between.

| Measure | Claimed 08-08 | Actual 08-22 | Direction |
|---|---|---|---|
| Commits | 812 | **1,453** | — |
| Repo lines (`src/**/*.ts,tsx`) | 320,000 | **459,200** | — |
| `as any` | 2,328 | **2,703** | worse |
| `eslint-disable` | 1,423 | **1,544** | worse |
| TODO / FIXME / pending / stub | 829 | **998** | worse |
| Files over 800 lines | 34 | **54** | worse |
| Unit test **files** | 3 | **13** | better |
| Unit test **cases** | not measured | **114** | better |
| Harnesses total | 194 | **224** | — |
| **CI pipeline** | **"none at all"** | **`.github/workflows/ci.yml`, 6 jobs** | **the claim was false** |
| Harnesses **in CI** | "cannot be automated" | **38 entries, credential-free** | **the claim was false** |
| Error monitoring | none | **still none** | unchanged |
| Responsive classes in `/practice` | ~0 | **1,581** | better |
| Offline | absent | **service worker + IndexedDB + outbox + sync** | better |

**Read that table before reading the counts.** Four of the ten counts below rest on figures that moved.

---

## 1. The codebase is unmaintainable by anyone but a model

459,200 lines. 1,453 commits over 60 days, sustained at 37–87 commits a day. One author, working from
`.docx` specs, self-verifying. **2,703 `as any`. 1,544 `eslint-disable`. 998 TODO-class markers. 54 files
over 800 lines.**

The obvious rebuttal — *"`tsc --noEmit` passes clean"* — is the prosecution's evidence. A green typecheck
across 2,703 `as any` does not mean the types are right. It means **the type system was silenced 2,703
times and then asked whether it had any complaints.**

The person who can maintain this cannot be hired. Onboarding a human means reading someone else's
reasoning across 459k lines to make one safe change.

**Status after re-measurement: STRONGER than originally argued.** Every debt figure grew.

## 2. ~~The verification apparatus can never be automated~~ — **THIS COUNT WAS WRONG**

The original said: *"No CI pipeline at all. No `.github/workflows`. Nothing runs on commit."*

**False.** `.github/workflows/ci.yml` exists and runs six jobs: typecheck + lint, gitleaks secret scan on
a clean checkout, a dependency gate, **Vitest (114 tests, blocking)**, a **credential-free acceptance
harness subset (38 entries)**, and a **credential-free Playwright smoke**.

What survives of the count, and it is a real point:

- **186 of 224 harnesses are local-only**, run by a person with real credentials. They are the ones
  covering the deepest invariants, and nothing runs them unless somebody remembers.
- **There is still no error monitoring.** Grepping for Sentry / Datadog / Bugsnag returns one hit, which
  is the string `sEntry` inside a variable name. You will learn about production failures from users.

**Status: DOWNGRADED from fatal to a real but ordinary gap.** I measured once and never re-measured
across six hundred commits — the exact failure the repo's own *measure-before-claiming* rule names.

## 3. Nothing has ever been used, by anyone, once

Unchanged, and still the centre of the case. 1,039 page routes. Zero users. Sixty days of building and
**zero hours of watching a human being use it.** Every design decision is a guess wearing the costume of
a decision, and the confident documentation makes them harder to revisit, not easier.

**Status: UNCHANGED. Still the most important count.**

## 4. ~~It cannot be used where the work happens~~ — **LARGELY CLOSED**

The original found one responsive class in the encounter console and no offline anything.

Now: **1,581 responsive breakpoint uses across `/practice`**, and offline is genuinely built —
`public/sw.js`, IndexedDB stores, an outbox model, crypto, a sync page, three offline API routes.

**Status: LARGELY CLOSED.** This was the right work and it was done.

## 5. The flagship promise has no delivery mechanism

`dispatch.ts` still reads `"sms adapter pending"`. There is no WhatsApp adapter. Email and a webhook work.

Practice's entire value proposition is *"see what happens to them over time"*, which requires reaching a
patient. Email does not reach a parent in Kampala or Nairobi. **The headline claim is not under-built; it
is undeliverable.**

**Status: UNCHANGED and now the oldest open item on the list.**

## 6. The moat is a schema, and schemas are not moats

A funded competitor rebuilds the useful 15% in six months — and they will have users telling them which
15%, which is information this project does not have.

Real moats are distribution, brand, regulatory endorsement, switching costs and network effects. There
are none of any. Meanwhile **DHIS2 and iHRIS are free and already in the ministries; Moodle and Totara
are free and already in the hospitals.** In Africa the competition is free software; in the Gulf and UK
it is HealthStream with a sales team.

**Status: UNCHANGED.**

## 7. The credential thesis requires an institution; this is one person

A credential is worth what employers believe. Belief requires independent governance, longevity and a
body that outlives its founder. Bootstrapping a standards council, an assessor accreditation scheme, a
testing-centre network and regulatory relationships — while employed full-time, while maintaining 459k
lines, while separately selling to practitioners — is not a plan, it is four plans.

And a nursing council can obliterate the thesis with one memo announcing a national register.

**Status: UNCHANGED. Bites in year three, if there is one.**

## 8. The IP may not be yours

Built for an employer, plausibly on their time, populated with their data, for their nurses, on a problem
given by the job. If the hospital asserts ownership the enterprise line evaporates — **along with the
only deployment with proven usage, the only reference customer and the only assessor cohort.**

Unsettled. Every asset in this document is downstream of a question nobody has answered.

**Status: UNCHANGED, and still the cheapest fatal risk to close.**

## 9. The binding constraint is attention, and it is oversubscribed

Five SKUs, two businesses, a practitioner SaaS, a hospital programme, a credentialing body, a
testing-centre network, and a full-time job.

The evidence is in the repo. **Between the two measurements: 638 commits, Practice grew from 44 screens
to 95, and `EncounterConsole` went from 1,316 lines to 2,720 — it doubled.** In the same window the
product acquired no users, no WhatsApp adapter, and until 2026-08-22 no way to accept money at all.

**In fairness, that window also shipped offline and mobile**, which were genuinely existential and are
now genuinely done. The problem is not that nothing valuable was built. It is the **ordering**: fifty-one
new screens before a price column.

**The failure mode for this project is not building the wrong thing. It is building forever** — and
documentation is indistinguishable from progress right up until the money runs out.

**Status: UNCHANGED, and still the count that is actively winning.**

## 10. The economics don't clear

Practice: African ceiling ~$14M TAM, realistic capture $400k–1.4M over five years. Competency: $40–140k
per hospital on 12–24 month cycles, against free alternatives.

Against required spend: penetration test, legal review per market, testing centres, assessor training,
WhatsApp API, and a data-protection posture in three jurisdictions.

**You need capital. Capital wants traction. Traction requires what capital buys.** That deadlock is where
most emerging-market vertical SaaS dies.

**Status: UNCHANGED.**

---

## 11. Correction log

Kept rather than edited away, because a critique that silently revises itself cannot be trusted the
second time either.

| Date | Correction |
|---|---|
| 2026-08-22 | **§2 was materially false.** CI exists (`ci.yml`, six jobs, Vitest blocking, 38 harnesses credential-free). The "3 unit tests" figure was also stale — 13 files, 114 cases. |
| 2026-08-22 | **§4 largely closed.** Offline and mobile shipped between the measurements. |
| 2026-08-22 | **§1 understated.** Every debt figure was low; the repo grew ~43% and the debt with it. |
| 2026-08-22 | The original figures came from a snapshot 15 days and 638 commits stale. **The root cause was measuring once and never re-measuring** — the failure the repo's own measure-before-claiming rule exists to prevent. |
| 2026-08-22 | Payment path shipped (migrations 348–349, Flutterwave, mobile money). **Still not configured**: no `FLW_SECRET_KEY`, and `practice_solo_ugx` remains `active = false`, so nothing is chargeable yet. |

---

## 12. Where I actually put my weight

Three of the ten are fatal. The rest are survivable.

| Count | Verdict |
|---|---|
| **9 — building forever** | **Fatal, and observably winning.** Everything else is downstream. |
| **8 — the IP** | **Fatal and binary.** Costs a conversation; costs the company to ignore. |
| **3 — never used** | **Fatal while true, cheap to falsify.** One week with real users ends it. |
| 1 — code debt | Serious and growing, but this is what a Series A pays down. Not a cause of death. |
| 2 — verification | **Downgraded.** CI is real. Monitoring is the genuine gap. |
| 4 — mobile/offline | **Closed.** |
| 5 — WhatsApp | ~2 weeks. Existential to the *promise*, not to the company. |
| 6, 10 — moat and economics | True of every pre-traction company. Traction changes both. |
| 7 — the institution problem | Year three, if there is one. |

**What falsifies the whole case:** one unit, twenty competencies, five assessors, a completed baseline, a
median assessment under two minutes, and a signed IP agreement. Roughly ten weeks, and it collapses
counts 3, 8 and 9 at once — which is to say it collapses the case.

The strongest thing in this document is not that the project is doomed. **It is that count 9 is winning,
and that the assistant writing this has been an enthusiastic accomplice** — this document is itself
another artefact produced instead of a user.

---

## What this document is not

- **Not a verdict.** It argues one side by construction. Read §12 before acting on §1–10.
- **Not current unless re-run.** Every figure carries its command; the repo moves at ~40 commits a day.
  A number here is only as good as its date, which is the lesson §11 exists to record.
