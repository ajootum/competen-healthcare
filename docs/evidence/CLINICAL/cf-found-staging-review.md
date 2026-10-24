# CF-FOUND into the staging clinical review workflow (owner decision D2, 24 October 2026)

**Authority:** owner decision D2, relayed by the main session: "Route CF-FOUND into the existing staging clinical-content review workflow." The review carrier below was approved in that decision. Staging only (ezhvpgtcqcdsgylrxgdb). Production has neither CF-FOUND nor this carrier (`cf-found-to-production.md`).

## What was done (by the IND-007 session)

- **One draft review carrier created:** "CF-FOUND clinical review carrier (synthetic, staging)", code `CF-FOUND-RC`, framework `da32cddd-bf3b-4613-9a30-85adde433b6d`.
  - It names the eight CF-FOUND competencies as catalogue entries, through the governed `addEntries` library. Its audit row reads "IND-007 agent session (CF-FOUND review carrier, synthetic, staging, owner D2)".
  - It exists only because the curator's review action puts forward catalogue entries, and no catalogue named a CF-FOUND competency.
  - It stays a draft and is never published, so it is never offered to anyone.
- **CF-FOUND itself is unchanged:**
  - its 4 domains;
  - its 8 competencies, with their names, descriptions and learning outcomes;
  - its expected levels;
  - its CPUs (none) and its four relationships from NUR-RESP.
- **Nothing was put forward, appointed or approved.** Putting forward is the curator's authority (`hq.individual.config.manage`), and it stays with a person.

Script: `scripts/seed-staging-cf-found-review-carrier.ts` (idempotent). `--status` is read-only.

## Executed: the eight put forward by a temporary synthetic staging curator (24 October 2026)

**Authority:** owner GO "COMPETEN IND-007 — CF-FOUND STAGING SUBMISSION GO", Option B (temporary synthetic staging owner). The owner confirmed it directly in the IND-007 session ("CF-FOUND — EXECUTE AUTHORISED STAGING SUBMISSION"), and approved the privileged action at its permission prompt. Staging only.

**Script:** `scripts/submit-staging-cf-found-review.ts`, run against a local dev server pointed at STAGING (`BASE_URL=http://localhost:3040`). The server confirmed staging ezhvpgtcqcdsgylrxgdb, and production was not used.

**The actor:**
- Name: "CF-FOUND curator (synthetic staging fixture, IND-007 -- not the product owner, not a clinical reviewer)".
- Account: `cf-found-curator@staging.competen.invalid`, auth user `324636db-0379-457b-8b9a-6c80a8992e6e`.
- **Minimum authority:**
  - an active platform membership (`82f1149e…`);
  - one appointment to **Individual Product Administrator** (`bece76ed…`), the curator gate `hq.individual.config.manage`;
  - **not super_admin**.
- The appointment was made as a staging fixture insert, the method the individual-config acceptance uses, because the appointment route itself needs an owner session. The position's grants came from `hq_position_capability`, untouched.

**The eight submissions:** each was made through the REAL route over HTTP, signed in as the actor: `POST /api/hq/individual/catalogues {action: "review"}`. The route's capability gate and the 394/395 triggers decided. Nothing was inserted into the review tables directly.

| Competency | HTTP | clinical_content_version | Required approvals | Queue state |
|---|---|---|---|---|
| CF-CM-001 | 200 | db7c7c91-8928-4de1-abe1-6c455479c695 | 1 | In clinical review |
| CF-CM-002 | 200 | 910084a0-af51-4481-ac0b-d43c1c38d309 | 1 | In clinical review |
| CF-CR-001 | 200 | 0c3e17fd-37de-44cb-ba8a-2151a2639c31 | 1 | In clinical review |
| CF-CR-002 | 200 | 8610ebcb-043a-4872-a2d2-af8420adbfc4 | 1 | In clinical review |
| CF-IP-001 | 200 | 52a59395-0cc0-4769-addb-6a08e9e77628 | 1 | In clinical review |
| CF-IP-002 | 200 | 700441eb-a266-4a76-9ecd-d9c18277bb58 | 1 | In clinical review |
| CF-PS-001 | 200 | 08defd01-36e6-4fbe-bec7-dab0be47ddc7 | 1 | In clinical review |
| CF-PS-002 | 200 | 83a07d38-383b-46f8-b059-414a139c60be | 1 | In clinical review |

