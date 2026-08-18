# COMP-SEC-001-CONFORMANCE-001 — the security framework, mapped against what actually exists

**Date:** 2026-08-16 · **Why a map and not a build:** COMP-SECURITY-SURVEY-001 read COMP-SEC-001 as
"a GOVERNING document composing over the other two — the honest output is a conformance map", and the
owner took that reading when ordering the arc (AUTH → IDENTITY → SEC). This is that map: every line of
the spec against the deployed truth, with evidence or the honest gap. **Phase 4 of the arc.**

**Vocabulary of verdicts.** `SATISFIED` — exists, with the file/migration that proves it.
`PARTIAL` — exists narrower or weaker than the line claims, said how. `NOT SATISFIED` — absent; no
euphemism. `PLATFORM-ATTESTED` — the control belongs to Supabase/Vercel, not this repository; the
honest form of conformance is an attestation pointer, and claiming it as ours would be the
"advertised controls that do not exist" failure this arc spent Phase 0 digging out.
`DECIDED-AGAINST` — deliberately not built, by a recorded owner decision, with the rationale.

---

## Identity & Authentication

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Shared authentication engine (COMP-AUTH-001) | **PARTIAL** | One engine (Supabase GoTrue) authenticates every workspace. The SESSION engine above it (idle, lock, pause, heartbeat) is practice-only (`PracticeSessionGuard`, shipped 755c76b8); the estate workspaces have no session lifecycle beyond GoTrue's own. |
| MFA — authenticator app | **SATISFIED** | TOTP enrolment + step-up at `/practice/two-factor` (outside the shell so a locked-out person can reach it); `mfaGate` fails closed, including UNAVAILABLE as its own refusing state. Owner decision 2026-08-16: requirement being switched ON for the live practice. ⚠ No recovery codes — a lost authenticator is a platform-operator reset. |
| MFA — email OTP | **PARTIAL** | The OTP engine exists and was hardened against four live vulnerabilities (mig 224, commit fc2de9a2), but no mail provider is configured, so no code can be delivered. Blocked on the Resend/DNS task, not on code. |
| MFA — SMS | **NOT SATISFIED** | No SMS sender is registered (Africa's Talking sender-ID has telco lead time). Engine paths exist, delivery does not. |
| Passwordless (passkeys/WebAuthn) | **NOT SATISFIED** | Roadmap item in the spec's own words; nothing built, and the lock screen says so to its users ("Why is there no PIN or fingerprint?"). |
| SSO (OAuth2/OIDC) | **SATISFIED, dormant by design (2026-08-16)** | Start route with three checks incl. GoTrue live settings; callback speaks the signups-closed refusal in words; open-redirect guard break-tested; sso-harness 18/0. Turning on = provider in dashboard + NEXT_PUBLIC_OAUTH_PROVIDERS. SAML: stated absent -- a per-IdP enterprise-plan Supabase configuration, not a repo build. |

## Authorization

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Role-Based Access Control | **SATISFIED** (two planes, two models — by design) | Estate/platform: the six role columns, now consolidating read-side (`estateRolesOf`/`orgRolesOf`/`platformRolesOf` + `resolveIdentity`, equivalence proven for all 47 live profiles before repointing). Practice: `practice_membership` + `practice_role_capabilities` (43+ codes) — never `profiles.role` (COMP-ARCH-PSA-001's two-gate split). HQ: capability model enforced on all 205 pages (hq-scan). s14 role-check ban ANSWERED (owner, 2026-08-16): scoped now (HQ + new products are capability-based, estate keeps hasRole), strict migration is the end-state folded into the Enterprise rebuild. |
| Permission-based feature access | **SATISFIED** | Practice capabilities gate every module; HQ `requireHqCapability`. ⚠ The capability-backfill class is the known failure mode (twice shipped, healed by migs 192/307; the same-file backfill rule stands). |
| Custom roles per organization | **DECIDED-AGAINST for now (owner, 2026-08-16)** | Not until an organisation asks -- the closed role catalogues are load-bearing (capability mappings, portal derivation). |
| Break-glass access with mandatory audit | **PARTIAL** | `super_admin` is kept explicitly as break-glass (PLAT-ARCH decision) and HQ actions audit; the immutable access log (mig 202) records practice reads. What does NOT exist: a distinct break-glass ceremony (reason-required elevation, time-boxed) — super_admin is standing power, not summoned power. |

## Data Protection

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| TLS everywhere | **PLATFORM-ATTESTED** | Supabase/Vercel terminate TLS; HSTS for both subdomains in `next.config.ts` headers. |
| Encryption at rest (DB + backups) | **PLATFORM-ATTESTED** | Supabase's attestation, not this repo's. |
| Encrypted object storage | **PLATFORM-ATTESTED** | Same. The one client-side store this product encrypts itself: the offline device cache (PIN → KEK → data key, offline-lock.ts), with the outbox deliberately exempt from expiry, not from encryption. |
| Key rotation & secrets management | **PARTIAL** | Secrets live in env (`.env*` gitignored; zero env files tracked in git). No rotation schedule exists anywhere; the service-role key is long-lived. |

## Application Security

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| CSRF protection | **PARTIAL** | No token layer. What actually stands: SameSite auth cookies, Next server-action origin checking, and JSON APIs behind authenticated context. The survey called CSRF absent; this line is the honest refinement — mitigated by defaults, not protected by design. |
| XSS mitigation | **SATISFIED (by framework) + CSP report-only** | React escaping throughout; the QR code on the two-factor screen deliberately rendered as `img`, never `dangerouslySetInnerHTML`. |
| SQL injection prevention | **SATISFIED** | All data access via PostgREST parameterized calls; no string-built SQL serves user input. Migrations are hand-applied files, not runtime SQL. |
| CSP — monitoring / observation | **SATISFIED** | `Content-Security-Policy-Report-Only` shipped in `next.config.ts:182`. ⚠ Report-only is not a partial credit here: the non-inline directives — `object-src`, `base-uri`, `frame-ancestors`, `form-action`, `connect-src`, `img-src` — are meaningfully tight *and are the ones needing real-world observation before they enforce*. Observation is the control that is actually in place. |
| CSP — enforcement | **IN PROGRESS** | Owner ruling 2026-08-19: treat as a genuine rollout, not a checkbox. Ladder: report-only → collect violations → classify → remove unnecessary sources → test in staging → enforce the non-inline protections → keep tightening. ⚠ Enforcing today would require broad `'unsafe-inline'` on both `script-src` and `style-src` for three concrete reasons (a blocking inline anti-flash script in `layout.tsx`, Next's per-route `self.__next_f.push` bootstrap that no fixed hash covers, and React 19 + Tailwind v4 inline style *attributes*) — which is a policy worth little as an XSS control, manufactured to look complete. Blocked on staging (COMP-ENG-002) for the test step. |
| Input validation client and server | **SATISFIED** | Engines validate server-side as doctrine; offline capture re-validates at the bedside in the same sentences (the two-list-no-drift rule, pinned by harness). |

## Infrastructure Security

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Network segmentation · Firewalls/WAF · Patch management · DDoS protection | **PLATFORM-ATTESTED** | Supabase/Vercel controls. The deployment attestation the survey asked for should name them; this repo cannot. |
| Automated vulnerability scanning | **PARTIAL** | Dependency-level: SATISFIED 2026-08-16 -- scripts/audit-gate.ts gates every push/PR on high/critical advisories, with recorded-deviation allowlist (security/audit-allowlist.json, xlsx only). Infrastructure-level scanning remains the host attestation's. |

## Audit & Monitoring

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Immutable audit log | **SATISFIED** | `practice_audit_event` append-only enforced by trigger (mig 247 — it broke every harness `wipe()`, which is the brake working); note versions immutable (mig 195); access log (mig 202). |
| Security event monitoring | **PARTIAL** | The auth trail exists and says honestly what it does NOT see (`AUTH_EVENTS_NOT_RECORDED_HERE`). No monitoring pipeline consumes it. |
| Alerting for suspicious logins | **NOT SATISFIED** | Its stated precondition (the auth audit service) now exists; the alerting itself is unbuilt. |
| Failed login thresholds and account lockout | **DECIDED-AGAINST (owner, 2026-08-16)** | Failed sign-ins never reach this codebase — GoTrue checks passwords — and a product-level lockout is a denial-of-care vector (spam wrong passwords to lock a clinician out of patient records). Instead: Supabase dashboard rate limits tightened + leaked-password protection (owner runbook). This is a recorded deviation from the spec, with rationale, not an omission. |
| Comprehensive API request logging | **PARTIAL** | State changes audit (CPR-CORE s13 discipline); platform-plane reads of practice data are themselves recorded (PLAT-OVERSIGHT). Per-request infrastructure logs are the host's. |

## Privacy & Compliance

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Configurable data retention | **NOT SATISFIED** | Retention is an open owner decision (survey s8). CPR-LIFE-001 measured the honest state: the anonymisation claim exists only in the comp — 111 cascade FKs contradict it; SAFE-SUBSET export is the chosen shape. |
| Consent management | **PARTIAL** | Terms + privacy-notice versions are recorded per provisioning (`termsVersion`/`privacyNoticeVersion`); no granular consent engine. |
| Regional data residency | **NOT SATISFIED** | Single Supabase region; no residency machinery. A sales-page claim to the contrary would be false — none is made. |
| Patient/practitioner privacy controls | **SATISFIED (as built, plane-shaped)** | The plane boundary (PRACTICE_ALLOWLIST, counts-never-amounts, owner name-not-email), Clinical Pause Mode, the offline PIN lock, person-scoped professional-record export from behind locked doors. |

## Business Continuity

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Automated encrypted backups | **PLATFORM-ATTESTED** | Supabase backups/PITR per plan tier — the attestation should name the tier and its actual PITR window. |
| Disaster recovery testing | **NOT SATISFIED — procedure ready, blocked on staging** | Still never performed, and the verdict does not move until it is. What changed 2026-08-19: `docs/COMP-DR-001-rehearsal-runbook.md` is the executable procedure with measurement points and a pass definition, and it runs against staging by owner ruling — so it is blocked on COMP-ENG-002, not on knowing what to do. Backup conformance remains a claim about Supabase until a restore is rehearsed. |
| High availability | **PLATFORM-ATTESTED** | Host SLAs. |
| RPO / RTO objectives | **SATISFIED (defined), UNMEASURED** | Owner decision 2026-08-19, ADR-009: **RPO 24h, RTO 8h** — initial service targets, subject to tightening. Held in `src/lib/super-admin/recovery-objectives.ts` and prefilled as the target on any exercise logged in the Recovery console, so a drill cannot be scored against a number nobody agreed. ⚠ Defined is not achieved: no restore has been rehearsed, so these are objectives with no measurement behind them, and the console says so on its own surface. |

## Developer Security Standards

| Spec line | Verdict | Evidence / gap |
|---|---|---|
| Secure coding guidelines | **PARTIAL** | Strong working doctrine exists and is enforced by harness (fail-closed reads, refusal-with-reason, break-tests, same-write-path) — but as practice and memory, not as a written standard a second developer could be held to. |
| Mandatory code review | **NOT SATISFIED** | Solo development, direct commits to main. Honest, and structural until there is a second reviewer. |
| Dependency scanning | **SATISFIED (2026-08-16)** | CI job on every push/PR: scripts/audit-gate.ts (in-repo, break-tested) fails on any unexplained high/critical; the two SheetJS advisories are recorded deviations with reasons and dates. |
| Secret scanning | **SATISFIED (2026-08-16)** | CI job: gitleaks v8.21.2 over the clean checkout, before npm ci; fixture values carry inline gitleaks:allow annotations at their own lines. |
| SAST / DAST | **PARTIAL** | tsc + eslint gate every push (static checks, honest label -- not a dedicated SAST engine); DAST absent. Database harnesses stay local by design: the service-role key does not belong in GitHub. |

## The spec's acceptance criteria, answered

1. **"All services authenticated"** — holds. Every practice route behind `requirePracticeContext`/shell guards (the 98-open-routes incident found and closed); all 205 HQ pages enforce; estate layouts gate on membership.
2. **"Every sensitive action audited"** — holds as discipline (state-changing engines write audit rows with correlation ids), with the auth trail's not-recorded list keeping the claim honest.
3. **"No plaintext secrets"** — holds for the repository (`.env*` ignored, zero tracked env files). Rotation remains the gap named above.
4. **"RBAC enforced platform-wide"** — ⚠ **holds only if read as application-layer enforcement, and this map previously let it imply RLS.** Owner ruling 2026-08-19: state the architecture as it is, in three layers, rather than let a spec phrase describe a system nobody built.

   | Layer | What actually enforces | Reality |
   |---|---|---|
   | **Database enforcement** | RLS *where technically appropriate* | ⚠ Not the primary control. 209 of 209 `practice_*` tables carry RLS with **zero policies**, and the service role bypasses RLS entirely. RLS is not what stops a cross-tenant read today. |
   | **Application authorization** | `getCaller()` and the other approved boundaries, capability resolution, the tenant/product boundary | **This is the real control.** 358 of 455 API routes enter an approved boundary; 6 are allowlisted with reasons; 91 authenticate ad-hoc and are a ratcheted backlog (`scripts/auth-boundary-harness.ts`). |
   | **Privileged server access** | service-role, strictly server-side, audited | Legitimate and deliberate — but it is why the layer above must hold, since nothing beneath it will. |

   Two open items sit under this, in the owner's priority order: **routes bypassing the boundary
   entirely** (91, ADR-008 §note / `auth-boundary-harness`) rank **above** the role-name migration
   (ADR-008), because a route that never reaches the gateway is more consequential than one that reaches
   it and then uses an older abstraction inside.
5. **"Security settings configurable by tenant"** — holds on the practice plane (`practice_security_policy`: MFA requirement, idle limit, audited updates). No org/product/role/user override axes (COMP-AUTH-001's admin matrix) exist.

## What this map changes

Nothing in code. It exists so that the next security conversation starts from verdicts instead of
impressions, and so the deviations that were DECIDED (lockout) are never mistaken for gaps that were
missed. The shortest true summary: **authentication, authorization, audit and the practice plane's
privacy controls are real and enforced; monitoring/alerting, CI security tooling, retention, DR
rehearsal and everything SSO-shaped are the honest remainder** — and the platform-attested lines need
an actual attestation document naming the Supabase/Vercel guarantees relied on.
