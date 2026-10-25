# Competen Learning: owner actions for the staging browser acceptance (PREPARED, NOT RUN)

**Authority:** the owner's "COMPETEN LEARNING — STAGING ACCEPTANCE CONTINUATION" (25 October 2026), items 1 (roles) and 2 (payments). Staging project ezhvpgtcqcdsgylrxgdb only. **No production appointment, flag or key.**

**Why the owner runs these and the agent does not:**
- Both application workflows the owner named require a platform-owner session: `POST /api/super-admin/users` (create account) and `POST /api/hq/appointments` (appoint, which also refuses self-appointment).
- The Learning switches are owner-run by design (`scripts/staging-learning-switch.ts`).
- The owner said: "If privileged account creation or appointment requires an explicit permission prompt, present it for owner approval. Do not circumvent it."

**Already proven without these** (library level, synthetic and self-cleaning): `learning-acceptance-harness` is **22/22 on staging**, covering Journeys A and B, the D8 separations and no AI.

---

## 1. Five synthetic HQ identities, and one synthetic learner

**⚠ Owner decision first.** The existing account workflow (`/super-admin/users`, Create user) requires an estate portal role (`super_admin`, `hospital_admin`, `educator`, `assessor` or `nurse`) and also grants estate platform membership (gate 1). That is more than "only its required authority". Choose one:

- **(a) Recommended:** create each account with role `nurse` and **no organisation or hospital**. That is the lowest estate role. With no hospital, it reaches no hospital data. The estate membership the workflow writes stays for the test window and is retired with the account (step 3 below). The HQ appointment carries the only authority the test uses.
- **(b)** Accept the estate role for the test window. It is retired with the account afterwards.

**Accounts.** Owner, signed in to a STAGING-pointed server: `node scripts/dev-staging.mjs`, then open `http://localhost:3100/super-admin/users`. Use Create user, mode `password`. The temporary password is shown once: hand it to the tester and never store it.

| # | Full name (exactly) | Email | Then appoint at /super-admin/users/appointments |
|---|---|---|---|
| 1 | [STAGING TEST] Learning Course Author | learning-author@example.test | Learning space: **Learning Course Author** (`learning_course_author`) |
| 2 | [STAGING TEST] Learning Clinical Reviewer | learning-reviewer@example.test | Quality space: **Clinical Content Reviewer** (`clinical_content_reviewer`). Then, at /super-admin/clinical-review/governance, add a **framework** scope covering the ECG course's competencies (for the CF-FOUND fixture: framework CF-FOUND). |
| 3 | [STAGING TEST] Learning Publisher | learning-publisher@example.test | Learning space: **Learning Publisher** (`learning_publisher`) |
| 4 | [STAGING TEST] Learning Price Approver | learning-prices@example.test | Learning space: **Learning Price Approver** (`learning_price_approver`) |
| 5 | [STAGING TEST] Learning Certificate Issuer | learning-issuer@example.test | Learning space: **Learning Certificate Issuer** (`learning_certificate_issuer`) |

**The learner** is a course-only member, with no Scholar or Professional (D2, D5):
- Invite `learning-learner@example.test` as "[STAGING TEST] Learning Learner" through the existing Individual invitation at `/super-admin/individual` (Individual Product Administrator, or an owner). Give **no** Scholar or Professional period.
- The learner accepts through the invitation link.
- Course access then comes only from the test purchase (§2), or from `/super-admin/learning/access` (an HQ course grant).

**Record each profile id** in the build record. Five people for five authorities: no account holds two.

**After acceptance** (owner; audit history preserved, nothing deleted):
1. End each appointment at /super-admin/users/appointments. This sets its status, the row stays, and nothing is deleted.
2. End the reviewer's scope (Clinical review governance).
3. Suspend each account: /super-admin/users, the person, Suspend. This is a Supabase Auth ban, so no new sign-in and no token refresh.
4. Revoke sessions. A ban stops refresh, and an issued access token lapses at its expiry (Auth settings, JWT expiry). For an immediate cut-off, sign each tester out through the Supabase dashboard (Authentication, the user, Sign out / revoke sessions).
5. End the learner's Individual membership (/super-admin/individual), then suspend that account the same way.

## 2. Course purchases on staging, with Flutterwave TEST credentials only

**State now** (read-only, `npx tsx scripts/staging-learning-switch.ts --status`):

- `learning_app` OFF, `learning_commerce` OFF.
- **Payments: test mode = no. No `FLW_SECRET_KEY` is configured in any local environment.** Only variable names were checked, never values. Every course checkout therefore refuses `NOT_CONFIGURED`, and nothing can be collected.
- **How it is determined:** `paymentTestMode()` in the switch script uses the same rule as `scripts/flutterwave-sandbox.ts`. It needs all of these:
  - a key that carries `_TEST`;
  - `FLW_SECRET_HASH` set;
  - a site URL that is not a production domain.

  `--commerce-on` refuses otherwise.

**Owner steps:**
1. In the Flutterwave dashboard, **TEST mode**, copy the test secret key (it begins `FLWSECK_TEST-`) and set a webhook secret hash.
2. Put `FLW_SECRET_KEY`, `FLW_SECRET_HASH` and `NEXT_PUBLIC_SITE_URL` into the environment of the **staging** app only:
   - for `dev-staging` on port 3100, `.env.local` (gitignored);
   - for a staging deployment, its Preview environment.

   Never Production.
3. **Webhook reachability.** Access opens only when Flutterwave's webhook reaches `/api/v1/practice/billing/webhook/flutterwave` and settlement passes its three checks. The browser cannot open access. A localhost server cannot receive the webhook, so use one of:
   - a staging deployment URL;
   - a tunnel to port 3100, set as the TEST webhook URL in Flutterwave.
4. Confirm: `npx tsx scripts/staging-learning-switch.ts --status`. It must say **"payments test mode: yes"**.
5. Open the switches:

   ```bash
   npx tsx scripts/staging-learning-switch.ts --app-on
   ```

   ```bash
   npx tsx scripts/staging-learning-switch.ts --commerce-on
   ```

   `--commerce-on` refuses unless test mode is yes and the app switch is on.
6. **Test purchase.** As the learner, open the ECG course and choose "Get access". Pay with a Flutterwave **test card** or **test mobile money** number from the Flutterwave test documentation. Then check:
   - the return page waits until the webhook settles, then says access is open;
   - the course opens; complete it;
   - the certificate verifies at `/learning/verify/<code>`.
7. **Close:**

   ```bash
   npx tsx scripts/staging-learning-switch.ts --commerce-off
   ```

   ```bash
   npx tsx scripts/staging-learning-switch.ts --app-off
   ```

   Remove the TEST keys if they are not otherwise needed.
