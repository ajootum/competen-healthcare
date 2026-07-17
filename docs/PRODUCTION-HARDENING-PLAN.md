# COMPETEN — Production Hardening Scope & Cost

Takes the current working platform to a **production-grade, multi-tenant, secure, tested** system ready for real hospital data and a second customer organisation. Derived from the codebase review (2026-07).

**Rate assumptions** — East Africa senior blended ≈ **$1,000 / person-week**; US/EU agency blended ≈ **$6,000 / person-week** (40h weeks). External fees (pen test, legal) are quoted separately as pass-through costs.

---

## Phase A — Security (mandatory before any real patient data)

| # | Work item | Effort | E. Africa | US agency |
|---|---|---|---|---|
| A1 | Enforce Row-Level Security on all tenant-facing queries; move reads off service-role client; audit every policy | 4 wk | $4,000 | $24,000 |
| A2 | Input validation hardening, complete rate limiting, secrets management review | 2 wk | $2,000 | $12,000 |
| A3 | Auth hardening — MFA, session/expiry policy, login anomaly logging | 2 wk | $2,000 | $12,000 |
| A4 | External penetration test + remediation | 2 wk | $2,000 | $12,000 |
| | *External pen-test fee (pass-through)* | — | $5,000–15,000 | $8,000–20,000 |
| | **Phase A subtotal (labour)** | **10 wk** | **$10,000** | **$60,000** |

## Phase B — Multi-tenancy (needed for customer #2)

| # | Work item | Effort | E. Africa | US agency |
|---|---|---|---|---|
| B1 | Identity / organisation-membership / role-assignment model; workspace switching | 6 wk | $6,000 | $36,000 |
| B2 | Standards inheritance + tenant content overlays (landlord → tenant) | 3 wk | $3,000 | $18,000 |
| B3 | Subscription / plan management + billing hooks | 2 wk | $2,000 | $12,000 |
| B4 | Cross-tenant data-isolation test suite | 1 wk | $1,000 | $6,000 |
| | **Phase B subtotal** | **12 wk** | **$12,000** | **$72,000** |

## Phase C — Quality & reliability

| # | Work item | Effort | E. Africa | US agency |
|---|---|---|---|---|
| C1 | Test suite — unit + integration + E2E to meaningful coverage of engines & flows | 6 wk | $6,000 | $36,000 |
| C2 | CI/CD pipeline — automated tests, migration checks, preview deploys | 2 wk | $2,000 | $12,000 |
| C3 | Error monitoring + observability (Sentry, structured logs, alerts) | 1 wk | $1,000 | $6,000 |
| C4 | Typed Supabase client; remove ~89 unsafe casts | 1 wk | $1,000 | $6,000 |
| | **Phase C subtotal** | **10 wk** | **$10,000** | **$60,000** |

## Phase D — Performance & scale

| # | Work item | Effort | E. Africa | US agency |
|---|---|---|---|---|
| D1 | Query optimisation, pagination, DB indexes, caching layer | 3 wk | $3,000 | $18,000 |
| D2 | Load testing + tuning to target concurrency | 2 wk | $2,000 | $12,000 |
| | **Phase D subtotal** | **5 wk** | **$5,000** | **$30,000** |

## Phase E — Compliance & operations

| # | Work item | Effort | E. Africa | US agency |
|---|---|---|---|---|
| E1 | Accessibility (WCAG 2.1 AA) pass — contrast, ARIA, keyboard, screen-reader | 2 wk | $2,000 | $12,000 |
| E2 | Backup / disaster recovery + operational runbooks | 2 wk | $2,000 | $12,000 |
| E3 | Health-data compliance review (local data-protection law / GDPR-equivalent) | 2 wk | $2,000 | $12,000 |
| | *External legal/compliance fee (pass-through)* | — | $3,000–10,000 | $8,000–25,000 |
| | **Phase E subtotal (labour)** | **6 wk** | **$6,000** | **$36,000** |

---

## Totals

| | Effort | E. Africa (labour) | US agency (labour) |
|---|---|---|---|
| **All phases** | **43 person-weeks (~11 person-months)** | **~$43,000** | **~$258,000** |
| **+ external fees** (pen test + legal) | — | +$8k–25k | +$16k–45k |
| **Grand total** | | **~$50,000 – $70,000** | **~$275,000 – $305,000** |

**Timeline:** a team of 2–3 engineers runs this in **~3–4 calendar months** (phases A→C can partly overlap).

## Prioritisation if budget is staged

1. **Phase A** — non-negotiable before real patient data touches the system.
2. **Phase C** — tests + monitoring; protects everything else and catches regressions.
3. **Phase B** — only when a second customer organisation is signed (until then, single-tenant is fine).
4. **Phases D & E** — scale and compliance polish as the user base grows; E3 may be legally required sooner depending on jurisdiction.

*Estimates assume the specification and current build are the baseline; no rework of existing working features is included beyond the security/test retrofits listed.*
