# COMPETEN-INDIVIDUAL-IDENTITY-HUB-01: the Personal & Professional Identity Hub (design and build record)

- **Authority:** owner directive "COMPETEN INDIVIDUAL PROFILE: FUNCTIONAL REDESIGN", 26 Oct 2026. The owner's mock-up is the visual reference: a header with photo, name, headline and the experience chips, then a two-column grid of cards.
- **Branch:** `prof/identity-hub-01`, cut from `origin/main` fb295386. That base already holds the #136 hub, the HFE W3 record homes and the "My practice" rename.
- **Migration:** 590, staging only.
- **Production:** only on a separate owner GO.

## 1. Reconciled first (no broad audit)

| Existing | Decision |
|---|---|
| #136 hub: inline identity (`OwnProfileInline`, `/api/account/profile`), 450 records via `/api/individual/profile-items`, Scholar studies, read-only history | Kept and built on. Nothing is rebuilt. |
| HFE D2 record homes: Profile owns education and qualifications. My practice owns registrations. Credentials & evidence owns competency evidence. | Kept. Each card shows other homes' records **read-only**, with a link to their home. Registrations are no longer added from the profile (`HUB_KINDS`). |
| 450 records: versioned, withdraw-not-delete, generated evidence class, Scholar or Professional origin | Reused for education, work, interests, objectives and specialties. 590 adds a **skill** kind. |
| Estate avatar: the PUBLIC `avatars` bucket and `profiles.avatar_url` | **Not reused.** A public object URL cannot be private by default (requirement 9). Individual gets its own private photo. |
| Passport: the 540 record-level view, draft, preview, activate, `/verify` | Reused. 590 adds a per-link `include_photo`. Nothing else in the profile reaches a link unless it is selected there. |

## 2. Data: what is captured, and where it lives

| Card | Records | Home | Written through |
|---|---|---|---|
| Header | photo, preferred name, headline, location | 590 `individual_identity_profile`; photo in the private bucket `individual-photos` | `/api/individual/identity`, `/api/individual/identity/photo` |
| Personal details | full name, given and family name, phone, country, email | `profiles` and Supabase Auth | `/api/account/profile` (own session, RLS); email only through the verified change flow |
| Professional summary | headline, biography, interests | 590; 450 `interest` | identity route; profile-items route |
| Education | qualifications, education | 450 `qualification` (**home here**) | profile-items route |
| Professional registration | primary registration; other registrations and licences | 373 profile; 450 `registration` (**home: My practice**) | read-only here; changed in My practice |
| Work experience | roles | 450 `employment` | profile-items route |
| Skills & competencies | skills, specialties; competencies summarised | 590 `skill` and 450 `specialty`; 520 (home: My competencies) | profile-items route; link out |
| Training & CPD | CPD entries; Competen Learning completions | 373 CPD (added in place with the existing `CpdForm`); 462 Learning | CPD route; read-only |
| Career objectives | objectives and learning goals | 450 `aspiration` | profile-items route |
| Portfolio & Passport | counts by trust, active links | the Passport read | links to Passport, Share and Document Studio |
| Your studies (Scholar) | programme, level, institution | 387/402 (history by trigger) | Scholar programme route |
| Development history | joined, experiences, Passport events | `history.ts` | read-only, immutable |

**No duplication.** Every record has exactly one home. A card shows another home's records by reading them, never by copying them.

**Recruitment and Document Studio** reuse the same shared tables through their existing services. Nothing here creates a second profile store.

## 3. Trust, history and privacy

**Labels.** Every entry says what it is:
- self-declared;
- document attached, not checked;
- issued or verified by an organisation (from the Passport, read-only);
- independently verified (451, only after a request from My practice).

Entering a record never verifies it. 590 has no column that could say so (VERIFY §6).

**History.** Changing a 450 record creates a new version and keeps the old one. Withdrawing keeps it in its history. The development history is read-only and shown apart from editable data.