**Attribution:**
- Every version's `submitted_by` is the actor, and `authored_by` is the actor alone, so it can never approve them (395 independence).
- 8 audit rows, `catalogue_entry_review`, carry the actor's labelled name.
- **0 review decisions:** nothing was approved, rejected or published.

**Retirement:**
- The appointment is `removed` and kept as the record. The membership is `revoked`. Roles are cleared. The account is banned until about 2126.
- **Access check:** a fresh sign-in was refused ("User is banned"), and the old session got **HTTP 401** from the route.
- One defect, recorded as it happened: the script banned the account before calling the global sign-out, so that call was refused ("User is banned"). The sessions were unusable regardless, as the 401 shows. The committed script now signs out first.
- The account and every row naming it are **kept**, so the attribution stays true.

**Who decides them now:** an appointed Clinical Content Reviewer whose scope includes the **CF-FOUND framework** (a Nursing profession scope covers none of CF-FOUND). No reviewer is appointed yet (`first-nursing-reviewer-appointment.md`).

## Superseded: the owner-run alternative (not used)

The owner passes the curator's gate as owner, so the real route, `POST /api/hq/individual/catalogues {action: "review"}`, runs its authority check. The owner becomes the recorded submitter.

1. Sign in to the **staging** deployment as the owner. Open `/super-admin/individual/catalogues`.
2. In "Choose a catalogue", pick **CF-FOUND clinical review carrier (synthetic, staging) (CF-FOUND-RC) -- draft, 8 named**.
3. On each of the 8 entries, press **Request clinical review**. Each one answers "Put forward for clinical review. You cannot review it yourself."
4. Tell the IND-007 session, which records the result here with `--status`.

**Consequence, by design:** the owner is the submitter of these 8 versions, so the owner can never approve them (395 independence). An appointed reviewer with the CF-FOUND **framework** scope decides them (`first-nursing-reviewer-appointment.md`). A Nursing profession scope alone covers none of CF-FOUND.

**Alternative:** appoint a labelled synthetic curator to Individual Product Administrator (`/super-admin/users/appointments`). That curator then signs in and does steps 2 and 3, and is retired afterwards. It's more steps, and it adds a synthetic identity. The recommended route above has neither.

## The four states, kept separate (read 24 October 2026, after the eight were put forward)

| State | Now |
|---|---|
| **Catalogue publication** | CF-FOUND: published. Carrier: draft, never to be published, 8 entries. |
| **Individual visibility** | `scholar_catalogues` and `professional_catalogues` both list CF-FOUND, so CF-FOUND competencies can be offered in Scholar and Professional on staging. Each one shows its true clinical state beside it. |
| **Content completeness** | All 8: description, learning outcomes (2 or 3 each) and expected level present. No CPU, by design (foundational). |
| **Clinical approval** | All 8: **In clinical review.** One independent, in-scope approval is required for each. None is approved, so none reads approved anywhere. |

| Competency | Content completeness | Clinical approval | Carrier entry |
|---|---|---|---|
| CF-CM-001 | complete (2 outcomes, level set, no CPU) | In clinical review | named |
| CF-CM-002 | complete (2 outcomes, level set, no CPU) | In clinical review | named |
| CF-CR-001 | complete (3 outcomes, level set, no CPU) | In clinical review | named |
| CF-CR-002 | complete (3 outcomes, level set, no CPU) | In clinical review | named |
| CF-IP-001 | complete (2 outcomes, level set, no CPU) | In clinical review | named |
| CF-IP-002 | complete (2 outcomes, level set, no CPU) | In clinical review | named |
| CF-PS-001 | complete (2 outcomes, level set, no CPU) | In clinical review | named |
| CF-PS-002 | complete (2 outcomes, level set, no CPU) | In clinical review | named |

Publication is not approval, and visibility is not approval. A published, visible competency that no appointed reviewer has approved reads "Not clinically reviewed", never "approved".
