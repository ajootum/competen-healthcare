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

## The minimal OWNER step (recommended): put the eight forward yourself

The owner passes the curator's gate as owner, so the real route, `POST /api/hq/individual/catalogues {action: "review"}`, runs its authority check. The owner becomes the recorded submitter.

1. Sign in to the **staging** deployment as the owner. Open `/super-admin/individual/catalogues`.
2. In "Choose a catalogue", pick **CF-FOUND clinical review carrier (synthetic, staging) (CF-FOUND-RC) -- draft, 8 named**.
3. On each of the 8 entries, press **Request clinical review**. Each one answers "Put forward for clinical review. You cannot review it yourself."
4. Tell the IND-007 session, which records the result here with `--status`.

**Consequence, by design:** the owner is the submitter of these 8 versions, so the owner can never approve them (395 independence). An appointed reviewer with the CF-FOUND **framework** scope decides them (`first-nursing-reviewer-appointment.md`). A Nursing profession scope alone covers none of CF-FOUND.

**Alternative:** appoint a labelled synthetic curator to Individual Product Administrator (`/super-admin/users/appointments`). That curator then signs in and does steps 2 and 3, and is retired afterwards. It's more steps, and it adds a synthetic identity. The recommended route above has neither.

## The four states, kept separate (read 24 October 2026, after the carrier was created)

| State | Now |
|---|---|
| **Catalogue publication** | CF-FOUND: published. Carrier: draft, never to be published, 8 entries. |
| **Individual visibility** | `scholar_catalogues` and `professional_catalogues` both list CF-FOUND, so CF-FOUND competencies can be offered in Scholar and Professional on staging. Each one shows its true clinical state beside it. |
| **Content completeness** | All 8: description, learning outcomes (2 or 3 each) and expected level present. No CPU, by design (foundational). |
| **Clinical approval** | All 8: **Not clinically reviewed.** Nothing is in review yet, because the owner step above has not been done. |

| Competency | Content completeness | Clinical approval | Carrier entry |
|---|---|---|---|
| CF-CM-001 | complete (2 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-CM-002 | complete (2 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-CR-001 | complete (3 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-CR-002 | complete (3 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-IP-001 | complete (2 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-IP-002 | complete (2 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-PS-001 | complete (2 outcomes, level set, no CPU) | Not clinically reviewed | named |
| CF-PS-002 | complete (2 outcomes, level set, no CPU) | Not clinically reviewed | named |

Publication is not approval, and visibility is not approval. A published, visible competency that no appointed reviewer has approved reads "Not clinically reviewed", never "approved".