**Private by default.**
- Contact details and registration details never appear on `/verify` or a link.
- The registration number is never printed, even to the owner: the page says only "Recorded, private".
- A photo appears on a Passport link only where the person ticks "Show my profile photo on this link". That choice is set per link, unticked by default, and fixed once the link is active (540's guard).
- `/verify` reads nothing of the identity except that photo.

**The photo:**
- It is sniffed from its bytes. Only JPEG, PNG and WebP under 5 MB are accepted.
- It is stripped of EXIF, GPS, XMP, IPTC and text metadata, without re-encoding (`image-metadata.ts`, tested).
- It is stored under the person's own folder in the private bucket.
- It is served only by short-lived signed URLs: to the owner through `/api/individual/identity/photo`, which serves only the caller, and on a link that carries it.

**Audit.** Every identity write is audited by field names only, never values.

## 4. Presentation (HFE)

**Header.**
- The photo, with Add, Change and Remove.
- The display name (preferred, with the legal name under it when different), the headline and the location.
- The experience chips.
- "Edit profile", which edits inline.
- Progressive completion: "x of y complete", with up to three one-click prompts to the next useful card. Nothing is required.

**Cards.** A two-column grid on desktop and one column on a phone. Each card has inline Add, Edit, Save and Cancel, immediate validation with character counts, and save or error feedback.

An empty card says what to add, with one obvious action. Wide content (personal details) spans both columns.

**Configurable.** The record cards follow the published `professional_profile_sections`.

## 5. Migration 590 (staging only)

**What it adds.** All of it is additive:
- `individual_identity_profile`: own-row SELECT, no write policy, length and photo checks;
- the private bucket `individual-photos`;
- `skill` in the 450 section check;
- `individual_passport_share_view.include_photo`, default false.

**Dependencies:** 450 and 540.

**Before 590 the code fails closed:**
- the hub reads "not set up" for headline and photo;
- `include_photo` is read apart from the rest of the view, so views still work;
- a link writes `include_photo` only when it is chosen.

**Evidence:** `docs/evidence/COMPETEN-INDIVIDUAL-IDENTITY-HUB-01/`. It contains ROLLBACK, VERIFY, FINGERPRINT, the staging record and `rollback-590-storage.ts`.

**Staging** (coordinator, rev 2 package):

| Step | Fingerprint | Items |
|---|---|---|
| Applied | `62b0651a` | 28 |
| SQL rollback | `12f8648b` = PRE | 11 |
| Storage step | private, 0 objects, then emptied and deleted | |
| Re-apply ×2 | = applied | |

VERIFY returned exactly the expected values.

**Why revision 2.** Supabase refuses SQL deletes on storage tables. So the SQL rollback leaves the bucket alone, `rollback-590-storage.ts` removes it through the Storage API, and the fingerprint excludes the bucket.

**Production order:** 590 after 450 and 540. Bytes: f618372c.

**Local rehearsal** (postgres:17):
- Apply #1 equalled apply #2, and rollback returned to PRE.
- Nine probes behaved as designed.
- It caught a CHECK that passed on NULL, which is now fixed.

## 6. Verification

| Check | Result |
|---|---|
| `individual-identity-hub-harness` (new, in CI) | I1 to I6, with 14 planted reds |
| vitest | metadata stripper; hub cards and completion; identity field parser; per-link photo, including before 590 |
| `individual-foundation` | the identity write is pinned (2a) |
| `professional-profile`, `individual-professional`, `professional-passport`, `account-profile`, `scholar-learning` | green |
| staging walk | see the steps below |

**Staging walk.** 590 was applied on staging. The walk used a synthetic Scholar + Professional identity, deleted afterwards along with its photos and links.

- **Photo upload:** a camera JPEG carrying a GPS marker was uploaded.
  - It was stored without the marker (385 bytes in, 323 bytes out).
  - It is served only through a signed staging URL.
  - The public object URL is refused (400).
  - Unauthenticated photo and identity calls are refused (401).
- **Header:** "Edit profile" saved inline. Preferred name, headline and location persisted.
  - A 141-character headline was blocked as you typed: "Too long: 141 of 140", with Save disabled.
- **Skills:** a skill was added in place (201).
- **Registration card:** says "Recorded, private". The number appears nowhere in the HTML.
- **Passport links, fetched as an anonymous recipient:**
  - the link with the photo ticked shows it, through a signed URL;
  - the unticked link shows no photo;
  - neither carries the headline, location, registration number or country.
- **Phone width (375px):** no horizontal scroll. On a touch pointer, standalone links are 44px.
