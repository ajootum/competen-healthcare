# CPR-BUILD-001 — the v1.0 re-specification of Competen Practice

Thirty-seven developer specifications, CPR-000 to CPR-490, all dated 14–24 May 2025 and all marked
**v1.0**. This is not an increment on what was built. It is a different, larger product definition, and
the first job is to say so plainly rather than start typing.

## 1. THE NUMBERING COLLIDES WITH WHAT IS ALREADY BUILT. Read this first.

The existing `/practice` section was built against **CPR-001 … CPR-020 "V2"/"V3"** — twenty *workspace*
documents. The new set uses **CPR-000 … CPR-490 v1.0**, where the same strings mean different things:

| Identifier | Means in the OLD set (built) | Means in the NEW set (specified) |
|---|---|---|
| `CPR-001` | Practice Command Centre (workspace) | *not used* — v1.0 starts at CPR-000, then 010/020/030/040 |
| `CPR-010` | *not used* | Workspace Experience & UI System |
| `CPR-020` | Navigation & Application Shell | Workflow & Orchestration Engine |
| `CPR-030` | *not used* | Enterprise Data Architecture |
| `CPR-110` | *not used* | Appointment & Scheduling Management |

**This is live in code today.** `src/lib/marketing/practice-content.ts` tags every capability area with
`workspaces: ["CPR-0xx"]`, and `scripts/practice-content-harness.ts` asserts coverage of
`SURFACES = CPR-001..020`. Adopting the new numbering without addressing that turns a real traceability
assertion into a meaningless one — it will keep printing PASS against a scheme nobody uses.

**Decision required before any code is written.** Either
(a) namespace the old references (`CPR-V2-001`) and re-key the harness to the v1.0 set, or
(b) keep the marketing traceability on the V2 documents, which still describe the public pages, and use
v1.0 identifiers only for application modules.

(b) is cheaper and probably right — the V2 workspace docs are what the *public* pages were written from,
and the v1.0 set is what the *product* is built from. But it must be a decision, not a drift.

## 2. The 37, by domain

**Foundation (5)** — CPR-000 Enterprise Architecture · 010 Workspace Experience & UI · 020 Workflow &
Orchestration Engine · 030 Enterprise Data Architecture · 040 Practice Design System.

**Clinical Care (6)** — CPR-100 Patient Management · 110 Appointment & Scheduling · 120 Encounter
Management · 130 Clinical Documentation · 140 Follow-up Management · 150 Procedure & Clinical Activity.

**Practice Intelligence (8)** — CPR-200 Practice Intelligence · 210 AI Clinical Assistant · 220 Case
Memory · 230 Clinical Reflection · 240 Professional Portfolio · 250 Competency & CPD · 260 Knowledge
Management · 270 Analytics & Reporting.

**Practice Operations (8)** — CPR-300 Operations Home · 310 Team & Delegated Access · 320 Communication
& Document Management · 330 Reports, Documents & Correspondence · 340 Tasks, Reminders & Notifications ·
350 Search & Global Retrieval · 360 Configuration & Personalisation · 370 Security, Privacy &
Practitioner Control.

**Enterprise Services (10)** — CPR-400 Integration & Interoperability · 410 Mobile & Offline · 420 AI
Automation & Workflow Engine · 430 API & Developer Platform · 440 Billing, Subscription & Licensing ·
450 Deployment, Provisioning & Tenant Lifecycle · 460 Monitoring & Observability · 470 Business
Continuity & DR · 480 Enterprise Administration · 490 Roadmap & Release Governance.

## 3. What is already built, mapped to the new scheme

| v1.0 spec | Status today |
|---|---|
| CPR-040 Design System | **Partial.** Indigo palette adopted on the public homepage (CPR-001 v3). The app still uses the blue Practice accent and the platform PUI tokens. |
| CPR-100 Patient Management | **Core built.** Registry, identity, duplicate doctrine, merge (migration 193, `patients.ts`, 20 harness assertions). Far short of the spec's 360° profile. |
| CPR-110 Scheduling | **Core built.** Diary, availability, queue, arrival (migration 192, `scheduling.ts`, 19 assertions). No multi-location or AI scheduling. |
| CPR-120 Encounter Management | **Core built.** Eight-state lifecycle, SOAP, diagnosis/problem split, DB-enforced signed immutability (migration 194, 41 assertions). No 8-step guided lifecycle UI. |
| CPR-130 Clinical Documentation | **Partial.** SOAP segments exist inside the encounter. No template library, versioning, dictation or sign-and-lock document object. |
| CPR-450 Deployment & Tenant Lifecycle | **Partial.** Provisioning saga, entitlements, launch flags, operator console (migration 191). |
| CPR-140, 150, 200–270, 300–370, 400–440, 460–490 | **Not started.** |

Roughly **four of thirty-seven** have a real implementation behind them, and each of those four is a
subset of what its v1.0 document now asks for.

## 4. What the comps ask for that cannot be built as drawn

Recorded here because it recurs across the set and will otherwise be reinstated from the mockups:

- **Named real hospitals and invented testimonials** (already refused on the homepage — see
  `practice-content.ts`). Chris Hani Baragwanath, Kenyatta, UCH Ibadan, Muhimbili, Groote Schuur and
  Aga Khan are named as customers in the CPR-001 v3 comp; CPR-450's comp names client practices too.
- **Every dashboard number in every comp is invented** — 128 tenants, 2,348 encounters, 99.95% uptime,
  86.4 hrs saved. They are fine as *illustrations of a layout*; they must never render as data. Each
  module needs the same rule the existing pages use: real query or an honest empty state.
- **Compliance badges** — "HIPAA Compliant", "ISO 27001 Ready", "PCI DSS Compliant", "GDPR Compliant"
  appear across CPR-210/370/430/440/470. These are certifications, not design elements. None should
  render until someone can name the audit.
- **Pricing** appears again in CPR-440 at $0 / $5 / $15/user — a *fourth* set of numbers, after the
  homepage comps' $5/$10/$20 and $0/$7.99/$14.99. Still undecided; still omitted.

## 5. Proposed sequence

Nothing here is a week's work. A realistic order that keeps the product usable at every step:

1. **Settle the numbering** (§1). One decision, then a mechanical re-key.
2. **CPR-040 design system** — adopt indigo and the token set across the Practice app. Everything after
   this inherits it; doing it later means re-styling every module built in the meantime.
3. **Finish the clinical spine** — CPR-130 documentation properly, then CPR-140 follow-ups (already
   queued as Phase 4) and CPR-150 procedures. These complete the encounter the product already has.
4. **CPR-300 Operations Home** — the daily command centre the spec puts at the centre of the workspace.
5. **CPR-340 tasks / 350 search / 320 documents** — the operational spine everything else references.
6. **Practice Intelligence (200–270)** — needs clinical volume to be worth anything, so it follows.
7. **Enterprise Services (400–490)** — infrastructure-heavy; several are platform concerns that already
   have partial answers elsewhere in Competen (monitoring, billing, tenant lifecycle).

## 6. Standing rules that carry over

- Render real data only; an honest empty state beats a plausible number.
- Every module gets a harness, and the harness is proven able to fail before it is trusted.
- Migrations: plain idempotent statements, ASCII only, no do-blocks, RLS deny-by-default.
- A claim on a public page is a promise; a claim in a mockup is a drawing. Do not confuse them.
