# HQ-RECORD-SEARCH-01: evidence

Owner GO of 6 Nov 2026, HQ search with approved defaults. **No migration.** The switch's row is not seeded, so nothing is on until someone turns it on, and absent or unreadable means off.

## What it does

The HQ search box gains record sources: policies, instruments, frameworks, positions and the staff directory. Each result shows its source module and links to a page behind the same right.

| Owner's default | How it is met |
|---|---|
| A Holdings platform administrator may activate; activation grants no extra access | `PATCH /api/v1/practice/flags`, the one flag writer behind its one gate (a harness requires both). For this flag it also takes `hq.platform.governance.manage`. No position holds that by default, so today it means the owner. Anyone else the owner appoints needs both rights. The Practice Product Director's right does not open it. With the flag on and no capability, a route answers 403 with zero reads |
| Staff names only, within an authorised scope, no private data | `hq.platform.users.view`. Reads `ogs_offices`, `ogs_office_appointments`, `hq_position`; never `profiles`. Only appointments, offices and positions in force, by the same test as HQ authority |
| Holdings-wide instruments for authorised users; entity instruments restricted | `owner_scope = holdings`, and frameworks with no `hospital_id` |
| Each result shows source module and authorised link | Yes |
| No leak through titles, snippets, counts or autocomplete | The server sends only sources the viewer may call, and each route checks again. A query with no words in it is refused, so symbols cannot list everyone |
| Audit sensitive admin searches | The staff search writes an audit row with who, source and count, never the query. If it cannot be written, nothing is returned (503) |
| Filters for module, record type and permitted scope | Module and record type are built. **Permitted scope is not**: every source is Holdings-wide today, so it would have one value |

Turning the switch on or off is audited. If the audit cannot be written, the change is undone and the answer is 503.

## Verification

| Check | Result |
|---|---|
| Route, switch and launcher tests | Pass, including planted refusals |
| `plane-boundary-harness`, which fixes the exact tables and columns read and sees a planted `profiles` read | Pass |
| Independent read | No blockers; 3 should-fix items fixed; Practice flag list narrowed so the new row gives no dead toggle |

**Not verified:** a browser walk, or real HTTP against staging with a real HQ identity. The behaviour is proven by route tests with a stubbed database. The first real run should be the owner turning it on, on production, and searching.

## Known limits

- A person with the switch right but without `hq.platform.operations.view` cannot reach the switch page; the owner holds both.
- The search term travels in the GET URL, so it may appear in request logs, though not in the audit trail.
- The staff read looks at up to 500 offices with no ordering, the same as the existing board. Past that, staff could go missing.
- The Practice mission widget lists every row in the shared flags table, so holders of `hq.practice.operations.view` could see this flag's name and state, as they do for other non-Practice flags.
