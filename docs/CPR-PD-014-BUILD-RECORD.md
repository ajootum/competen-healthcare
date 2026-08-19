# CPR-PD-014 — Product Operations optimisation, build record

**2026-08-19.** Migrations 339–342 applied and verified. 30/30 harnesses, plane boundary green,
`tsc` clean, all five routes compile and enforce their capability guard.

## §11 sequence

| | Work package | State |
|---|---|---|
| 1 | Provisioning & Onboarding + onboarding projection | **done** |
| 2 | Launch Readiness + attestation ledger | **done** |
| 3 | Technical Operations + retry/control hardening | **A, B, D + §8.3 done** · §7 C outstanding |
| 4 | Practice Workspaces + health derivation / Practice 360 | **done** |
| 5 | Regression pass against Operations Overview | **done — this section** |

## §11 step 5 — the regression pass

**Operations Overview is unchanged: zero lines differ** against the pre-arc baseline. §12 permits
"strictly necessary compatibility wiring", and none was necessary — the three modules it depends on
(`pd-operations.ts`, `ops-ui.tsx`, `practice/operations.ts`) are also byte-identical, because every new
loader was added alongside rather than folded into them.

It remains a synthesis layer: four summary stats, launch state, "what needs attention", and a *Where
each fact is owned* panel linking to the three detail screens. It answers no question the detail screens
answer in full.

### One real finding: §7.3 duplication

Technical Operations still rendered **the entire cutover gate** — the same twelve items Launch Readiness
now presents as a governed decision. §7.3 forbids it: "Do not repeat the full Launch Readiness
checklist."

Two surfaces answering the same question is worse than it sounds, because the one with *less* context
is the one an operator happens to be looking at. Replaced with the summary a control-plane operator
actually needs before touching a toggle — how many controls are outstanding, which automatic checks are
failing right now — and a cross-link. Passing and pending items belong to the observational screen.

## Substrate delivered

| Migration | What | Verified |
|---|---|---|
| 339 | onboarding projection + `pd_ops_config` thresholds | 8 columns, `step_data` absent, real stall/complete rows |
| 340 | human attestation ledger, append-only | 12 columns, trigger enabled, secdef pinned |
| 341 | `provisioning_request.payload` for faithful retry | present as `jsonb` |
| 342 | launch-flag change history projection | 6 columns, no payload fields, real history |

## What is proven, and what is not

**Proven by break-test:** the health derivation (removing the activation window, and letting FAILED lose
to NEW, each turn it red), and the Practice 360 boundary (planting a patient link turns it red).

⚠ **Not proven:** the append-only trigger on 340 has never been seen to refuse an UPDATE, and the retry
endpoint has never been exercised. Both need a database that can be written to and rolled back —
staging, whose Postgres port is currently refusing TLS. Neither is a claim this record makes.

⚠ **No screenshots.** §14 asks for them in healthy and exception states. Every route returns 307 to
sign-in under its capability guard, and no synthetic HQ identity exists to authenticate as — the
synthetic practitioner provisioned for COMP-ENG-002G is deliberately a Practice user with no HQ
position. Producing them needs an authenticated operator session.

## Outstanding

- **§7 C** — the guided provisioning console: find account → verify eligibility → configure → review →
  provision. The current form is the development-style single form §7.2 C asks to replace.
- **§14** delivery evidence — screenshots, and the capability matrix as a document.
