# HQ-POSITION-ADMIN-01: migration 500 build record

**Owner ask, 25 Oct 2026:** "Can you make creation of roles in HQ no code i.e. configureable?"

**State:** applied ×2 on staging with a rollback rehearsal, 25 Oct (`500-staging-record.md`: FINGERPRINT 0 → 17 → 17 → 0 → 17, VERIFY 9/9, data unchanged). Merged to `main` does **not** authorise production. Production needs a separate owner GO, applied by hand, file whole.

## What changed

**Migration 500** (`supabase/migrations/500-hq-position-administration.sql`, APPLY WHOLE):
- **Depends on:** 264, 040 and 178 only. Independent of 465, 466, 470 and 480–499, in any order.
- **Additive:** 3 nullable columns on `hq_position_capability` (`grant_reason`, `ended_by`, `end_reason`), 12 functions and 2 triggers.
- **Writes no position, no grant and no appointment.**

**One audited database function per action** (`hq_position_admin_*`):
- Actions: create, update (name and description), set_active (deactivate or reactivate), grant, end_grant, register.
- **Every action requires:**
  - the owner, checked in the database (`hq_actor_is_owner`, the same predicate as `context.ts`);
  - a reason of at least 5 characters.
- **Audit first:** each action writes its `audit_log` row before the change, in the same transaction. A refused action leaves no row.
- **Execute:** service_role only.

**Guard triggers:**
- `hq_position_capability_guard` applies to every writer, migrations included:
  - it refuses 10 separation-of-duties pairs on one position;
  - on UPDATE, the only change it allows is ending a live grant. An ended grant is never reopened or rewritten.
  - DELETE is untouched, so rollback scripts and cascades still work.
- `hq_position_guard`: a position's code and space never change.

**Sensitive classes** (clinical, financial, platform or owner-level): a grant needs the owner, a reason and `acknowledge_sensitive = true`.

**App:**
- **Lib:** `src/lib/hq/positions.ts`. It mirrors the two SQL lists, and `positions.test.ts` reads the migration to prove they agree.
- **Route:** `src/app/api/hq/positions/route.ts`.
  - Reads: `hq.platform.users.view`, enforced.
  - Writes: owner only.
  - Grants and registrations are limited to codes in `HQ_CAPABILITIES`. A registration's space comes from code, never from the request.
- **Screen:** `/super-admin/users/positions`, linked from the appointments screen. The sidebar is unchanged.

**Harness:** `scripts/hq-guard-harness.ts` no longer parses dollar-quoted function bodies as seeds.
- Without that fix, 500's function bodies read as seed rows and turned D1–D6 red.
- After the fix it is ALL GREEN, 51/0, with the same 20 seed migrations and 71 rows as main.
- A seed planted outside a function body still turns it red (D1, D2).

## Separation-of-duties pairs (per position)

| Pair | Why |
|---|---|
| clinical.approve + competency.author / case.author / course.author / ckri.educator | an author cannot hold clinical approval |
| clinical.approve + clinical.govern | a reviewer cannot set reviewer scopes |
| case.author + case.publish | 422 author vs publisher |
| course.author + course.publish | 464 separate authorities |
| ckri.educator + knowledge.publish | 442 |
| research.propose + research.review / research.govern | 440, 443 |

The per-item independence triggers in 395, 422, 440, 442, 443 and 463 are unchanged.

## Refused by design

- **Inventing a capability code:** refused by the route. hq-guard B1 still requires the applied catalogue to equal the code catalogue.
- **Re-granting a pair that was ended:** refused.
  - The 264 unique index on (position_code, capability_code) is not partial, so it keeps one row per pair, and reopening that row would rewrite history.
  - Changing the index would break `on conflict (position_code, capability_code)`, which four applied migrations use. It is left alone.
- **Deleting a position or a grant:** there is no verb for it.
- **Appointing anyone:** appointment stays on the existing appointments screen.

## Verification

- **Local rehearsal** (postgres:17 stub plus the real 264):
  - Apply ×2 OK.
  - FINGERPRINT went PRE 0 → 17 → 17 → ROLLBACK 0 → re-apply 17.
  - VERIFY: 9/9 true.
  - 30 behaviour probes, all as designed (`LOCAL-ONLY-PROBES-500.sql`, local only).
- **Vitest:**
  - `positions.test.ts` 15/15;
  - `route.test.ts` 6/6. It covers: a non-owner refused before the database is called, the actor taken from the session, an invented capability returning 400, separation of duties returning 409, ending a grant through the end function, and 503 when 500 is absent.
- **Static checks:** `tsc` clean. The hq-guard, plane-boundary, access-scanner and hq-nav-filter harnesses are all green.
- **Not verified in a browser:** that would need an owner sign-in.

## Production steps (owner GO)

1. Record a pre-application recovery reference (OPS-001). Run `FINGERPRINT-500.sql` (PRE: 0 items) and keep the data line.
2. Paste `500-hq-position-administration.sql` **whole** into the SQL editor and run it. Its final select must return 0 rows.
3. Run `VERIFY-500.sql`: all 9 lines must read true. Then run `FINGERPRINT-500.sql`: 17 items, with the data line unchanged.
4. Deploy main so `/super-admin/users/positions` is live.
5. **Competency Author** (recommended): apply 465, and 466 with it, under their own GO.
   - From then on, create new positions on the screen.
   - The screen could build the same position without 465: register `hq.quality.competency.author`, create `competency_author`, then grant it.
   - That would skip 466's publication guard, so it is not the recommended path.
   - If the screen route is used anyway, 465 applied later is a no-op, unless one of those two grants was ended first. Then 465's insert hits the 264 unique index and fails.
6. Rollback if needed: `ROLLBACK-500.sql`. Writes through the screen then return 503. Rows already written stay.
